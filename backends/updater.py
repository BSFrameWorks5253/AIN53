"""
AIN53 Data Management - Auto Update Engine
===========================================

Fully custom-built update pipeline (no electron autoUpdater equivalent needed).
Implements the complete spec from auto_update_explainer.md:

  Stage 1  – Startup silent check (respects auto_check_updates setting)
  Stage 2  – Semantic version comparison
  Stage 3  – IPC-equivalent handlers: check / download / install
  Stage 4  – JS push model: window.onUpdateAvailable() passive event
  Stage 5  – Settings store for auto_check_updates toggle

Download features:
  • Saves to %TEMP%\\AIN53_Update\\*.exe.part, renames on success
  • Follows HTTP 301/302/307/308 redirects recursively
  • Google Drive confirmation-page bypass (extracts confirm= token, retries)
  • Progress events throttled to one emit per 350 ms
  • Content-Length size verification (raises on mismatch)
  • SHA-256 checksum verification (if manifest provides 'checksum' field)

Install:
  • Spawns NSIS installer with /S (silent) flag as detached process
  • Calls os._exit(0) to release all file locks

GitHub Repository: https://github.com/BSFrameWorks5253/AIN53.git
"""

import os
import re
import sys
import json
import time
import hashlib
import tempfile
import threading
import urllib.request
import urllib.error
import urllib.parse
import subprocess
from pathlib import Path
import webview

# Ensure Windows terminal UTF-8 encoding compatibility
if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass
if hasattr(sys.stderr, 'reconfigure'):
    try:
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

# ---------------------------------------------------------------------------
# CONFIGURATION CONSTANTS (Defaults)
# ---------------------------------------------------------------------------
DEFAULT_GITHUB_REPO  = "BSFrameWorks5253/AIN53"
DEFAULT_GAS_URL      = "https://script.google.com/macros/s/AKfycbyaAOszoh13kXe3qxOSoBvji1SOw0AtqdQZU70Ul0rDH0h2S63qX_Q4oCpfQE1vMTSuBQ/exec"

# Settings JSON store filename (lives next to version.txt in base_dir)
SETTINGS_FILENAME    = "app_settings.json"

# Progress event throttle interval (seconds)
PROGRESS_THROTTLE_S  = 0.35  # 350 ms

# Maximum redirect hops before giving up
MAX_REDIRECTS        = 10

# Installer temp directory name
INSTALLER_SUBDIR     = "AIN53_Update"
INSTALLER_FILENAME   = "AIN53_Data_Management_Setup.exe"


# ---------------------------------------------------------------------------
# HELPERS
# ---------------------------------------------------------------------------

def _load_env_var(key: str, base_dir: Path) -> str | None:
    """Read a variable from .env file next to base_dir."""
    env_path = base_dir / ".env"
    if not env_path.exists():
        return None
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line.startswith(f"{key}="):
            return line[len(f"{key}="):].strip()
    return None


def parse_version_tuple(v_str: str) -> tuple:
    """
    Converts a version string like 'v1.0.14', '1.0.14', or 'v1.0.14-beta' into
    a comparable integer tuple.

    >>> parse_version_tuple('v1.0.14') == (1, 0, 14)
    True
    """
    try:
        clean = str(v_str).strip().lstrip("vV")
        nums  = [int(n) for n in re.findall(r"\d+", clean)]
        return tuple(nums) if nums else (0, 0, 0)
    except Exception:
        return (0, 0, 0)


def _format_bytes(b: int) -> str:
    if b >= 1_048_576:
        return f"{b / 1_048_576:.1f} MB"
    return f"{b / 1024:.1f} KB"


def _safe_remove_file(file_path: Path) -> bool:
    """Safely attempts to remove a file, clearing read-only attributes if present."""
    if not file_path.exists():
        return True
    try:
        os.chmod(file_path, 0o777)
    except Exception:
        pass

    for attempt in range(3):
        try:
            file_path.unlink()
            return True
        except OSError:
            time.sleep(0.2)
    return False


# ---------------------------------------------------------------------------
# HTTP UTILITIES
# ---------------------------------------------------------------------------

def _open_url(url: str, headers: dict | None = None, timeout: int = 30):
    """
    Opens a URL following 301/302/307/308 redirects recursively.
    Returns (final_response, final_url).
    Raises urllib.error.URLError on failure.
    """
    req_headers = {"User-Agent": "AIN53-Data-Management-Updater"}
    if headers:
        req_headers.update(headers)

    hops = 0
    current_url = url
    while hops < MAX_REDIRECTS:
        req = urllib.request.Request(current_url, headers=req_headers)
        try:
            # disable_redirects so we can inspect Location header ourselves
            response = urllib.request.urlopen(req, timeout=timeout)
            return response, current_url
        except urllib.error.HTTPError as exc:
            if exc.code in (301, 302, 307, 308):
                location = exc.headers.get("Location")
                if not location:
                    raise
                # Resolve relative redirects
                current_url = urllib.parse.urljoin(current_url, location)
                hops += 1
                continue
            raise
    raise RuntimeError(f"Too many redirects (>{MAX_REDIRECTS}) for {url}")


