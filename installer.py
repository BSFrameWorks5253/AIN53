"""
AIN53 Data Management - Native Windows GUI Installer
=====================================================

This module provides a professional wizard-style installation and uninstallation system.
It is compiled into a standalone setup file by PyInstaller.
- Installation: Extracts payload, registers in Windows Registry (Add/Remove Programs),
                and creates Start Menu/Desktop shortcuts using PowerShell.
- Uninstallation: Removes all files, registry keys, and shortcuts, performing self-deletion
                  via a background PowerShell process.
"""

import os
import sys
import zipfile
import winreg
import shutil
import threading
import time
import subprocess
import tkinter as tk
from tkinter import ttk, messagebox, filedialog
from PIL import Image, ImageTk

# ==============================================================================
# CONFIGURATION CONSTANTS
# ==============================================================================
APP_NAME = "AIN53 Data Management"
PUBLISHER = "AIN (All Rights Reserved)"
VERSION = "1.0.0"
DEFAULT_SUBDIR = os.path.join("Programs", APP_NAME)

# Try reading version from sibling version.txt if available
try:
    current_dir = os.path.dirname(os.path.abspath(__file__))
    v_file = os.path.join(current_dir, "version.txt")
    if os.path.exists(v_file):
        with open(v_file, 'r') as vf:
            VERSION = vf.read().strip()
except Exception:
    pass

# Colors for professional theme (Emerald Green Theme matching the app)
COLOR_PRIMARY = "#047857"      # Deep Emerald Green
COLOR_SECONDARY = "#10b981"    # Vibrant Emerald Green
COLOR_BG = "#f8fafc"           # Cool off-white/light grey
COLOR_CARD = "#ffffff"         # Card background
COLOR_WHITE = "#ffffff"
COLOR_TEXT = "#1e293b"         # Dark slate/charcoal
COLOR_TEXT_MUTED = "#64748b"   # Muted slate gray

# ==============================================================================
# LOGO LOADING HELPER
# ==============================================================================
def load_logo_image(size=64):
    """Loads icon.ico and scales it to the specified size for GUI use."""
    try:
        res_dir = getattr(sys, '_MEIPASS', os.path.dirname(os.path.abspath(__file__)))
        icon_path = os.path.join(res_dir, "icon.ico")
        if not os.path.exists(icon_path):
            icon_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "icon.ico")
        if os.path.exists(icon_path):
            img = Image.open(icon_path)
            img = img.resize((size, size), Image.Resampling.LANCZOS)
            return ImageTk.PhotoImage(img)
    except Exception as e:
        print(f"Error loading logo image: {e}")
    return None


# ==============================================================================
# PROCESS LOCK CHECK
# ==============================================================================
def is_app_running():
    """Checks if AIN53 Data Management is currently running."""
    try:
        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        startupinfo.wShowWindow = subprocess.SW_HIDE
        result = subprocess.run(
            ["tasklist", "/FI", "IMAGENAME eq AIN53 Data Management.exe", "/NH"],
            startupinfo=startupinfo,
            capture_output=True,
            text=True
        )
        return "AIN53 Data Management.exe" in result.stdout
    except Exception:
        return False


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
            ["powershell", "-NoProfile", "-WindowStyle", "Hidden", "-Command", cmd],
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
    reg_path = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\AIN53 Data Management"
    try:
        key = winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, reg_path, 0, winreg.KEY_SET_VALUE)
        winreg.SetValueEx(key, "DisplayName", 0, winreg.REG_SZ, APP_NAME)
        winreg.SetValueEx(key, "DisplayVersion", 0, winreg.REG_SZ, VERSION)
        winreg.SetValueEx(key, "Publisher", 0, winreg.REG_SZ, PUBLISHER)
        winreg.SetValueEx(key, "DisplayIcon", 0, winreg.REG_SZ, f'"{app_exe}"')
        winreg.SetValueEx(key, "InstallLocation", 0, winreg.REG_SZ, install_dir)
        # Point the uninstall trigger back to our installer running with the --uninstall parameter
        winreg.SetValueEx(key, "UninstallString", 0, winreg.REG_SZ, f'"{uninstaller_exe}" --uninstall')
        winreg.CloseKey(key)
        return True
    except Exception as e:
        print(f"Registry write error: {e}")
        return False


def unregister_uninstaller():
    """Removes Registry keys on uninstallation."""
    reg_path = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\AIN53 Data Management"
    try:
        winreg.DeleteKey(winreg.HKEY_CURRENT_USER, reg_path)
        return True
    except FileNotFoundError:
        return True
    except Exception as e:
        print(f"Registry delete error: {e}")
        return False


