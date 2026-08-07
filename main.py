"""
AIN53 Data Management - Main Application Entrypoint
===================================================

This module serves as the primary bootstrapper for the AIN53 Data Management desktop app.
It performs the following essential duties:
1. Resolves workspace directories and appends them to the Python system path.
2. Initializes the `UnifiedApi` gateway which acts as a bridge for JS-to-Python RPC.
3. Configures and starts the PyWebView window container.
4. Binds drag-and-drop events from the web view back into the Python controller.
"""

import os
import sys
import json
import webview
import traceback
from webview.dom import DOMEventHandler
from pathlib import Path

# Ensure Windows terminal UTF-8 encoding for unicode print output
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

# Diagnostics file setup (saved next to the executable)
EXE_DIR = Path(sys.executable).parent
LOG_FILE = EXE_DIR / "portable_debug.log"

def log_debug(msg):
    try:
        with open(LOG_FILE, "a") as f:
            f.write(f"[{Path(__file__).name}] {msg}\n")
    except Exception:
        pass

log_debug("--- Starting App ---")
log_debug(f"sys.executable: {sys.executable}")
log_debug(f"__file__: {__file__}")
if hasattr(sys, '_MEIPASS'):
    log_debug(f"_MEIPASS: {sys._MEIPASS}")

# ==============================================================================
# PATH CONFIGURATION
# ==============================================================================
BASE_DIR = Path(__file__).resolve().parent
sys.path.append(str(BASE_DIR))
log_debug(f"BASE_DIR: {BASE_DIR}")

# Import the specialized backend sub-APIs that handle business logic.
from backends.pdf_to_csv import PdfToCsvApi
from backends.csv_to_folders import CsvToFoldersApi
from backends.sorting import SortingApi
from backends.drive_inventory import DriveInventoryApi
from backends.updater import AutoUpdater


