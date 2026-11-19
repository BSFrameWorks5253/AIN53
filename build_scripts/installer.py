"""
AIN53 Data Management - Native PyWebView Setup GUI Installer
=============================================================

This module provides a modern glassmorphic setup wizard rendered with PyWebView.
It is compiled into a standalone installer executable by PyInstaller.
- Installation: Extracts payload.zip, registers in Windows Registry (Add/Remove Programs),
                and creates Start Menu/Desktop shortcuts via PowerShell.
- Uninstallation: Removes all files, registry keys, and shortcuts with background process cleanup.
"""

import os
import sys
import time
import json
import zipfile
import winreg
import shutil
import threading
import subprocess
import ctypes
from pathlib import Path
import webview

# Set High DPI Awareness on Windows for crisp font and UI rendering
if sys.platform == 'win32':
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(2)  # Per-Monitor DPI Aware v2
    except Exception:
        try:
            ctypes.windll.shcore.SetProcessDpiAwareness(1)  # System DPI Aware
        except Exception:
            try:
                ctypes.windll.user32.SetProcessDPIAware()
            except Exception:
                pass

# ==============================================================================
# CONFIGURATION CONSTANTS
# ==============================================================================
APP_NAME = "AIN53 Data Management"
PUBLISHER = "AIN (All Rights Reserved)"
VERSION = "1.0.60"

# Default install location: C:\Program Files\AIN53 Data Management
# (Standard Windows installation path — requires the installer to be run as Administrator)
# For auto-update reinstalls, the --dest argument overrides this with LOCALAPPDATA.
DEFAULT_INSTALL_ROOT = os.environ.get("PROGRAMFILES", r"C:\Program Files")
DEFAULT_SUBDIR = os.path.join(DEFAULT_INSTALL_ROOT, APP_NAME)

# Try reading version from sibling version.txt if available
try:
    res_dir = getattr(sys, '_MEIPASS', os.path.dirname(os.path.abspath(__file__)))
    v_file = os.path.join(res_dir, "version.txt")
    if not os.path.exists(v_file):
        v_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "version.txt")
    if os.path.exists(v_file):
        with open(v_file, 'r', encoding='utf-8') as vf:
            VERSION = vf.read().strip()
    e_file = os.path.join(res_dir, "edition.txt")
    if os.path.exists(e_file):
        with open(e_file, 'r', encoding='utf-8') as ef:
            if ef.read().strip().lower() == "admin":
                APP_NAME = "AIN53 Data Management (Admin Edition)"
                DEFAULT_SUBDIR = os.path.join(DEFAULT_INSTALL_ROOT, APP_NAME)
except Exception:
    pass


# ==============================================================================
# UTILITY FUNCTIONS: SHORTCUTS & REGISTRY
# ==============================================================================
def run_powershell_cmd(cmd):
    """Executes a PowerShell command silently in the background."""
    try:
        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        startupinfo.wShowWindow = subprocess.SW_HIDE
        subprocess.run(
            ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-Command", cmd],
            startupinfo=startupinfo,
            check=True
        )
        return True
    except Exception as e:
        print(f"PowerShell error: {e}")
        return False


def create_shortcut(target_path, shortcut_path, working_dir, icon_path=None):
    """Creates a Windows shell shortcut (.lnk) using COM/PowerShell."""
    escaped_target = target_path.replace("'", "''")
    escaped_shortcut = shortcut_path.replace("'", "''")
    escaped_working = working_dir.replace("'", "''")
    
    ps_command = f"""
    $WshShell = New-Object -ComObject WScript.Shell
    $Shortcut = $WshShell.CreateShortcut('{escaped_shortcut}')
    $Shortcut.TargetPath = '{escaped_target}'
    $Shortcut.WorkingDirectory = '{escaped_working}'
    """
    if icon_path:
        escaped_icon = icon_path.replace("'", "''")
        ps_command += f"\n$Shortcut.IconLocation = '{escaped_icon},0'"
        
    ps_command += "\n$Shortcut.Save()"
    return run_powershell_cmd(ps_command)