# ==============================================================================
# CORE INSTALLATION ENGINE
# ==============================================================================
class InstallThread(threading.Thread):
    """Asynchronous thread handling file extraction to prevent GUI freeze."""
    def __init__(self, zip_path, dest_dir, on_progress, on_complete, on_error):
        super().__init__()
        self.zip_path = zip_path
        self.dest_dir = dest_dir
        self.on_progress = on_progress
        self.on_complete = on_complete
        self.on_error = on_error

    def run(self):
        try:
            # Ensure the directory exists
            os.makedirs(self.dest_dir, exist_ok=True)
            
            if not os.path.exists(self.zip_path):
                self.on_error("Installation source payload.zip was not found inside the executable bundle.")
                return

            with zipfile.ZipFile(self.zip_path, 'r') as zip_ref:
                file_list = zip_ref.namelist()
                total_files = len(file_list)
                
                if total_files == 0:
                    self.on_error("Installation archive is empty.")
                    return

                for idx, file_name in enumerate(file_list):
                    zip_ref.extract(file_name, self.dest_dir)
                    percent = int(((idx + 1) / total_files) * 100)
                    self.on_progress(percent, f"Extracting {os.path.basename(file_name)}...")
            
            self.on_complete()
        except Exception as e:
            self.on_error(str(e))


# ==============================================================================
# INSTALLER WIZARD INTERFACE (TKINTER GUI)
# ==============================================================================
class InstallerGUI:
    """Manages the Tkinter installation wizard screens."""
    def __init__(self, root):
        self.root = root
        self.root.title(f"{APP_NAME} Setup")
        self.root.geometry("620x420")
        self.root.resizable(False, False)
        
        # Configure overall style
        self.style = ttk.Style()
        self.style.theme_use('clam')
        
        # Set overall window background color
        self.root.configure(bg=COLOR_BG)
        
        # Configure primary buttons (TButton)
        self.style.configure(
            "TButton",
            font=("Segoe UI", 9),
            background=COLOR_PRIMARY,
            foreground="white",
            borderwidth=1,
            bordercolor=COLOR_PRIMARY,
            focusthickness=0,
            focuscolor="none",
            padding=(15, 5)
        )
        self.style.map(
            "TButton",
            background=[("pressed", "#047857"), ("active", COLOR_SECONDARY)],
            foreground=[("pressed", "white"), ("active", "white"), ("!disabled", "white")],
            bordercolor=[("active", COLOR_SECONDARY)]
        )
        
        # Configure secondary buttons (Secondary.TButton)
        self.style.configure(
            "Secondary.TButton",
            font=("Segoe UI", 9),
            background="#e2e8f0",
            foreground=COLOR_TEXT,
            borderwidth=1,
            bordercolor="#cbd5e1",
            focusthickness=0,
            focuscolor="none",
            padding=(15, 5)
        )
        self.style.map(
            "Secondary.TButton",
            background=[("pressed", "#94a3b8"), ("active", "#cbd5e1")],
            foreground=[("pressed", COLOR_TEXT), ("active", COLOR_TEXT), ("!disabled", COLOR_TEXT)],
            bordercolor=[("active", "#94a3b8")]
        )
        
        # Configure progressbar
        self.style.configure(
            "Horizontal.TProgressbar",
            troughcolor="#e2e8f0",
            background=COLOR_SECONDARY,
            thickness=15,
            borderwidth=0
        )
        
        # Configure Entry fields
        self.style.configure(
            "TEntry",
            fieldbackground="white",
            bordercolor="#cbd5e1",
            lightcolor="#cbd5e1",
            darkcolor="#cbd5e1",
            padding=5
        )
        self.style.map(
            "TEntry",
            bordercolor=[("focus", COLOR_SECONDARY)]
        )
        
        # Set window icon if available
        self.find_and_set_icon()
        
        # Default local program directory path
        local_app_data = os.environ.get("LOCALAPPDATA", os.path.expanduser("~\\AppData\\Local"))
        self.install_dir = os.path.join(local_app_data, DEFAULT_SUBDIR)
        
        # Shortcuts option variables
        self.var_desktop = tk.BooleanVar(value=True)
        self.var_startmenu = tk.BooleanVar(value=True)
        
        self.current_frame = None
        self.show_welcome_screen()

    def find_and_set_icon(self):
        """Locates and loads window icons if available."""
        try:
            # Try from temporary resources folder sys._MEIPASS
            res_dir = getattr(sys, '_MEIPASS', os.path.dirname(os.path.abspath(__file__)))
            icon_file = os.path.join(res_dir, "icon.ico")
            if os.path.exists(icon_file):
                self.root.iconbitmap(icon_file)
        except Exception:
            pass

    def switch_frame(self, frame_class):
        """Safely clean and mount frames to represent wizard pages."""
        if self.current_frame:
            self.current_frame.destroy()
        self.current_frame = frame_class(self.root, self)
        self.current_frame.pack(fill=tk.BOTH, expand=True)

    def show_welcome_screen(self):
        self.switch_frame(WelcomeFrame)

    def show_directory_screen(self):
        self.switch_frame(DirectoryFrame)

    def show_progress_screen(self):
        self.switch_frame(ProgressFrame)

    def show_success_screen(self):
        self.switch_frame(SuccessFrame)


