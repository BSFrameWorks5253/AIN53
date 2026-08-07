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
# CONFIGURATION
# ---------------------------------------------------------------------------
GITHUB_REPO          = "BSFrameWorks5253/AIN53"
GITHUB_API_URL       = f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest"
RAW_VERSION_URL      = f"https://raw.githubusercontent.com/{GITHUB_REPO}/main/version.txt"
RAW_SETUP_URL        = f"https://github.com/{GITHUB_REPO}/releases/latest/download/AIN53_Data_Management_Setup.exe"

# Google Apps Script fallback — reads UPDATE_WEB_APP_URL from .env if present
_GAS_FALLBACK_URL    = None

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

        # Load optional GAS fallback URL from .env
        global _GAS_FALLBACK_URL
        if _GAS_FALLBACK_URL is None:
            _GAS_FALLBACK_URL = _load_env_var("UPDATE_WEB_APP_URL", self.base_dir) or ""

    # ------------------------------------------------------------------
    # WINDOW REFERENCE
    # ------------------------------------------------------------------

    def set_window(self, window) -> None:
        """Propagate the active PyWebView window reference."""
        self._window = window

    # ------------------------------------------------------------------
    # SETTINGS STORE  (auto_check_updates toggle + future settings)
    # ------------------------------------------------------------------

    # ------------------------------------------------------------------
    # SETTINGS STORE  (auto_check_updates toggle + future settings)
    # ------------------------------------------------------------------

    def _settings_path(self) -> Path:
        local_appdata = os.environ.get("LOCALAPPDATA", os.environ.get("APPDATA", str(Path.home())))
        settings_dir = Path(local_appdata) / "AIN53 Data Management"
        try:
            settings_dir.mkdir(parents=True, exist_ok=True)
        except Exception:
            pass
        return settings_dir / SETTINGS_FILENAME

    def _load_settings(self) -> dict:
        try:
            p = self._settings_path()
            if p.exists():
                return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            pass
        return {}

    def _save_settings(self, settings: dict) -> None:
        try:
            self._settings_path().write_text(
                json.dumps(settings, indent=2), encoding="utf-8"
            )
        except Exception as e:
            print(f"[Updater] Could not save settings: {e}")

    def get_setting(self, key: str) -> str:
        """Returns a setting value as JSON string. Used by frontend."""
        val = self._load_settings().get(key)
        return json.dumps({"key": key, "value": val})

    def set_setting(self, key: str, value) -> str:
        """Persists a setting. Used by frontend."""
        settings = self._load_settings()
        settings[key] = value
        self._save_settings(settings)
        return json.dumps({"success": True})

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
            "html_url"         : f"https://github.com/{GITHUB_REPO}",
        }

        # ── Priority A: GitHub Releases API ─────────────────────────────
        try:
            response, _ = _open_url(GITHUB_API_URL, timeout=8)
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
        gas_url = _GAS_FALLBACK_URL
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
                update_info["download_url"]   = manifest.get("download_url", RAW_SETUP_URL)
                update_info["checksum"]       = manifest.get("checksum", "")

                if latest_tuple > current_tuple:
                    update_info["update_available"] = True

                self._cached_manifest = update_info
                return json.dumps({"success": True, "data": update_info})

            except Exception as ex:
                print(f"[Updater] GAS fallback failed: {ex}")

        # ── Final fallback: raw version.txt on GitHub ────────────────────
        try:
            response, _ = _open_url(RAW_VERSION_URL, timeout=5)
            remote_ver   = response.read().decode("utf-8").strip()
            latest_tuple = parse_version_tuple(remote_ver)

            if latest_tuple > current_tuple:
                update_info["update_available"] = True
                update_info["latest_version"]  = remote_ver
                update_info["release_notes"]   = "New version available from GitHub repository."
                update_info["download_url"]    = RAW_SETUP_URL

        except Exception as ex:
            print(f"[Updater] Raw version.txt fallback failed: {ex}")

        self._cached_manifest = update_info
        return json.dumps({"success": True, "data": update_info})

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
        """
        temp_dir = Path(tempfile.gettempdir()) / INSTALLER_SUBDIR
        installer_path = temp_dir / INSTALLER_FILENAME
        if installer_path.exists():
            try:
                self._launch_installer(installer_path)
                return json.dumps({"success": True})
            except Exception as e:
                return json.dumps({"error": f"Failed to launch installer: {e}"})
        return json.dumps({"error": "Downloaded update installer not found. Please retry download."})

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
            download_url = RAW_SETUP_URL

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

    def _download_worker(self, download_url: str, expected_checksum: str = "") -> None:
        temp_dir       = Path(tempfile.gettempdir()) / INSTALLER_SUBDIR
        part_path      = temp_dir / (INSTALLER_FILENAME + ".part")
        installer_path = temp_dir / INSTALLER_FILENAME

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

            # ── Rename .part -> .exe ─────────────────────────────────────────
            if installer_path.exists():
                installer_path.unlink()
            part_path.rename(installer_path)
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
            # Clean up incomplete .part file
            try:
                if part_path.exists():
                    part_path.unlink()
            except Exception:
                pass
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
        Spawns the installer with --silent --update --wait-pid <current_pid> --dest <target_dest>
        as a fully detached background process, then exits current process cleanly.
        """
        current_pid = os.getpid()
        if getattr(sys, 'frozen', False):
            target_dest = str(Path(sys.executable).parent)
        else:
            local_appdata = os.environ.get("LOCALAPPDATA", os.path.expanduser("~\\AppData\\Local"))
            target_dest = os.path.join(local_appdata, "Programs", "AIN53 Data Management")

        cmd = [
            str(installer_path),
            "--silent",
            "--update",
            "--wait-pid", str(current_pid),
            "--dest", target_dest
        ]
        
        print(f"[Updater] Launching silent update: {' '.join(cmd)}")

        startupinfo = None
        creationflags = 0
        if sys.platform == "win32":
            startupinfo = subprocess.STARTUPINFO()
            startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            startupinfo.wShowWindow = subprocess.SW_HIDE
            creationflags = subprocess.CREATE_NO_WINDOW | subprocess.DETACHED_PROCESS

        subprocess.Popen(
            cmd,
            startupinfo=startupinfo,
            creationflags=creationflags,
            close_fds=True,
        )

        # Brief delay to allow installer process to spawn before exit
        time.sleep(0.3)

        # Exit current app to release file locks so installer can overwrite
        os._exit(0)