def register_uninstaller(install_dir, app_exe, uninstaller_exe):
    """
    Registers the application in Windows Programs and Features (Add/Remove Programs).
    Writes to the Current User Hive (HKCU) to avoid administrative privilege restrictions.
    """
    reg_path = rf"Software\Microsoft\Windows\CurrentVersion\Uninstall\{APP_NAME}"
    try:
        key = winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, reg_path, 0, winreg.KEY_SET_VALUE)
        winreg.SetValueEx(key, "DisplayName", 0, winreg.REG_SZ, APP_NAME)
        winreg.SetValueEx(key, "DisplayVersion", 0, winreg.REG_SZ, VERSION)
        winreg.SetValueEx(key, "Publisher", 0, winreg.REG_SZ, PUBLISHER)
        winreg.SetValueEx(key, "DisplayIcon", 0, winreg.REG_SZ, f'"{app_exe}"')
        winreg.SetValueEx(key, "InstallLocation", 0, winreg.REG_SZ, install_dir)
        winreg.SetValueEx(key, "UninstallString", 0, winreg.REG_SZ, f'"{uninstaller_exe}" --uninstall')
        winreg.CloseKey(key)
        return True
    except Exception as e:
        print(f"Registry write error: {e}")
        return False


def unregister_file_association():
    """Ensures .AIN53 is not associated with AIN53 or the viewer."""
    try:
        def delete_key_tree(root, subkey):
            try:
                with winreg.OpenKey(root, subkey, 0, winreg.KEY_ALL_ACCESS) as key:
                    while True:
                        try:
                            child = winreg.EnumKey(key, 0)
                            delete_key_tree(root, f"{subkey}\\{child}")
                        except OSError:
                            break
                winreg.DeleteKey(root, subkey)
            except Exception:
                pass

        delete_key_tree(winreg.HKEY_CURRENT_USER, r"Software\Classes\.AIN53")
        delete_key_tree(winreg.HKEY_CURRENT_USER, r"Software\Classes\AIN53.Package")
        delete_key_tree(winreg.HKEY_CURRENT_USER, r"Software\Classes\SystemFileAssociations\.AIN53")
        delete_key_tree(winreg.HKEY_CURRENT_USER, r"Software\Classes\SystemFileAssociations\.ain53")
        delete_key_tree(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.AIN53")
    except Exception as e:
        print(f"File association unregister error: {e}")




def unregister_uninstaller():
    """Removes Registry keys on uninstallation."""
    reg_path = rf"Software\Microsoft\Windows\CurrentVersion\Uninstall\{APP_NAME}"
    try:
        winreg.DeleteKey(winreg.HKEY_CURRENT_USER, reg_path)
        return True
    except FileNotFoundError:
        return True
    except Exception as e:
        print(f"Registry delete error: {e}")
        return False


# ==============================================================================
# PYWEBVIEW INSTALLER API BRIDGE
# ==============================================================================
class InstallerAPI:
    def __init__(self):
        self.window = None
        self.is_running = False
        
        # Parse CLI arguments for update mode, process waiting, and destination folder
        self.is_update = "--update" in sys.argv or "-update" in sys.argv
        self.wait_pid = None
        self.dest_dir = None
        
        for i, arg in enumerate(sys.argv):
            if arg == "--wait-pid" and i + 1 < len(sys.argv):
                try:
                    self.wait_pid = int(sys.argv[i + 1])
                except ValueError:
                    pass
            elif arg == "--dest" and i + 1 < len(sys.argv):
                self.dest_dir = sys.argv[i + 1]

    def set_window(self, window):
        self.window = window

    def _wait_for_process_exit(self, pid: int, timeout_sec: float = 15.0) -> None:
        """Waits for previous app process to exit so file locks are completely released."""
        if not pid or pid <= 0:
            return
        start_time = time.time()
        if sys.platform == 'win32':
            try:
                SYNCHRONIZE = 0x00100000
                PROCESS_QUERY_INFORMATION = 0x0400
                handle = ctypes.windll.kernel32.OpenProcess(SYNCHRONIZE | PROCESS_QUERY_INFORMATION, False, int(pid))
                if handle:
                    ctypes.windll.kernel32.WaitForSingleObject(handle, int(timeout_sec * 1000))
                    ctypes.windll.kernel32.CloseHandle(handle)
                    return
            except Exception as e:
                print(f"Process wait warning: {e}")

        # Fallback polling
        while time.time() - start_time < timeout_sec:
            try:
                os.kill(int(pid), 0)
                time.sleep(0.2)
            except (OSError, AttributeError):
                break

    def get_installer_info(self):
        # Determine the default destination directory:
        # - If --dest was passed (auto-update), use that (always LOCALAPPDATA-based, writable)
        # - For fresh installs, default to C:\Program Files\AIN53 Data Management
        default_dir = self.dest_dir if self.dest_dir else DEFAULT_SUBDIR
        return {
            "app_name": APP_NAME,
            "version": VERSION,
            "default_dir": default_dir,
            "dest_dir": default_dir,
            "is_uninstaller": "--uninstall" in sys.argv,
            "is_update": self.is_update
        }

    def browse_folder(self):
        """Opens a native folder picker dialog and returns the selected path."""
        if self.window:
            try:
                result = self.window.create_file_dialog(
                    webview.FileDialog.FOLDER,
                    directory=self.dest_dir or ""
                )
                if result and len(result) > 0:
                    return result[0]
            except Exception as e:
                print(f"Native browse folder error: {e}")
        # Fallback: tkinter dialog
        try:
            import tkinter as tk
            from tkinter import filedialog
            root = tk.Tk()
            root.withdraw()
            root.attributes("-topmost", True)
            folder = filedialog.askdirectory(title="Select Destination Directory")
            root.destroy()
            return folder if folder else ""
        except Exception:
            return ""

    def start_installation(self, install_dir, create_desktop, create_startmenu):

        if self.is_running:
            return {"error": "Installation in progress"}

        # ── Pre-flight: verify the target directory is writable BEFORE starting ──
        # This provides an immediate, clear error to the UI instead of a silent hang
        # when the path is inside Program Files or another admin-protected location.
        try:
            os.makedirs(install_dir, exist_ok=True)
            _test_file = os.path.join(install_dir, ".ain53_write_test")
            with open(_test_file, "w") as _tf:
                _tf.write("ok")
            os.remove(_test_file)
        except PermissionError:
            # Return immediately so JS gets a fast, meaningful error via onInstallError
            user_local = os.environ.get("LOCALAPPDATA", os.path.expanduser("~\\AppData\\Local"))
            suggested = os.path.join(user_local, "Programs", APP_NAME)
            return {
                "error": (
                    f"Permission denied: cannot write to \"{install_dir}\".\n\n"
                    f"To install in Program Files, right-click the installer\n"
                    f"and choose \"Run as Administrator\".\n\n"
                    f"Or choose a folder that doesn't require admin rights,\n"
                    f"for example:\n{suggested}"
                )
            }
        except Exception as e:
            return {"error": f"Cannot access install directory: {e}"}


        self.is_running = True

        def run_install():
            try:
                # ── Wait for the previous app process to release file locks ──
                # This runs in the background thread so the installer UI stays responsive.
                if self.wait_pid:
                    self._wait_for_process_exit(self.wait_pid)

                # Re-create the directory in case it was cleaned up between pre-flight and now
                os.makedirs(install_dir, exist_ok=True)

                res_dir = getattr(sys, '_MEIPASS', os.path.dirname(os.path.abspath(__file__)))
                zip_path = os.path.join(res_dir, "payload.zip")
                if not os.path.exists(zip_path):
                    zip_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "payload.zip")

                if not os.path.exists(zip_path):
                    if self.window:
                        self.window.evaluate_js(f"window.onInstallError({json.dumps('Source payload.zip not found!')})")
                    return

                with zipfile.ZipFile(zip_path, 'r') as zip_ref:
                    file_list = zip_ref.namelist()
                    total_files = len(file_list)
                    last_emit_time = 0.0

                    for idx, file_name in enumerate(file_list):
                        zip_ref.extract(file_name, install_dir)
                        pct = int(((idx + 1) / total_files) * 100)
                        now = time.time()

                        # Throttle JS progress evaluation to 100 ms intervals to prevent GUI-thread flooding
                        if (now - last_emit_time) >= 0.1 or pct == 100:
                            last_emit_time = now
                            base_name = json.dumps(os.path.basename(file_name))
                            if self.window:
                                try:
                                    self.window.evaluate_js(f"window.onInstallProgress({pct}, {base_name})")
                                except Exception:
                                    pass

                app_exe = os.path.join(install_dir, f"{APP_NAME}.exe")
                uninstaller_exe = os.path.join(install_dir, f"Uninstall {APP_NAME}.exe")
                if not os.path.exists(uninstaller_exe) and os.path.exists(sys.executable):
                    try:
                        shutil.copy2(sys.executable, uninstaller_exe)
                    except Exception:
                        pass

                if create_desktop:
                    desktop_dir = os.path.join(os.environ.get("USERPROFILE", ""), "Desktop")
                    create_shortcut(app_exe, os.path.join(desktop_dir, f"{APP_NAME}.lnk"), install_dir)

                if create_startmenu:
                    start_dir = os.path.join(os.environ.get("APPDATA", ""), r"Microsoft\Windows\Start Menu\Programs", APP_NAME)
                    os.makedirs(start_dir, exist_ok=True)
                    create_shortcut(app_exe, os.path.join(start_dir, f"{APP_NAME}.lnk"), install_dir)
                    if os.path.exists(uninstaller_exe):
                        create_shortcut(uninstaller_exe, os.path.join(start_dir, f"Uninstall {APP_NAME}.lnk"), install_dir)

                register_uninstaller(install_dir, app_exe, uninstaller_exe)
                unregister_file_association()

                if self.window:
                    escaped_dir = json.dumps(install_dir)
                    self.window.evaluate_js(f"window.onInstallComplete({escaped_dir})")

            except PermissionError as pe:
                # Surface permission errors clearly — do not silently hang
                user_local = os.environ.get("LOCALAPPDATA", os.path.expanduser("~\\AppData\\Local"))
                suggested = os.path.join(user_local, DEFAULT_SUBDIR)
                err_msg = (
                    f"Permission denied while writing to \"{install_dir}\".\n"
                    f"Please choose a user-writable folder, for example:\n{suggested}"
                )
                print(f"[Installer] PermissionError: {pe}")
                if self.window:
                    self.window.evaluate_js(f"window.onInstallError({json.dumps(err_msg)})")
            except Exception as e:
                if self.window:
                    escaped_err = json.dumps(str(e))
                    self.window.evaluate_js(f"window.onInstallError({escaped_err})")
            finally:
                self.is_running = False

        threading.Thread(target=run_install, daemon=True).start()
        return {"status": "started"}

    def start_uninstallation(self, install_dir):
        if self.is_running:
            return {"error": "Uninstallation in progress"}
        self.is_running = True

        def run_uninstall():
            try:
                if self.wait_pid:
                    self._wait_for_process_exit(self.wait_pid)

                # 1. Remove Desktop shortcut
                desktop_lnk = os.path.join(os.environ.get("USERPROFILE", ""), "Desktop", f"{APP_NAME}.lnk")
                if os.path.exists(desktop_lnk):
                    try:
                        os.remove(desktop_lnk)
                    except Exception:
                        pass

                # 2. Remove Start Menu shortcuts
                start_dir = os.path.join(os.environ.get("APPDATA", ""), r"Microsoft\Windows\Start Menu\Programs", APP_NAME)
                if os.path.exists(start_dir):
                    try:
                        shutil.rmtree(start_dir, ignore_errors=True)
                    except Exception:
                        pass

                # 3. Unregister from Windows Registry
                unregister_uninstaller()

                # 4. Remove installed files (except self if running from install_dir)
                if install_dir and os.path.exists(install_dir):
                    current_exe = os.path.abspath(sys.executable)
                    for root, dirs, files in os.walk(install_dir, topdown=False):
                        for name in files:
                            file_path = os.path.join(root, name)
                            if os.path.abspath(file_path) != current_exe:
                                try:
                                    os.remove(file_path)
                                except Exception:
                                    pass
                        for name in dirs:
                            dir_path = os.path.join(root, name)
                            try:
                                os.rmdir(dir_path)
                            except Exception:
                                pass

                if self.window:
                    self.window.evaluate_js("if(window.onUninstallComplete) window.onUninstallComplete(); else if(window.onInstallComplete) window.onInstallComplete('');")

            except Exception as e:
                if self.window:
                    escaped_err = json.dumps(str(e))
                    self.window.evaluate_js(f"window.onInstallError({escaped_err})")
            finally:
                self.is_running = False

        threading.Thread(target=run_uninstall, daemon=True).start()
        return {"status": "started"}

    def finish_installation(self, launch_app, install_dir):
        if launch_app and install_dir:
            app_exe = os.path.join(install_dir, f"{APP_NAME}.exe")
            if os.path.exists(app_exe):
                subprocess.Popen([app_exe])
        if self.window:
            self.window.destroy()

    def close_installer(self):
        if self.window:
            self.window.destroy()


# ==============================================================================
# MAIN ENTRYPOINT
# ==============================================================================
def main():
    res_dir = getattr(sys, '_MEIPASS', os.path.dirname(os.path.abspath(__file__)))
    candidates = [
        os.path.join(res_dir, "Installerv2.html"),
        os.path.join(res_dir, "installer.html"),
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "Installerv2.html"),
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "installer.html"),
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "build_scripts", "Installerv2.html"),
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "build_scripts", "installer.html"),
    ]
    html_file = next((c for c in candidates if os.path.exists(c)), None)
    if html_file:
        html_url = Path(html_file).as_uri()
    else:
        html_url = "about:blank"

    api = InstallerAPI()
    title = f"{APP_NAME} Updater — v{VERSION}" if api.is_update else f"{APP_NAME} Setup v{VERSION}"
    window = webview.create_window(
        title=title,
        url=html_url,
        js_api=api,
        width=920,
        height=620,
        resizable=False,
        frameless=False,
        easy_drag=False
    )
    api.set_window(window)
    webview.start(debug=False)


if __name__ == "__main__":
    main()