# ==============================================================================
# WIZARD FRAMES
# ==============================================================================
class HeaderPanel(tk.Frame):
    """Upper panel banner shown on wizard sheets."""
    def __init__(self, parent, title, subtitle):
        super().__init__(parent, bg=COLOR_PRIMARY, height=75)
        self.pack_propagate(False)
        
        # Left side text frame
        text_frame = tk.Frame(self, bg=COLOR_PRIMARY)
        text_frame.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=(25, 10))
        
        lbl_title = tk.Label(
            text_frame, text=title, font=("Segoe UI", 13, "bold"),
            fg=COLOR_WHITE, bg=COLOR_PRIMARY, anchor="w"
        )
        lbl_title.pack(fill=tk.X, pady=(12, 1))
        
        lbl_sub = tk.Label(
            text_frame, text=subtitle, font=("Segoe UI", 9),
            fg="#e2e8f0", bg=COLOR_PRIMARY, anchor="w"
        )
        lbl_sub.pack(fill=tk.X)
        
        # Right side small logo image
        self.logo_img = load_logo_image(40)
        if self.logo_img:
            lbl_logo = tk.Label(self, image=self.logo_img, bg=COLOR_PRIMARY)
            lbl_logo.pack(side=tk.RIGHT, padx=25, pady=17)


class WelcomeFrame(tk.Frame):
    """Wizard Welcome Screen."""
    def __init__(self, parent, controller):
        super().__init__(parent, bg=COLOR_BG)
        self.controller = controller
        
        # Left graphic bar
        left_bar = tk.Frame(self, bg=COLOR_PRIMARY, width=170)
        left_bar.pack(side=tk.LEFT, fill=tk.Y)
        
        self.logo_img = load_logo_image(64)
        if self.logo_img:
            lbl_logo = tk.Label(left_bar, image=self.logo_img, bg=COLOR_PRIMARY)
            lbl_logo.place(relx=0.5, rely=0.35, anchor=tk.CENTER)
            
            lbl_bar = tk.Label(
                left_bar, text="AIN53\nData", font=("Segoe UI", 13, "bold"),
                fg=COLOR_WHITE, bg=COLOR_PRIMARY, justify=tk.CENTER
            )
            lbl_bar.place(relx=0.5, rely=0.5, anchor=tk.CENTER)
        else:
            lbl_bar = tk.Label(
                left_bar, text="AIN53\nDATA", font=("Segoe UI", 18, "bold"),
                fg=COLOR_WHITE, bg=COLOR_PRIMARY, justify=tk.CENTER
            )
            lbl_bar.place(relx=0.5, rely=0.4, anchor=tk.CENTER)
        
        # Main content
        main_content = tk.Frame(self, bg=COLOR_BG)
        main_content.pack(side=tk.RIGHT, fill=tk.BOTH, expand=True, padx=30, pady=30)
        
        lbl_welcome = tk.Label(
            main_content, text=f"Welcome to the {APP_NAME} Setup Wizard",
            font=("Segoe UI", 14, "bold"), fg=COLOR_PRIMARY, bg=COLOR_BG,
            wraplength=350, justify=tk.LEFT, anchor="w"
        )
        lbl_welcome.pack(fill=tk.X, pady=(10, 15))
        
        lbl_desc = tk.Label(
            main_content,
            text=f"This wizard will install {APP_NAME} version {VERSION} on your system.\n\n"
                 "It is recommended that you close all other applications before continuing.\n\n"
                 "Click Next to continue or Cancel to exit the installer.",
            font=("Segoe UI", 10), fg=COLOR_TEXT, bg=COLOR_BG,
            wraplength=350, justify=tk.LEFT, anchor="w"
        )
        lbl_desc.pack(fill=tk.X, pady=10)
        
        # Bottom controls line
        ctrl_bar = tk.Frame(main_content, bg=COLOR_BG)
        ctrl_bar.pack(side=tk.BOTTOM, fill=tk.X)
        
        btn_cancel = ttk.Button(ctrl_bar, text="Cancel", style="Secondary.TButton", command=parent.quit)
        btn_cancel.pack(side=tk.RIGHT, padx=5)
        
        btn_next = ttk.Button(ctrl_bar, text="Next >", command=self.controller.show_directory_screen)
        btn_next.pack(side=tk.RIGHT, padx=5)
        btn_next.focus_set()