# ==============================================================================
# UNIFIED API GATEWAY (RPC ROUTER)
# ==============================================================================
class UnifiedApi:
    """
    Unified API wrapper class.
    
    PyWebView injects a single JS object into the frontend window context: `window.pywebview.api`.
    To expose multiple separate modules (PDF parser, folder generator, drive inventory, file sorter, updater)
    to the frontend, this class aggregates all sub-APIs and exposes their methods.
    
    Any call to `window.pywebview.api.some_method()` will be mapped to the matching method here.
    """
    def __init__(self):
        # A reference to the PyWebView window, set after window creation.
        self._window = None
        
        # Instantiate sub-APIs which contain the actual implementations
        self._pdf = PdfToCsvApi()
        self._csv = CsvToFoldersApi()
        self._sorting = SortingApi()
        self._inventory = DriveInventoryApi()
        self._updater = AutoUpdater(BASE_DIR)

    # --------------------------------------------------------------------------
    # SECTION: PDF to CSV Pipeline Methods
    # --------------------------------------------------------------------------
    def pdf_pick_pdf(self, *args, **kwargs): 
        """Opens a file dialog to select a PDF and scans its column structure."""
        return self._pdf.pdf_pick_pdf(*args, **kwargs)
        
    def pdf_process(self, *args, **kwargs): 
        """Processes PDF rows based on header mapping and groups them by sticker number."""
        return self._pdf.pdf_process(*args, **kwargs)
        
    def pdf_download(self, *args, **kwargs): 
        """Converts extracted PDF tabular rows to a CSV file and prompts user to save it."""
        return self._pdf.pdf_download(*args, **kwargs)

    # --------------------------------------------------------------------------
    # SECTION: CSV to Folder Struct Generation Methods
    # --------------------------------------------------------------------------
    def csv_select_input(self, *args, **kwargs): 
        """Launches a dialog to pick the input mapping CSV file."""
        return self._csv.csv_select_input(*args, **kwargs)
        
    def csv_select_dest(self, *args, **kwargs): 
        """Launches a directory picker dialog for the target folder creation directory."""
        return self._csv.csv_select_dest(*args, **kwargs)
        
    def csv_process(self, *args, **kwargs): 
        """Parses the CSV and recursively generates master/leaf/contributor directories."""
        return self._csv.csv_process(*args, **kwargs)

    # --------------------------------------------------------------------------
    # SECTION: Sorting & Media Organization Methods
    # --------------------------------------------------------------------------
    def sorting_select_mapping_file(self, *args, **kwargs): 
        """Dialog to select the CSV template mapping file for media sorting."""
        return self._sorting.select_mapping_file(*args, **kwargs)
        
    def sorting_select_root_dir(self, *args, **kwargs): 
        """Dialog to select the target source directory containing files to sort."""
        return self._sorting.select_root_dir(*args, **kwargs)
        
    def sorting_select_folder_dialog(self): 
        """Selects a directory for general folder path matching."""
        return self._sorting.select_folder_dialog()
        
    def sorting_create_physical_folder(self, *args, **kwargs): 
        """Physically constructs a folder in the target directory path."""
        return self._sorting.create_physical_folder(*args, **kwargs)
        
    def sorting_add_files_dialog(self): 
        """Opens a multiple-file selection dialog for file additions."""
        return self._sorting.add_files_dialog()
        
    def sorting_scan_files(self, *args, **kwargs): 
        """Scans folder structure and maps matching files with the database mapping."""
        return self._sorting.scan_files(*args, **kwargs)
        
    def sorting_start_analysis(self): 
        """Runs the file match analysis, checking for copy/move targets and duplicates."""
        return self._sorting.start_analysis()
        
    def sorting_load_data(self, *args, **kwargs): 
        """Loads sorting records directly into the UI state machine."""
        return self._sorting.load_data(*args, **kwargs)
        
    def sorting_generate_thumbnail(self, *args, **kwargs): 
        """Triggers asynchronous Open-CV thumbnail decoding for photos and videos."""
        return self._sorting.generate_thumbnail(*args, **kwargs)
        
    def sorting_set_camera_ranges(self, *args, **kwargs):
        """Sets custom start and end file ranges for camera conflict resolution."""
        return self._sorting.set_camera_ranges(*args, **kwargs)

    def sorting_get_contributor_prefixes(self, *args, **kwargs):
        """Retrieves camera series prefix mapping per contributor for user review."""
        return self._sorting.get_contributor_prefixes(*args, **kwargs)

    def sorting_set_contributor_series(self, *args, **kwargs):
        """Updates custom camera series prefix mapping per contributor."""
        return self._sorting.set_contributor_series(*args, **kwargs)
        
    def sorting_execute_transfer(self, *args, **kwargs): 
        """Executes batched copy/move actions and maintains transactional undo states."""
        return self._sorting.execute_transfer(*args, **kwargs)

    def sorting_undo_transfer(self, *args, **kwargs):
        """Reverts previous file transfer actions."""
        return self._sorting.undo_transfer(*args, **kwargs)

    # --------------------------------------------------------------------------
    # SECTION: Drive Inventory Scanning & Formatting Methods
    # --------------------------------------------------------------------------
    def inventory_select_drive(self, *args, **kwargs): 
        """Launches directory picker to select drive partition to run analysis on."""
        return self._inventory.inventory_select_drive(*args, **kwargs)
        
    def inventory_select_save_file(self, default_name): 
        """Launches save dialog for the output inventory report (.xlsx)."""
        return self._inventory.inventory_select_save_file(default_name)
        
    def inventory_generate_report(self, *args, **kwargs): 
        """Crawls directory trees, parses sequence patterns, and formats Excel results."""
        return self._inventory.inventory_generate_report(*args, **kwargs)

    # --------------------------------------------------------------------------
    # SECTION: Auto Update Engine Methods
    # --------------------------------------------------------------------------
    def check_for_updates(self):
        """Checks GitHub Releases for new updates (Priority A: GitHub, Priority B: GAS)."""
        return self._updater.check_for_updates()

    def download_and_install_update(self, download_url=""):
        """Downloads latest update setup installer with progress events."""
        return self._updater.download_and_install_update(download_url)

    def apply_update_now(self):
        """Launches the downloaded setup installer and restarts the app with the update applied."""
        return self._updater.apply_update_now()

    def get_app_version(self):
        """Returns local application version from version.txt."""
        return json.dumps({"version": self._updater.get_local_version()})

    def get_setting(self, key):
        """Returns a persisted app setting value by key (JSON encoded)."""
        return self._updater.get_setting(key)

    def set_setting(self, key, value):
        """Persists an app setting value. Returns {success: true} on success."""
        return self._updater.set_setting(key, value)

    # --------------------------------------------------------------------------
    # SECTION: Explorer & System Utilities
    # --------------------------------------------------------------------------
    def open_in_explorer(self, target_path):
        """Launches Windows Explorer for the target folder or file path."""
        import subprocess
        try:
            if not target_path or not os.path.exists(target_path):
                return json.dumps({"error": "Path does not exist"})
            
            target = os.path.normpath(target_path)
            if os.path.isfile(target):
                subprocess.Popen(f'explorer /select,"{target}"')
            else:
                os.startfile(target)
            return json.dumps({"success": True})
        except Exception as e:
            return json.dumps({"error": str(e)})

    def set_window(self, window):
        """Propagates the active PyWebView window reference down to all sub-APIs."""
        self._window = window
        self._pdf._window = window
        self._csv._window = window
        self._sorting._window = window
        self._inventory._window = window
        self._updater.set_window(window)

        # Stage 1: fire silent update check after 4-second startup delay.
        # Runs in a daemon thread — non-blocking, errors are swallowed.
        import threading
        def _delayed_silent_check():
            import time
            time.sleep(4.0)
            self._updater.silent_check_and_push()
        threading.Thread(target=_delayed_silent_check, daemon=True,
                         name="updater-startup-delay").start()