def _is_gdrive_html_page(data: bytes) -> bool:
    """Detect Google Drive virus-scan confirmation HTML page."""
    try:
        snippet = data[:4096].decode("utf-8", errors="ignore").lower()
        return "google" in snippet and ("virus scan warning" in snippet
                                        or "download anyway" in snippet
                                        or "confirm=" in snippet)
    except Exception:
        return False


def _extract_gdrive_confirm_url(data: bytes, original_url: str) -> str | None:
    """Extract the bypass URL containing confirm= token from GDrive HTML."""
    try:
        html = data[:32768].decode("utf-8", errors="ignore")
        # Pattern: href="...confirm=t..." or action="..." with confirm param
        m = re.search(r'href="(/uc\?[^"]*confirm=[^"]+)"', html)
        if m:
            path = m.group(1).replace("&amp;", "&")
            return "https://drive.google.com" + path
        m = re.search(r'"(https://drive\.google\.com/uc\?[^"]*confirm=[^"]+)"', html)
        if m:
            return m.group(1).replace("&amp;", "&")
    except Exception:
        pass
    return None


# ---------------------------------------------------------------------------
# MAIN CLASS
# ---------------------------------------------------------------------------

class AutoUpdater:
    def __init__(self, base_dir: Path | None = None):
        self.base_dir = Path(base_dir) if base_dir else Path(__file__).resolve().parent.parent
        self._window          = None
        self._is_downloading  = False
        self._cached_manifest = None   # Cached from last successful check

        # Resolve GitHub repo from .env or environment
        repo = _load_env_var("GITHUB_REPO", self.base_dir) or _load_env_var("Repo_name", self.base_dir) or os.environ.get("GITHUB_REPO") or DEFAULT_GITHUB_REPO
        repo = repo.strip().strip("'\"")
        if "/" not in repo:
            repo = f"BSFrameWorks5253/{repo}"
        self.github_repo = repo

        self.github_api_url  = f"https://api.github.com/repos/{self.github_repo}/releases/latest"
        self.raw_version_url = f"https://raw.githubusercontent.com/{self.github_repo}/main/version.txt"
        self.raw_setup_url   = f"https://github.com/{self.github_repo}/releases/latest/download/AIN53_Data_Management_Setup.exe"

        # Resolve GAS fallback URL from .env or environment
        gas_url = _load_env_var("UPDATE_WEB_APP_URL", self.base_dir) or os.environ.get("UPDATE_WEB_APP_URL") or DEFAULT_GAS_URL
        self.gas_fallback_url = gas_url.strip().strip("'\"")

    # ------------------------------------------------------------------
    # WINDOW REFERENCE
    # ------------------------------------------------------------------

    def set_window(self, window) -> None:
        """Propagate the active PyWebView window reference."""
        self._window = window

    # ------------------------------------------------------------------
    # SETTINGS STORE  (auto_check_updates toggle + app paths & config)
    # ------------------------------------------------------------------

    def _default_downloads_folder(self) -> str:
        base = os.environ.get("USERPROFILE", os.environ.get("HOME", str(Path.home())))
        path = Path(base) / "Downloads" / "AIN53_Workspace"
        try:
            path.mkdir(parents=True, exist_ok=True)
        except Exception:
            pass
        return str(path)

    def _settings_path(self) -> Path:
        if sys.platform == "darwin":
            settings_dir = Path.home() / "Library" / "Application Support" / "AIN53 Data Management"
        elif sys.platform == "win32":
            local_appdata = os.environ.get("LOCALAPPDATA", os.environ.get("APPDATA", str(Path.home())))
            settings_dir = Path(local_appdata) / "AIN53 Data Management"
        else:
            settings_dir = Path.home() / ".config" / "AIN53 Data Management"
        try:
            settings_dir.mkdir(parents=True, exist_ok=True)
        except Exception:
            pass
        return settings_dir / SETTINGS_FILENAME

    def _load_settings(self) -> dict:
        settings = {}
        try:
            base_settings = self.base_dir / SETTINGS_FILENAME
            if base_settings.exists():
                settings.update(json.loads(base_settings.read_text(encoding="utf-8")))
        except Exception:
            pass

        try:
            p = self._settings_path()
            if p.exists():
                local_s = json.loads(p.read_text(encoding="utf-8"))
                settings.update(local_s)
        except Exception:
            pass

        needs_save = False
        if not settings.get("pdf_output_folder"):
            settings["pdf_output_folder"] = self._default_downloads_folder()
            needs_save = True

        if settings.get("pdf_output_folder"):
            try:
                os.makedirs(settings["pdf_output_folder"], exist_ok=True)
            except Exception:
                pass

        if needs_save:
            self._save_settings(settings)

        return settings

    def _save_settings(self, settings: dict) -> None:
        try:
            self._settings_path().write_text(
                json.dumps(settings, indent=2), encoding="utf-8"
            )
        except Exception as e:
            print(f"[Updater] Could not save settings to localappdata: {e}")
        try:
            base_settings = self.base_dir / SETTINGS_FILENAME
            if base_settings.exists() or not self._settings_path().exists():
                base_settings.write_text(
                    json.dumps(settings, indent=2), encoding="utf-8"
                )
        except Exception:
            pass

    def get_all_settings(self) -> str:
        """Returns all persisted settings as a JSON object string."""
        return json.dumps(self._load_settings())

    def get_setting(self, key: str) -> str:
        """Returns a setting value as JSON string. Used by frontend."""
        val = self._load_settings().get(key)
        return json.dumps({"key": key, "value": val})

    def set_setting(self, key: str, value) -> str:
        """Persists a single setting. Used by frontend."""
        settings = self._load_settings()
        settings[key] = value
        self._save_settings(settings)
        return json.dumps({"success": True, "key": key, "value": value})

    def set_settings(self, new_settings: dict | str) -> str:
        """Persists multiple settings at once."""
        if isinstance(new_settings, str):
            try:
                new_settings = json.loads(new_settings)
            except Exception:
                new_settings = {}
        settings = self._load_settings()
        if isinstance(new_settings, dict):
            settings.update(new_settings)
            self._save_settings(settings)
        return json.dumps({"success": True})

    def select_downloads_folder(self, callback_id: str = "") -> str:
        """
        Opens native directory picker in a background thread with Tkinter fallback
        to avoid blocking the PyWebView UI event loop. Result is pushed back to JS
        via window.onFolderSelected(path, callbackId) using evaluate_js.
        """
        def _dialog_worker():
            folder_path = None
            # 1. Try PyWebView file dialog if window is active
            if self._window:
                try:
                    result = self._window.create_file_dialog(webview.FileDialog.FOLDER)
                    if result:
                        folder_path = result[0] if isinstance(result, (list, tuple)) else result
                except Exception as e:
                    print(f"[Updater] PyWebView create_file_dialog notice: {e}")

            # 2. Fallback to Tkinter folder dialog if pywebview was cancelled or threw an error
            if not folder_path or not os.path.isdir(str(folder_path)):
                try:
                    import tkinter as tk
                    from tkinter import filedialog
                    root = tk.Tk()
                    root.withdraw()
                    root.attributes('-topmost', True)
                    selected = filedialog.askdirectory(title="Select Working & Temporary Downloads Directory")
                    root.destroy()
                    if selected and os.path.isdir(selected):
                        folder_path = selected
                except Exception as ex:
                    print(f"[Updater] Tkinter dialog fallback notice: {ex}")

            safe_id = str(callback_id or "").replace("'", "\\'")

            if folder_path and os.path.isdir(str(folder_path)):
                chosen_dir = Path(folder_path).resolve()
                if chosen_dir.name.lower() != "ain53_workspace":
                    workspace_dir = chosen_dir / "AIN53_Workspace"
                else:
                    workspace_dir = chosen_dir

                try:
                    workspace_dir.mkdir(parents=True, exist_ok=True)
                except Exception as dir_err:
                    print(f"[Updater] Could not create AIN53_Workspace subfolder: {dir_err}")
                    workspace_dir = chosen_dir

                folder_str = str(workspace_dir)
                settings = self._load_settings()
                settings["pdf_output_folder"] = folder_str
                settings["workspace_configured"] = True
                settings["workspace_setup_dismissed"] = True
                self._save_settings(settings)

                safe_path = folder_str.replace("\\", "\\\\").replace("'", "\\'")
                if self._window:
                    js = (
                        f"if (typeof window.onFolderSelected === 'function') "
                        f"window.onFolderSelected('{safe_path}', '{safe_id}');"
                    )
                    try:
                        self._window.evaluate_js(js)
                    except Exception:
                        pass
                return

            # Cancelled / No directory selected
            if self._window:
                try:
                    self._window.evaluate_js(
                        f"if (typeof window.onFolderSelected === 'function') "
                        f"window.onFolderSelected('', '{safe_id}');"
                    )
                except Exception:
                    pass

        t = threading.Thread(target=_dialog_worker, daemon=True, name="folder-dialog")
        t.start()
        return json.dumps({"status": "pending"})

    # ------------------------------------------------------------------
    # LOCAL VERSION
    # ------------------------------------------------------------------

    def get_local_version(self) -> str:
        """Reads local version from version.txt."""
        p = self.base_dir / "version.txt"
        if p.exists():
            return p.read_text(encoding="utf-8").strip()
        return "1.0.0"

    # ------------------------------------------------------------------
    # STAGE 1 — STARTUP AUTO-CHECK GATE
    # ------------------------------------------------------------------

    def should_auto_check(self) -> bool:
        """
        Returns True if auto_check_updates is enabled.
        Default is True (first run / undefined).
        """
        settings = self._load_settings()
        val = settings.get("auto_check_updates")
        if val is None:
            return True  # Default: enabled
        return bool(val)

    # ------------------------------------------------------------------
    # STAGE 2/3 — VERSION CHECK (GitHub API → GAS fallback)
    # ------------------------------------------------------------------

    def check_for_updates(self) -> str:
        """
        Queries GitHub Releases API for the latest release (Priority A).
        Falls back to Google Apps Script manifest (Priority B) if GitHub fails.

        Returns JSON: { success, data: { update_available, current_version,
                        latest_version, download_url, release_notes,
                        release_name, html_url, checksum? } }
        """
        current_version = self.get_local_version()
        current_tuple   = parse_version_tuple(current_version)

        update_info = {
            "update_available" : False,
            "current_version"  : current_version,
            "latest_version"   : current_version,
            "download_url"     : "",
            "release_notes"    : "",
            "release_name"     : "",
            "checksum"         : "",
            "html_url"         : f"https://github.com/{self.github_repo}",
        }

        # ── Priority A: GitHub Releases API ─────────────────────────────
        try:
            response, _ = _open_url(self.github_api_url, timeout=8)
            data        = json.loads(response.read().decode("utf-8"))
            tag_name    = data.get("tag_name", "")
            latest_tuple = parse_version_tuple(tag_name)

            update_info["latest_version"] = tag_name.lstrip("vV")
            update_info["release_notes"]  = data.get("body", "Bug fixes and performance improvements.")
            update_info["release_name"]   = data.get("name", f"Release {tag_name}")
            update_info["html_url"]       = data.get("html_url", update_info["html_url"])

            # Smart Asset Selection:
            # Differentiate between Portable vs Setup builds so colleagues running
            # installed setup builds get Setup.exe (installer) rather than Portable.exe.
            is_portable_app = "portable" in Path(sys.executable).stem.lower()
            assets = data.get("assets", [])

            selected_url = ""
            selected_checksum = ""

            if sys.platform == "darwin":
                import platform
                arch = platform.machine().lower()
                is_arm = "arm" in arch or "aarch64" in arch
                target_token = "apple_silicon" if is_arm else "intel"
                avoid_token = "intel" if is_arm else "apple_silicon"

                # 1. Primary match: DMG matching architecture
                for asset in assets:
                    name = asset.get("name", "").lower()
                    if name.endswith(".dmg"):
                        if target_token in name:
                            selected_url = asset.get("browser_download_url", "")
                            selected_checksum = asset.get("digest", "") or asset.get("sha256", "")
                            break

                # 2. Secondary match: Any DMG that does not target the other arch
                if not selected_url:
                    for asset in assets:
                        name = asset.get("name", "").lower()
                        if name.endswith(".dmg"):
                            if avoid_token not in name:
                                selected_url = asset.get("browser_download_url", "")
                                selected_checksum = asset.get("digest", "") or asset.get("sha256", "")
                                break

                # 3. Fallback: Any .dmg asset
                if not selected_url:
                    for asset in assets:
                        name = asset.get("name", "").lower()
                        if name.endswith(".dmg"):
                            selected_url = asset.get("browser_download_url", "")
                            selected_checksum = asset.get("digest", "") or asset.get("sha256", "")
                            break
            else:
                if is_portable_app:
                    for asset in assets:
                        name = asset.get("name", "").lower()
                        if "portable" in name and name.endswith(".exe"):
                            selected_url = asset.get("browser_download_url", "")
                            selected_checksum = asset.get("digest", "") or asset.get("sha256", "")
                            break

                if not selected_url:
                    # Setup installer preferred for standard installations
                    for asset in assets:
                        name = asset.get("name", "").lower()
                        if ("setup" in name or "installer" in name) and name.endswith(".exe"):
                            selected_url = asset.get("browser_download_url", "")
                            selected_checksum = asset.get("digest", "") or asset.get("sha256", "")
                            break

                if not selected_url:
                    # Fallback: Any non-portable .exe
                    for asset in assets:
                        name = asset.get("name", "").lower()
                        if name.endswith(".exe") and "portable" not in name:
                            selected_url = asset.get("browser_download_url", "")
                            selected_checksum = asset.get("digest", "") or asset.get("sha256", "")
                            break

                if not selected_url:
                    # Fallback: Any .exe
                    for asset in assets:
                        name = asset.get("name", "").lower()
                        if name.endswith(".exe"):
                            selected_url = asset.get("browser_download_url", "")
                            selected_checksum = asset.get("digest", "") or asset.get("sha256", "")
                            break

            if not selected_url and assets:
                selected_url = assets[0].get("browser_download_url", "")

            update_info["download_url"] = selected_url
            update_info["checksum"]     = selected_checksum

            if latest_tuple > current_tuple:
                update_info["update_available"] = True

            self._cached_manifest = update_info
            return json.dumps({"success": True, "data": update_info})

        except Exception as e:
            print(f"[Updater] GitHub API failed, trying fallback: {e}")

        # ── Priority B: Google Apps Script fallback ──────────────────────
        gas_url = self.gas_fallback_url
        if gas_url:
            try:
                query_url = f"{gas_url}?api=manifest&currentVersion={current_version}"
                response, _ = _open_url(query_url, timeout=8)
                manifest = json.loads(response.read().decode("utf-8"))

                remote_ver   = manifest.get("latest_version", "")
                latest_tuple = parse_version_tuple(remote_ver)

                update_info["latest_version"] = remote_ver
                update_info["release_notes"]  = manifest.get("release_notes", "Update available.")
                update_info["release_name"]   = manifest.get("release_name", f"Release {remote_ver}")
                update_info["download_url"]   = manifest.get("download_url", self.raw_setup_url)
                update_info["checksum"]       = manifest.get("checksum", "")

                if latest_tuple > current_tuple:
                    update_info["update_available"] = True

                self._cached_manifest = update_info
                return json.dumps({"success": True, "data": update_info})

            except Exception as ex:
                print(f"[Updater] GAS fallback failed: {ex}")

        # ── Final fallback: raw version.txt on GitHub ────────────────────
        try:
            response, _ = _open_url(self.raw_version_url, timeout=5)
            remote_ver   = response.read().decode("utf-8").strip()
            latest_tuple = parse_version_tuple(remote_ver)

            if latest_tuple > current_tuple:
                update_info["update_available"] = True
                update_info["latest_version"]  = remote_ver
                update_info["release_notes"]   = "New version available from GitHub repository."
                update_info["download_url"]    = self.raw_setup_url

        except Exception as ex:
            print(f"[Updater] Raw version.txt fallback failed: {ex}")

        self._cached_manifest = update_info
        return json.dumps({"success": True, "data": update_info})

    def check_for_updates_async(self) -> str:
        """
        Non-blocking version of check_for_updates() for JS-triggered manual checks.

        PROBLEM SOLVED: check_for_updates() can block for up to 21 seconds (3 fallback
        HTTP requests at 8+8+5 second timeouts). When JS awaits this via PyWebView's
        API bridge on Windows, the webview's return-value marshaling can freeze the
        entire UI window until the Python function returns.

        SOLUTION: Return {"status": "pending"} immediately so the JS await resolves
        at once. The actual check runs in a daemon thread and pushes its result back
        via window.onUpdateCheckResult(result) using evaluate_js — identical to how
        silent_check_and_push works.

        JS must register window.onUpdateCheckResult to handle the pushed result.
        """
        def _worker():
            try:
                raw = self.check_for_updates()
                res = json.loads(raw)
                if self._window:
                    # Use json.dumps to safely escape the entire payload
                    safe_json = json.dumps(json.dumps(res))  # double-encode: outer for JS string
                    js = (
                        f"if (typeof window.onUpdateCheckResult === 'function') {{"
                        f"  try {{"
                        f"    window.onUpdateCheckResult(JSON.parse({safe_json}));"
                        f"  }} catch(e) {{ console.error('[Updater] onUpdateCheckResult parse error', e); }}"
                        f"}}"
                    )
                    try:
                        self._window.evaluate_js(js)
                    except Exception as ex:
                        print(f"[Updater] check_for_updates_async push failed: {ex}")
            except Exception as ex:
                print(f"[Updater] check_for_updates_async worker error: {ex}")
                if self._window:
                    err_payload = json.dumps(json.dumps({"success": False, "error": str(ex)}))
                    try:
                        self._window.evaluate_js(
                            f"if (typeof window.onUpdateCheckResult === 'function') {{"
                            f"  try {{ window.onUpdateCheckResult(JSON.parse({err_payload})); }}"
                            f"  catch(e) {{}} }}"
                        )
                    except Exception:
                        pass

        t = threading.Thread(target=_worker, daemon=True, name="updater-check-async")
        t.start()
        return json.dumps({"status": "pending"})

    # ------------------------------------------------------------------
    # STAGE 4 — PUSH MODEL: notify renderer passively
    # ------------------------------------------------------------------

    def _push_update_available(self, manifest: dict) -> None:
        """
        Called after a successful silent check that finds a newer version.
        Pushes the update event to the JS renderer via window.onUpdateAvailable().
        This is the push model — the renderer reacts passively without polling.
        """
        if not self._window:
            return
        try:
            safe_json = json.dumps(manifest).replace("\\", "\\\\").replace("'", "\\'")
            js = f"if (typeof window.onUpdateAvailable === 'function') window.onUpdateAvailable({safe_json});"
            self._window.evaluate_js(js)
        except Exception as e:
            print(f"[Updater] Push onUpdateAvailable failed: {e}")

    def silent_check_and_push(self) -> None:
        """
        Performs the startup silent update check in a background thread.
        Respects the auto_check_updates setting.
        If an update is found, pushes window.onUpdateAvailable() to the renderer.
        This is silent and non-blocking — errors are swallowed.
        """
        if not self.should_auto_check():
            print("[Updater] Auto-check disabled by user setting — skipping.")
            return

        def _worker():
            try:
                raw = self.check_for_updates()
                res = json.loads(raw)
                if res.get("success") and res.get("data", {}).get("update_available"):
                    self._push_update_available(res["data"])
            except Exception as ex:
                print(f"[Updater] Silent check error (non-fatal): {ex}")

        t = threading.Thread(target=_worker, daemon=True, name="updater-silent-check")
        t.start()

    # ------------------------------------------------------------------
    # STAGE 3 — DOWNLOAD & INSTALL TRIGGER
    # ------------------------------------------------------------------

    def apply_update_now(self) -> str:
        """
        Launches the downloaded installer binary and terminates current application process.
        Matches the exact installation launching strategy from One Tap V20.6.5.
        """
        temp_dir = Path(tempfile.gettempdir()) / INSTALLER_SUBDIR

        if sys.platform == "darwin":
            dmg_files = [p for p in temp_dir.glob("*.dmg") if not p.name.endswith(".part")]
            if not dmg_files:
                dmg_files = [p for p in Path(tempfile.gettempdir()).glob("*.dmg") if not p.name.endswith(".part")]
            if dmg_files:
                dmg_files.sort(key=lambda p: p.stat().st_mtime, reverse=True)
                installer_path = dmg_files[0]
                try:
                    print(f"[Updater] Launching macOS update from DMG: {installer_path}")
                    self._launch_mac_installer(installer_path)
                    return json.dumps({"success": True})
                except Exception as e:
                    print(f"[Updater] Error applying macOS update: {e}")
                    return json.dumps({"error": f"Failed to apply macOS update: {e}"})

        executables = [p for p in temp_dir.glob("*.exe") if not p.name.endswith(".part")]

        if not executables:
            # Fallback search in root temp directory for setup binaries
            root_temp = Path(tempfile.gettempdir())
            for candidate_name in ["AIN53_Data_Management_Setup.exe", "unidesk_setup_latest.exe", "onetap_setup_latest.exe"]:
                candidate = root_temp / candidate_name
                if candidate.exists():
                    executables.append(candidate)
                    
            if not executables:
                executables = [p for p in root_temp.glob("*setup*.exe") if not p.name.endswith(".part")]

        if executables:
            executables.sort(key=lambda p: p.stat().st_mtime, reverse=True)
            installer_path = executables[0]
            try:
                print(f"[Updater] Spawning update setup in background: {installer_path}")
                self._launch_installer(installer_path)
                return json.dumps({"success": True})
            except Exception as e:
                print(f"[Updater] Error spawning installer: {e}")
                return json.dumps({"error": f"Failed to launch installer: {e}"})

        return json.dumps({"error": "Downloaded update installer executable missing or not found. Please retry download."})

    def download_and_install_update(self, download_url: str = "") -> str:
        """
        Spawns a background thread to download the setup installer with real-time
        progress events throttled to 350 ms intervals.
        """
        if self._is_downloading:
            return json.dumps({"error": "Download already in progress"})

        if not download_url and self._cached_manifest:
            download_url = self._cached_manifest.get("download_url", "")
        if not download_url:
            download_url = self.raw_setup_url

        checksum = ""
        if self._cached_manifest:
            checksum = self._cached_manifest.get("checksum", "")

        self._is_downloading = True
        t = threading.Thread(
            target=self._download_worker,
            args=(download_url, checksum),
            daemon=True,
            name="updater-download"
        )
        t.start()
        return json.dumps({"success": True, "message": "Download started"})

        temp_dir       = Path(tempfile.gettempdir()) / INSTALLER_SUBDIR
        if sys.platform == "darwin":
            installer_name = "AIN53_Data_Management_Setup.dmg"
        else:
            installer_name = INSTALLER_FILENAME
        part_path      = temp_dir / (installer_name + ".part")
        installer_path = temp_dir / installer_name

        try:
            temp_dir.mkdir(parents=True, exist_ok=True)

            print(f"[Updater] Downloading: {download_url} -> {part_path}")

            # ── Resolve final download URL (follow redirects + GDrive bypass) ──
            final_url      = download_url
            response, final_url = _open_url(final_url, timeout=30)

            # Detect Google Drive confirmation HTML page
            first_chunk = response.read(8192)
            if _is_gdrive_html_page(first_chunk):
                bypass_url = _extract_gdrive_confirm_url(first_chunk, final_url)
                if bypass_url:
                    print(f"[Updater] GDrive virus-scan page detected, retrying with bypass URL.")
                    response, final_url = _open_url(bypass_url, timeout=30)
                    first_chunk = response.read(8192)
                else:
                    raise RuntimeError("Google Drive returned a confirmation page but bypass URL could not be extracted.")

            total_bytes     = int(response.getheader("Content-Length") or 0)
            downloaded_bytes = len(first_chunk)
            block_size       = 65536
            sha256_hash      = hashlib.sha256()
            sha256_hash.update(first_chunk)

            start_time        = time.time()
            last_emit_time    = 0.0

            def _emit_progress(pct: int, dl: int, total: int, speed_kb: float) -> None:
                """Fire progress callback to frontend webview."""
                if not self._window:
                    return
                js = (
                    f"if (typeof window.onUpdateDownloadProgress === 'function') "
                    f"window.onUpdateDownloadProgress({pct}, {dl}, {total}, {speed_kb:.1f});"
                )
                try:
                    self._window.evaluate_js(js)
                except Exception:
                    pass

            # Write .part file
            with open(part_path, "wb") as f:
                f.write(first_chunk)

                while True:
                    buffer = response.read(block_size)
                    if not buffer:
                        break
                    f.write(buffer)
                    sha256_hash.update(buffer)
                    downloaded_bytes += len(buffer)

                    now     = time.time()
                    elapsed = max(now - start_time, 0.001)
                    speed_kb = (downloaded_bytes / 1024) / elapsed

                    # ── Throttle progress emit to 350 ms ──
                    if (now - last_emit_time) >= PROGRESS_THROTTLE_S:
                        pct = int((downloaded_bytes / total_bytes) * 100) if total_bytes > 0 else 50
                        _emit_progress(pct, downloaded_bytes, total_bytes, speed_kb)
                        last_emit_time = now

            # ── Size verification ────────────────────────────────────────────
            if total_bytes > 0 and downloaded_bytes < total_bytes:
                raise RuntimeError(
                    f"Download incomplete: got {_format_bytes(downloaded_bytes)} "
                    f"but expected {_format_bytes(total_bytes)}."
                )

            # ── SHA-256 checksum verification ────────────────────────────────
            if expected_checksum:
                # Normalize: GitHub sends "sha256:abcdef...", strip prefix
                norm_expected = re.sub(r"^sha256:", "", expected_checksum, flags=re.I).lower()
                computed      = sha256_hash.hexdigest().lower()
                if norm_expected and computed != norm_expected:
                    raise RuntimeError(
                        f"Checksum mismatch! Expected {norm_expected[:16]}… "
                        f"got {computed[:16]}…"
                    )
                print(f"[Updater] SHA-256 checksum verified OK")

            # ── Rename .part -> .exe / .dmg ──────────────────────────────────
            _safe_remove_file(installer_path)
            try:
                os.replace(part_path, installer_path)
            except OSError as replace_err:
                ext = ".dmg" if sys.platform == "darwin" else ".exe"
                fallback_name = f"AIN53_Data_Management_Setup_{int(time.time())}{ext}"
                fallback_installer_path = temp_dir / fallback_name
                print(f"[Updater] File lock on target ({replace_err}). Saving to fallback: {fallback_installer_path}")
                os.replace(part_path, fallback_installer_path)
                installer_path = fallback_installer_path

            print(f"[Updater] Download complete -> {installer_path}")

            # ── Remove Mark of the Web (Zone.Identifier) ────────────────────
            try:
                if sys.platform == "win32":
                    subprocess.run(
                        ["powershell", "-Command",
                         f"Unblock-File -Path '{installer_path.as_posix()}'"],
                        capture_output=True,
                        creationflags=subprocess.CREATE_NO_WINDOW
                    )
            except Exception as unblock_err:
                print(f"[Updater] Unblock-File warning (non-fatal): {unblock_err}")

            # ── Emit 100% completion ─────────────────────────────────────────
            elapsed   = max(time.time() - start_time, 0.001)
            speed_kb  = (downloaded_bytes / 1024) / elapsed
            _emit_progress(100, downloaded_bytes, downloaded_bytes, speed_kb)

            # ── Notify frontend: download ready ─────────────────────────────
            current_pid = os.getpid()
            if self._window:
                safe_path = installer_path.as_posix().replace("'", "\\'")
                js = (
                    f"if (typeof window.onUpdateReadyToInstall === 'function') "
                    f"window.onUpdateReadyToInstall('{safe_path}', {current_pid});"
                )
                try:
                    self._window.evaluate_js(js)
                except Exception:
                    pass

            self._is_downloading = False

        except Exception as e:
            self._is_downloading = False
            # Clean up incomplete .part file safely
            _safe_remove_file(part_path)
            err_msg = str(e).replace("'", "\\'")
            print(f"[Updater] Download error: {e}")
            if self._window:
                try:
                    js = (
                        f"if (typeof window.onUpdateError === 'function') "
                        f"window.onUpdateError('{err_msg}');"
                    )
                    self._window.evaluate_js(js)
                except Exception:
                    pass

    # ------------------------------------------------------------------
    # STAGE 3 — INSTALL LAUNCHER
    # ------------------------------------------------------------------

    def _launch_installer(self, installer_path: Path) -> None:
        """
        Spawns the installer with --update --wait-pid <current_pid> --dest <target_dest>
        as a visible process, closes active window handles, and exits current process cleanly.
        """
        current_pid = os.getpid()

        # ── Destination: always use the user-writable LocalAppData path ──────────────
        # NEVER pass the current EXE's parent directory as --dest when frozen, because
        # that directory may be inside Program Files and requires admin elevation.
        # The installer's own default_dir is LOCALAPPDATA\Programs\AIN53 Data Management,
        # so we match that here for a consistent, permission-free update target.
        local_appdata = os.environ.get("LOCALAPPDATA", os.path.expanduser("~\\AppData\\Local"))
        target_dest = os.path.join(local_appdata, "Programs", "AIN53 Data Management")

        cmd = [
            str(installer_path),
            "--update",
            "--wait-pid", str(current_pid),
            "--dest", target_dest
        ]

        print(f"[Updater] Launching update installer GUI: {' '.join(cmd)}")

        # Destroy active PyWebView window handle to release UI resources & file locks immediately
        if self._window:
            try:
                self._window.destroy()
            except Exception:
                pass

        subprocess.Popen(
            cmd,
            close_fds=True,
        )

        # Allow installer process to detach completely
        time.sleep(0.3)

        # Forcefully exit process completely to release executable file locks
        os._exit(0)

    def _launch_mac_installer(self, dmg_path: Path) -> None:
        """
        Mounts the DMG silently on macOS, extracts the .app bundle, writes a small
        detached helper script to replace the application in /Applications and relaunch it,
        then terminates the running application process cleanly.
        """
        res = subprocess.run(
            ["hdiutil", "attach", "-nobrowse", "-readonly", str(dmg_path)],
            capture_output=True,
            text=True
        )
        if res.returncode != 0:
            raise RuntimeError(f"Failed to mount DMG ({dmg_path.name}): {res.stderr}")

        mount_point = None
        for line in res.stdout.splitlines():
            if "/Volumes/" in line:
                mount_point = line[line.find("/Volumes/"):].strip()
                break

        if not mount_point or not os.path.exists(mount_point):
            raise RuntimeError(f"Could not find volume mount point for DMG {dmg_path.name}")

        app_bundles = list(Path(mount_point).glob("*.app"))
        if not app_bundles:
            subprocess.run(["hdiutil", "detach", mount_point], capture_output=True)
            raise RuntimeError("No .app bundle found inside mounted DMG.")

        source_app = app_bundles[0]
        target_dir = Path("/Applications")
        if not os.access(target_dir, os.W_OK):
            target_dir = Path.home() / "Applications"
            target_dir.mkdir(parents=True, exist_ok=True)

        target_app = target_dir / source_app.name
        current_pid = os.getpid()

        updater_script_content = f"""#!/bin/bash
# Wait for main Python process to exit
while kill -0 {current_pid} 2>/dev/null; do
    sleep 0.3
done

# Replace current application bundle
rm -rf "{target_app}"
cp -R "{source_app}" "{target_dir}/"

# Detach DMG volume
hdiutil detach "{mount_point}" -force 2>/dev/null || true

# Relaunch updated application
open -n "{target_app}"
"""
        script_path = dmg_path.parent / "mac_update_installer.sh"
        script_path.write_text(updater_script_content, encoding="utf-8")
        os.chmod(script_path, 0o755)

        # Launch background shell script detached
        subprocess.Popen(["/bin/bash", str(script_path)], start_new_session=True)

        if self._window:
            try:
                self._window.destroy()
            except Exception:
                pass

        time.sleep(0.5)
        os._exit(0)