class DirectoryFrame(tk.Frame):
    """Wizard Installation Directory Chooser Screen."""
    def __init__(self, parent, controller):
        super().__init__(parent, bg=COLOR_BG)
        self.controller = controller
        
        # Header banner
        header = HeaderPanel(self, "Select Destination Location", "Where should AIN53 Data Management be installed?")
        header.pack(fill=tk.X, side=tk.TOP)
        
        # Content frame
        content = tk.Frame(self, bg=COLOR_BG)
        content.pack(fill=tk.BOTH, expand=True, padx=35, pady=25)
        
        lbl_prompt = tk.Label(
            content, text="Setup will install the application files in the following folder.\n"
                         "To install to a different folder, click Browse and select another path.",
            font=("Segoe UI", 9), fg=COLOR_TEXT, bg=COLOR_BG,
            justify=tk.LEFT, anchor="w"
        )
        lbl_prompt.pack(fill=tk.X, pady=(0, 15))
        
        # Browse input frame
        browse_frame = tk.Frame(content, bg=COLOR_BG)
        browse_frame.pack(fill=tk.X, pady=5)
        
        self.entry_path = ttk.Entry(browse_frame, font=("Segoe UI", 9))
        self.entry_path.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(0, 10))
        self.entry_path.insert(0, self.controller.install_dir)
        
        btn_browse = ttk.Button(browse_frame, text="Browse...", command=self.browse_folder)
        btn_browse.pack(side=tk.RIGHT)
        
        # Checkboxes Frame
        opts_frame = tk.LabelFrame(content, text="Shortcut Preferences", bg=COLOR_BG, font=("Segoe UI", 9, "bold"), padx=15, pady=10)
        opts_frame.pack(fill=tk.X, pady=20)
        
        cb_menu = tk.Checkbutton(
            opts_frame, text="Create folder & shortcut in Windows Start Menu",
            variable=self.controller.var_startmenu, font=("Segoe UI", 9),
            bg=COLOR_BG, activebackground=COLOR_BG, fg=COLOR_TEXT,
            selectcolor="white", activeforeground=COLOR_PRIMARY
        )
        cb_menu.pack(anchor="w", pady=2)
        
        cb_desk = tk.Checkbutton(
            opts_frame, text="Create shortcut icon on Desktop",
            variable=self.controller.var_desktop, font=("Segoe UI", 9),
            bg=COLOR_BG, activebackground=COLOR_BG, fg=COLOR_TEXT,
            selectcolor="white", activeforeground=COLOR_PRIMARY
        )
        cb_desk.pack(anchor="w", pady=2)

        # Bottom navigation
        ctrl_bar = tk.Frame(content, bg=COLOR_BG)
        ctrl_bar.pack(side=tk.BOTTOM, fill=tk.X)
        
        btn_cancel = ttk.Button(ctrl_bar, text="Cancel", style="Secondary.TButton", command=parent.quit)
        btn_cancel.pack(side=tk.RIGHT, padx=5)
        
        btn_next = ttk.Button(ctrl_bar, text="Install", command=self.proceed_to_install)
        btn_next.pack(side=tk.RIGHT, padx=5)
        
        btn_back = ttk.Button(ctrl_bar, text="< Back", style="Secondary.TButton", command=self.controller.show_welcome_screen)
        btn_back.pack(side=tk.RIGHT, padx=5)

    def browse_folder(self):
        chosen = filedialog.askdirectory(initialdir=self.controller.install_dir, title="Choose Install Location")
        if chosen:
            self.entry_path.delete(0, tk.END)
            self.entry_path.insert(0, os.path.normpath(chosen))

    def proceed_to_install(self):
        target = self.entry_path.get().strip()
        if not target:
            messagebox.showerror("Error", "Please specify a destination install directory.")
            return
            
        if is_app_running():
            messagebox.showerror(
                "Application Running",
                f"{APP_NAME} is currently running.\n\nPlease close the application before continuing with the installation."
            )
            return
        
        self.controller.install_dir = os.path.normpath(target)
        self.controller.show_progress_screen()