# ==============================================================================
# GLOBAL DRAG & DROP EVENTS
# ==============================================================================
def on_drop(e):
    """
    Callback fired when files are dropped into the HTML webview container.
    
    This function parses the drop event, extracts the paths of the dropped files
    (using pywebview's internal file descriptors), converts them to JSON, and
    evaluates a JavaScript function inside the DOM to notify the frontend.
    """
    if not api._window: 
        return
        
    files = e.get('dataTransfer', {}).get('files', [])
    # Extract native system paths provided by PyWebView's drag-drop bindings
    paths = [f.get('pywebviewFullPath') for f in files if f.get('pywebviewFullPath')]
    
    if paths:
        # Convert path list to clean JSON format, escaping backslashes for JS compatibility
        paths_json = json.dumps(paths).replace('\\', '\\\\')
        # Instruct the frontend web page to handle the drop payload
        api._window.evaluate_js(f"window.handleGlobalDrop({paths_json})")


def bind_events(window):
    """
    Subscribes to native window DOM events once the document is loaded.
    
    Binds the dragover drop target events to coordinate dragging files.
    """
    try:
        window.dom.document.events.drop += DOMEventHandler(on_drop, True, True)
    except Exception as ex:
        print("Could not bind drop event:", ex)


# ==============================================================================
# APPLICATION MAIN INITIALIZATION
# ==============================================================================
if __name__ == '__main__':
    try:
        # Initialize our RPC API gateway
        api = UnifiedApi()
        
        # Define absolute path to HTML front-end index file
        frontend_path = BASE_DIR / "frontend" / "index.html"
        log_debug(f"frontend_path: {frontend_path} (exists? {frontend_path.exists()})")
        
        # Convert path to standard URI (handles spaces and path separations correctly)
        frontend_uri = frontend_path.as_uri()
        log_debug(f"frontend_uri: {frontend_uri}")
        
        # Configure and create the OS window container
        window = webview.create_window(
            title="AIN53 Data Management",
            url=frontend_uri,
            js_api=api,
            width=1200,
            height=850,
            min_size=(900, 600)
        )
        
        # Establish reciprocal bindings between the window context and APIs
        api.set_window(window)
        
        # Start the PyWebView main event loop
        log_debug("Starting PyWebView event loop...")
        webview.start(bind_events, window, debug=False)
        log_debug("App closed successfully.")
    except Exception as e:
        err_msg = traceback.format_exc()
        log_debug(f"FATAL EXCEPTION:\n{err_msg}")
        try:
            import tkinter as tk
            from tkinter import messagebox
            root = tk.Tk()
            root.withdraw()
            messagebox.showerror(
                "Fatal Error", 
                f"The application failed to start:\n{e}\n\nDetails saved to:\n{LOG_FILE}"
            )
            root.destroy()
        except Exception:
            pass
        sys.exit(1)
