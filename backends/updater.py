"""
AIN53 Data Management - Auto Update Engine
===========================================

This module handles non-blocking GitHub release checking, background asset downloading
with real-time progress callbacks to the UI, and silent background installer execution.

GitHub Repository: https://github.com/BSFrameWorks5253/AIN53.git
"""

import os
import sys
import json
import time
import urllib.request
import urllib.error
import subprocess
import threading
from pathlib import Path

GITHUB_REPO = "BSFrameWorks5253/AIN53"
GITHUB_API_URL = f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest"
RAW_VERSION_URL = f"https://raw.githubusercontent.com/{GITHUB_REPO}/main/version.txt"
RAW_SETUP_URL = f"https://github.com/{GITHUB_REPO}/releases/latest/download/AIN53_Data_Management_Setup.exe"

import re

def parse_version_tuple(v_str):
    """Converts a version string like 'v1.0.14', '1.0.14', or 'v1.0.14-beta' into integer tuple."""
    try:
        clean_str = str(v_str).strip().lstrip('vV')
        nums = [int(n) for n in re.findall(r'\d+', clean_str)]
        return tuple(nums) if nums else (0, 0, 0)
    except Exception:
        return (0, 0, 0)

class AutoUpdater:
    def __init__(self, base_dir=None):
        self.base_dir = Path(base_dir) if base_dir else Path(__file__).resolve().parent.parent
        self._window = None
        self._is_downloading = False

    def set_window(self, window):
        self._window = window

    def get_local_version(self):
        """Reads local version from version.txt."""
        version_file = self.base_dir / "version.txt"
        if version_file.exists():
            return version_file.read_text().strip()
        return "1.0.0"

    def check_for_updates(self):
        """
        Queries GitHub API (and fallback raw endpoint) for the latest release.
        Returns a dict: { update_available, current_version, latest_version, download_url, release_notes, html_url }
        """
        current_version = self.get_local_version()
        current_tuple = parse_version_tuple(current_version)

        update_info = {
            "update_available": False,
            "current_version": current_version,
            "latest_version": current_version,
            "download_url": "",
            "release_notes": "",
            "release_name": "",
            "html_url": f"https://github.com/{GITHUB_REPO}"
        }

        # 1. Try GitHub API
        try:
            req = urllib.request.Request(
                GITHUB_API_URL,
                headers={"User-Agent": "AIN53-Data-Management-Updater"}
            )
            with urllib.request.urlopen(req, timeout=8) as response:
                data = json.loads(response.read().decode('utf-8'))
                tag_name = data.get("tag_name", "")
                latest_tuple = parse_version_tuple(tag_name)

                update_info["latest_version"] = tag_name.lstrip('vV')
                update_info["release_notes"] = data.get("body", "Bug fixes and performance improvements.")
                update_info["release_name"] = data.get("name", f"Release {tag_name}")
                update_info["html_url"] = data.get("html_url", update_info["html_url"])

                # Find binary asset (prefer .exe installers over .zip archives)
                assets = data.get("assets", [])
                for asset in assets:
                    name = asset.get("name", "").lower()
                    if name.endswith(".exe"):
                        update_info["download_url"] = asset.get("browser_download_url", "")
                        break
                
                if not update_info["download_url"]:
                    for asset in assets:
                        name = asset.get("name", "").lower()
                        if name.endswith(".zip"):
                            update_info["download_url"] = asset.get("browser_download_url", "")
                            break
                
                if not update_info["download_url"] and assets:
                    update_info["download_url"] = assets[0].get("browser_download_url", "")

                if latest_tuple > current_tuple:
                    update_info["update_available"] = True
                
                return json.dumps({"success": True, "data": update_info})

        except Exception as e:
            print(f"[Updater] GitHub API query failed/fallback: {e}")

        # 2. Fallback to raw github version.txt check
        try:
            req = urllib.request.Request(
                RAW_VERSION_URL,
                headers={"User-Agent": "AIN53-Data-Management-Updater"}
            )
            with urllib.request.urlopen(req, timeout=5) as response:
                remote_ver = response.read().decode('utf-8').strip()
                latest_tuple = parse_version_tuple(remote_ver)

                if latest_tuple > current_tuple:
                    update_info["update_available"] = True
                    update_info["latest_version"] = remote_ver
                    update_info["release_notes"] = "New version available from GitHub repository."
                    if not update_info["download_url"]:
                        update_info["download_url"] = RAW_SETUP_URL
                    return json.dumps({"success": True, "data": update_info})
        except Exception as ex:
            print(f"[Updater] Raw fallback query failed: {ex}")

        return json.dumps({"success": True, "data": update_info})

    def download_and_install_update(self, download_url):
        """
        Spawns a background thread to download the setup installer with progress events,
        then launches the silent installer passing current process PID.
        """
        if self._is_downloading:
            return json.dumps({"error": "Download already in progress"})

        self._is_downloading = True
        thread = threading.Thread(
            target=self._download_and_launch_proc,
            args=(download_url,),
            daemon=True
        )
        thread.start()
        return json.dumps({"success": True, "message": "Download started"})

    def _download_and_launch_proc(self, download_url):
        try:
            if not download_url:
                download_url = RAW_SETUP_URL

            temp_dir = Path(os.environ.get("TEMP", ".")) / "AIN53_Update"
            temp_dir.mkdir(parents=True, exist_ok=True)
            installer_path = temp_dir / "AIN53_Data_Management_Setup.exe"

            print(f"[Updater] Downloading setup from {download_url} -> {installer_path}")

            req = urllib.request.Request(
                download_url,
                headers={"User-Agent": "AIN53-Data-Management-Updater"}
            )

            with urllib.request.urlopen(req, timeout=30) as response:
                total_length = response.getheader('content-length')
                total_bytes = int(total_length) if total_length else 0
                downloaded_bytes = 0
                block_size = 65536

                start_time = time.time()
                with open(installer_path, 'wb') as f:
                    while True:
                        buffer = response.read(block_size)
                        if not buffer:
                            break
                        downloaded_bytes += len(buffer)
                        f.write(buffer)

                        percent = int((downloaded_bytes / total_bytes) * 100) if total_bytes > 0 else 50
                        elapsed = time.time() - start_time
                        speed_kb = (downloaded_bytes / 1024) / max(elapsed, 0.001)

                        # Emit progress callback to frontend webview
                        if self._window:
                            js_code = f"if (window.onUpdateDownloadProgress) window.onUpdateDownloadProgress({percent}, {downloaded_bytes}, {total_bytes}, {speed_kb:.1f});"
                            self._window.evaluate_js(js_code)

            self._is_downloading = False

            # Ensure 100% progress is emitted to frontend
            if self._window:
                elapsed = time.time() - start_time
                speed_kb = (downloaded_bytes / 1024) / max(elapsed, 0.001)
                js_code = f"if (window.onUpdateDownloadProgress) window.onUpdateDownloadProgress(100, {downloaded_bytes}, {downloaded_bytes}, {speed_kb:.1f});"
                self._window.evaluate_js(js_code)

            # Notify frontend that download is ready and installer is starting
            current_pid = os.getpid()
            if self._window:
                js_code = f"if (window.onUpdateReadyToInstall) window.onUpdateReadyToInstall('{installer_path.as_posix()}', {current_pid});"
                self._window.evaluate_js(js_code)

            time.sleep(1.0)

            # Launch installer executable in silent mode passing wait-pid
            cmd = [
                str(installer_path),
                "--silent",
                "--wait-pid", str(current_pid)
            ]

            startupinfo = subprocess.STARTUPINFO()
            startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            startupinfo.wShowWindow = subprocess.SW_HIDE

            subprocess.Popen(
                cmd,
                startupinfo=startupinfo,
                creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0
            )

            # Terminate current app cleanly to allow installer to update files
            os._exit(0)

        except Exception as e:
            self._is_downloading = False
            err_msg = str(e).replace("'", "\\'")
            print(f"[Updater] Download/install error: {e}")
            if self._window:
                js_code = f"if (window.onUpdateError) window.onUpdateError('{err_msg}');"
                self._window.evaluate_js(js_code)