class ProgressFrame(tk.Frame):
    """Wizard File Extraction Progress Screen."""
    def __init__(self, parent, controller):
        super().__init__(parent, bg=COLOR_BG)
        self.controller = controller
        
        header = HeaderPanel(self, "Installing Application", "Please wait while Setup copies files onto your system.")
        header.pack(fill=tk.X, side=tk.TOP)
        
        content = tk.Frame(self, bg=COLOR_BG)
        content.pack(fill=tk.BOTH, expand=True, padx=35, pady=35)
        
        self.lbl_status = tk.Label(
            content, text="Initializing installation process...",
            font=("Segoe UI", 9), fg=COLOR_TEXT, bg=COLOR_BG,
            anchor="w", justify=tk.LEFT
        )
        self.lbl_status.pack(fill=tk.X, pady=(10, 5))
        
        self.progress = ttk.Progressbar(content, orient="horizontal", mode="determinate")
        self.progress.pack(fill=tk.X, pady=10)
        
        # Start file extraction thread
        self.start_extraction()

    def start_extraction(self):
        # Resolve target path of compressed app payload.zip
        res_dir = getattr(sys, '_MEIPASS', os.path.dirname(os.path.abspath(__file__)))
        zip_path = os.path.join(res_dir, "payload.zip")
        
        # Start InstallThread
        thread = InstallThread(
            zip_path=zip_path,
            dest_dir=self.controller.install_dir,
            on_progress=self.update_progress,
            on_complete=self.installation_complete,
            on_error=self.installation_error
        )
        thread.start()

    def update_progress(self, percent, text):
        self.progress['value'] = percent
        self.lbl_status['text'] = text

    def installation_complete(self):
        # Run shortcut creation and registry configurations in main thread safe execution context
        self.root_tasks_and_proceed()

    def installation_error(self, err_msg):
        messagebox.showerror("Installation Failed", f"An error occurred during file extraction:\n{err_msg}")
        self.controller.show_directory_screen()

    def root_tasks_and_proceed(self):
        dest_dir = self.controller.install_dir
        app_exe = os.path.join(dest_dir, "AIN53 Data Management.exe")
        
        # 1. Copy our installer binary to the folder to serve as the uninstaller target
        installer_binary = sys.executable
        uninstaller_exe = os.path.join(dest_dir, "Uninstall.exe")
        try:
            shutil.copy2(installer_binary, uninstaller_exe)
        except Exception as e:
            print(f"Failed to copy uninstaller binary: {e}")
            uninstaller_exe = installer_binary # Fallback to current path if copy fails

        # 2. Add shortcuts based on checkbox selections
        if self.controller.var_desktop.get():
            desktop_dir = os.path.join(os.environ["USERPROFILE"], "Desktop")
            shortcut_desktop = os.path.join(desktop_dir, f"{APP_NAME}.lnk")
            create_shortcut(app_exe, shortcut_desktop, dest_dir, app_exe)
            
        if self.controller.var_startmenu.get():
            appdata = os.environ.get("APPDATA", os.path.expanduser("~\\AppData\\Roaming"))
            startmenu_dir = os.path.join(appdata, "Microsoft\\Windows\\Start Menu\\Programs", APP_NAME)
            os.makedirs(startmenu_dir, exist_ok=True)
            shortcut_menu = os.path.join(startmenu_dir, f"{APP_NAME}.lnk")
            create_shortcut(app_exe, shortcut_menu, dest_dir, app_exe)

        # 3. Create uninstaller entry in Programs and Features registry
        register_uninstaller(dest_dir, app_exe, uninstaller_exe)
        
        # Proceed to completion screen
        self.controller.show_success_screen()


class SuccessFrame(tk.Frame):
    """Wizard Success Screen."""
    def __init__(self, parent, controller):
        super().__init__(parent, bg=COLOR_BG)
        self.controller = controller
        
        # Left graphic bar
        left_bar = tk.Frame(self, bg=COLOR_PRIMARY, width=170)
        left_bar.pack(side=tk.LEFT, fill=tk.Y)
        
        self.logo_img = load_logo_image(64)
        if self.logo_img:
            lbl_logo = tk.Label(left_bar, image=self.logo_img, bg=COLOR_PRIMARY)
            lbl_logo.place(relx=0.5, rely=0.35, anchor=tk.CENTER)
            
            lbl_bar = tk.Label(
                left_bar, text="Success", font=("Segoe UI", 13, "bold"),
                fg=COLOR_WHITE, bg=COLOR_PRIMARY, justify=tk.CENTER
            )
            lbl_bar.place(relx=0.5, rely=0.5, anchor=tk.CENTER)
        else:
            lbl_bar = tk.Label(
                left_bar, text="DONE", font=("Segoe UI", 24, "bold"),
                fg=COLOR_WHITE, bg=COLOR_PRIMARY, justify=tk.CENTER
            )
            lbl_bar.place(relx=0.5, rely=0.4, anchor=tk.CENTER)
        
        main_content = tk.Frame(self, bg=COLOR_BG)
        main_content.pack(side=tk.RIGHT, fill=tk.BOTH, expand=True, padx=30, pady=30)
        
        lbl_success = tk.Label(
            main_content, text="Completing the AIN53 Data Management Installation",
            font=("Segoe UI", 13, "bold"), fg=COLOR_PRIMARY, bg=COLOR_BG,
            wraplength=350, justify=tk.LEFT, anchor="w"
        )
        lbl_success.pack(fill=tk.X, pady=(10, 15))
        
        lbl_desc = tk.Label(
            main_content,
            text=f"Setup has finished installing {APP_NAME} on your system.\n\n"
                 "The application may be launched by clicking the icon shortcuts or selecting it from the Start Menu.\n\n"
                 "Click Finish to exit the Setup Wizard.",
            font=("Segoe UI", 10), fg=COLOR_TEXT, bg=COLOR_BG,
            wraplength=350, justify=tk.LEFT, anchor="w"
        )
        lbl_desc.pack(fill=tk.X, pady=10)
        
        self.var_run = tk.BooleanVar(value=True)
        self.cb_run = tk.Checkbutton(
            main_content, text="Launch AIN53 Data Management now",
            variable=self.var_run, font=("Segoe UI", 10, "bold"),
            bg=COLOR_BG, activebackground=COLOR_BG, fg=COLOR_PRIMARY,
            selectcolor="white", activeforeground=COLOR_PRIMARY
        )
        self.cb_run.pack(anchor="w", pady=15)
        
        # Bottom controls
        ctrl_bar = tk.Frame(main_content, bg=COLOR_BG)
        ctrl_bar.pack(side=tk.BOTTOM, fill=tk.X)
        
        btn_finish = ttk.Button(ctrl_bar, text="Finish", command=self.finish_installation)
        btn_finish.pack(side=tk.RIGHT, padx=5)
        btn_finish.focus_set()

    def finish_installation(self):
        # Optionally launch application on completion
        if self.var_run.get():
            app_exe = os.path.join(self.controller.install_dir, "AIN53 Data Management.exe")
            try:
                subprocess.Popen([app_exe], cwd=self.controller.install_dir)
            except Exception as e:
                print(f"Failed to launch app EXE: {e}")
                
        self.controller.root.destroy()


# ==============================================================================
# UNINSTALLATION ENGINE & WIZARD
# ==============================================================================
class Uninstaller:
    """Manages the application removal wizard flow."""
    def __init__(self):
        self.install_dir = os.path.dirname(os.path.abspath(sys.argv[0]))
        
        # If running from temp extraction directory, seek install location from Registry
        if "AppData\\Local\\Temp" in self.install_dir or getattr(sys, 'frozen', False) == False:
            self.install_dir = self.seek_install_dir_from_registry()
            
    def seek_install_dir_from_registry(self):
        """Reads install path from Registry values."""
        reg_path = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\AIN53 Data Management"
        try:
            key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, reg_path, 0, winreg.KEY_READ)
            val, _ = winreg.QueryValueEx(key, "InstallLocation")
            winreg.CloseKey(key)
            return os.path.normpath(val)
        except Exception:
            # Fallback to local default path
            local_app_data = os.environ.get("LOCALAPPDATA", os.path.expanduser("~\\AppData\\Local"))
            return os.path.join(local_app_data, DEFAULT_SUBDIR)

    def run(self):
        # Initialize root window hidden for popup dialog confirmations
        root = tk.Tk()
        root.withdraw()
        
        # Set window icon
        try:
            res_dir = getattr(sys, '_MEIPASS', os.path.dirname(os.path.abspath(__file__)))
            icon_file = os.path.join(res_dir, "icon.ico")
            if os.path.exists(icon_file):
                root.iconbitmap(icon_file)
        except Exception:
            pass

        # Check if the app is currently running
        if is_app_running():
            messagebox.showerror(
                "Uninstall Failed",
                f"Cannot uninstall while {APP_NAME} is currently running.\n\nPlease close the application and try again."
            )
            root.destroy()
            return

        confirm = messagebox.askyesno(
            "Confirm Uninstall",
            f"Are you sure you want to completely remove {APP_NAME} and all of its components?",
            default=messagebox.NO
        )
        
        if not confirm:
            root.destroy()
            return

        # Perform deletion
        self.execute_removal()
        
        messagebox.showinfo(
            "Uninstallation Complete",
            f"{APP_NAME} was successfully removed from your computer."
        )
        
        root.destroy()
        
        # Spawn self-destruction script
        self.trigger_self_destruction()

    def execute_removal(self):
        """Clears registry keys, shortcuts, and application folder contents."""
        # 1. Unregister from Registry Programs & Features
        unregister_uninstaller()
        
        # 2. Delete Shortcuts
        # Desktop
        desktop_dir = os.path.join(os.environ["USERPROFILE"], "Desktop")
        shortcut_desktop = os.path.join(desktop_dir, f"{APP_NAME}.lnk")
        if os.path.exists(shortcut_desktop):
            try: os.remove(shortcut_desktop)
            except Exception: pass
            
        # Start Menu
        appdata = os.environ.get("APPDATA", os.path.expanduser("~\\AppData\\Roaming"))
        startmenu_dir = os.path.join(appdata, "Microsoft\\Windows\\Start Menu\\Programs", APP_NAME)
        if os.path.exists(startmenu_dir):
            try: shutil.rmtree(startmenu_dir)
            except Exception: pass

        # 3. Clean files in Install directory (except uninstaller EXE itself)
        if os.path.exists(self.install_dir) and os.path.isdir(self.install_dir):
            current_exe = os.path.abspath(sys.argv[0])
            for item in os.listdir(self.install_dir):
                item_path = os.path.join(self.install_dir, item)
                # Skip self binary file to avoid file lock failures
                if item_path.lower() == current_exe.lower() or item.lower() == "uninstall.exe":
                    continue
                try:
                    if os.path.isdir(item_path):
                        shutil.rmtree(item_path)
                    else:
                        os.remove(item_path)
                except Exception as e:
                    print(f"Error deleting file {item}: {e}")

    def trigger_self_destruction(self):
        """
        Launches hidden PowerShell command line to delete the uninstaller binary 
        and remove the install directory after a brief delay.
        """
        current_exe = os.path.abspath(sys.argv[0])
        escaped_exe = current_exe.replace("'", "''")
        escaped_dir = self.install_dir.replace("'", "''")
        
        # PowerShell script: sleep 2 seconds, remove Uninstall.exe, and remove parent directory if empty
        ps_cmd = f"""
        Start-Sleep -Seconds 2
        if (Test-Path '{escaped_exe}') {{ Remove-Item -Path '{escaped_exe}' -Force }}
        if (Test-Path '{escaped_dir}') {{
            $files = Get-ChildItem -Path '{escaped_dir}'
            if ($files.Count -eq 0) {{ Remove-Item -Path '{escaped_dir}' -Force }}
        }}
        """
        
        # Launch process completely detached from uninstaller process window
        try:
            startupinfo = subprocess.STARTUPINFO()
            startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            startupinfo.wShowWindow = subprocess.SW_HIDE
            subprocess.Popen(
                ["powershell", "-NoProfile", "-WindowStyle", "Hidden", "-Command", ps_cmd],
                startupinfo=startupinfo,
                creationflags=subprocess.CREATE_NO_WINDOW
            )
        except Exception as e:
            print(f"Self-destruct process launch error: {e}")


# ==============================================================================
# SILENT AUTO-UPDATE ENGINE
# ==============================================================================
def wait_for_pid(pid, timeout=15):
    """Waits for process with PID to terminate before proceeding with file extraction."""
    if not pid:
        return
    start = time.time()
    while time.time() - start < timeout:
        try:
            pid_int = int(pid)
            if sys.platform == "win32":
                import ctypes
                PROCESS_QUERY_INFORMATION = 0x0400
                STILL_ACTIVE = 259
                kernel32 = ctypes.windll.kernel32
                handle = kernel32.OpenProcess(PROCESS_QUERY_INFORMATION, False, pid_int)
                if handle:
                    exit_code = ctypes.c_ulong()
                    kernel32.GetExitCodeProcess(handle, ctypes.byref(exit_code))
                    kernel32.CloseHandle(handle)
                    if exit_code.value != STILL_ACTIVE:
                        break
                else:
                    break
            else:
                os.kill(pid_int, 0)
        except Exception:
            break
        time.sleep(0.3)


def perform_silent_update(wait_pid=None, dest_dir=None):
    """Executes a silent background installation/update without opening Tkinter windows."""
    if wait_pid:
        wait_for_pid(wait_pid)

    if not dest_dir:
        local_appdata = os.environ.get("LOCALAPPDATA", os.path.expanduser("~\\AppData\\Local"))
        dest_dir = os.path.join(local_appdata, DEFAULT_SUBDIR)

    os.makedirs(dest_dir, exist_ok=True)
    res_dir = getattr(sys, '_MEIPASS', os.path.dirname(os.path.abspath(__file__)))
    zip_path = os.path.join(res_dir, "payload.zip")

    if os.path.exists(zip_path):
        for attempt in range(5):
            try:
                with zipfile.ZipFile(zip_path, 'r') as zip_ref:
                    zip_ref.extractall(dest_dir)
                break
            except Exception as e:
                if attempt < 4:
                    time.sleep(0.5)
                else:
                    print(f"Silent update extraction error: {e}")

    icon_src = os.path.join(res_dir, "icon.ico")
    if os.path.exists(icon_src):
        try: shutil.copy(icon_src, os.path.join(dest_dir, "icon.ico"))
        except Exception: pass

    current_exe = os.path.abspath(sys.argv[0])
    uninstaller_exe = os.path.join(dest_dir, "Uninstall.exe")
    if current_exe.lower() != uninstaller_exe.lower():
        try: shutil.copy(current_exe, uninstaller_exe)
        except Exception: pass

    app_exe = os.path.join(dest_dir, f"{APP_NAME}.exe")
    register_uninstaller(dest_dir, app_exe, uninstaller_exe)

    # Recreate Shortcuts
    try:
        desktop_dir = os.path.join(os.environ["USERPROFILE"], "Desktop")
        shortcut_desktop = os.path.join(desktop_dir, f"{APP_NAME}.lnk")
        create_shortcut(app_exe, shortcut_desktop, dest_dir, icon_path=os.path.join(dest_dir, "icon.ico"))
    except Exception: pass

    try:
        appdata = os.environ.get("APPDATA", os.path.expanduser("~\\AppData\\Roaming"))
        startmenu_dir = os.path.join(appdata, "Microsoft\\Windows\\Start Menu\\Programs", APP_NAME)
        os.makedirs(startmenu_dir, exist_ok=True)
        shortcut_start = os.path.join(startmenu_dir, f"{APP_NAME}.lnk")
        create_shortcut(app_exe, shortcut_start, dest_dir, icon_path=os.path.join(dest_dir, "icon.ico"))
    except Exception: pass

    # Launch newly updated app
    if os.path.exists(app_exe):
        subprocess.Popen([app_exe], cwd=dest_dir)

    sys.exit(0)


# ==============================================================================
# MAIN EXECUTION ROUTER
# ==============================================================================
def main():
    args = [a.lower() for a in sys.argv]
    
    # Silent / Auto Update Mode
    if "--silent" in args or "--update" in args:
        wait_pid = None
        dest_dir = None
        if "--wait-pid" in sys.argv:
            try:
                idx = sys.argv.index("--wait-pid")
                wait_pid = sys.argv[idx + 1]
            except Exception: pass
        if "--dest" in sys.argv:
            try:
                idx = sys.argv.index("--dest")
                dest_dir = sys.argv[idx + 1]
            except Exception: pass
        perform_silent_update(wait_pid=wait_pid, dest_dir=dest_dir)
        return

    # Uninstallation Mode
    if len(sys.argv) > 1 and sys.argv[1] == "--uninstall":
        uninstaller = Uninstaller()
        uninstaller.run()
    else:
        # Standard Tkinter Wizard
        root = tk.Tk()
        app = InstallerGUI(root)
        root.mainloop()


if __name__ == "__main__":
    main()
