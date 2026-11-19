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

# Prevent generation of corrupt or conflicting .pyc bytecode files across Python environments
sys.dont_write_bytecode = True
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"

# ── Windows High-DPI Awareness ──
# Prevents Windows Desktop Window Manager (DWM) from raster-stretching the window
# at 125%, 150%, or 175% display scaling, ensuring razor-sharp text and SVG rendering.
if sys.platform == "win32":
    try:
        import ctypes
        # DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 (-4)
        ctypes.windll.user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
    except Exception:
        try:
            ctypes.windll.shcore.SetProcessDpiAwareness(2)
        except Exception:
            try:
                ctypes.windll.user32.SetProcessDPIAware()
            except Exception:
                pass

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

# Diagnostics file setup — try next to EXE first, fall back to LOCALAPPDATA
# (EXE_DIR may be inside C:\Program Files which requires admin rights to write)
EXE_DIR = Path(sys.executable).parent

def _resolve_log_file() -> Path:
    """Returns a writable path for the diagnostic log file."""
    candidate = EXE_DIR / "portable_debug.log"
    try:
        candidate.parent.mkdir(parents=True, exist_ok=True)
        candidate.touch(exist_ok=True)
        return candidate
    except (PermissionError, OSError):
        pass
    # Fallback: user-writable OS-specific app data directory
    if sys.platform == "darwin":
        fallback_dir = Path.home() / "Library" / "Application Support" / "AIN53 Data Management"
    elif sys.platform == "win32":
        local_appdata = os.environ.get("LOCALAPPDATA", os.path.expanduser("~\\AppData\\Local"))
        fallback_dir = Path(local_appdata) / "AIN53 Data Management"
    else:
        fallback_dir = Path.home() / ".config" / "AIN53 Data Management"
    try:
        fallback_dir.mkdir(parents=True, exist_ok=True)
    except Exception:
        pass
    return fallback_dir / "portable_debug.log"

LOG_FILE = _resolve_log_file()

def log_debug(msg):
    try:
        with open(LOG_FILE, "a", encoding="utf-8", errors="replace") as f:
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

# Determine Application Edition (Standard vs Admin)
def _determine_app_edition():
    ed_file = BASE_DIR / "edition.txt"
    if ed_file.exists():
        try:
            val = ed_file.read_text(encoding="utf-8").strip("\ufeff \r\n\t").capitalize()
            if val in ("Admin", "Standard"):
                return val
        except Exception:
            pass
    if "admin" in str(BASE_DIR).lower():
        return "Admin"
    return os.environ.get("AIN53_EDITION", "Standard").strip("\ufeff \r\n\t").capitalize()

APP_EDITION = _determine_app_edition()
log_debug(f"APP_EDITION: {APP_EDITION}")

# Import the specialized backend sub-APIs that handle business logic.
from backends.pdf_to_csv import PdfToCsvApi
from backends.events_api import EventsApi
from backends.csv_to_folders import CsvToFoldersApi
from backends.sorting import SortingApi
from backends.drive_inventory import DriveInventoryApi
from backends.updater import AutoUpdater
from backends.feature_logger import note_feature, _initialize_registry
_initialize_registry(APP_EDITION)


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
        self.edition = APP_EDITION
        
        # Instantiate sub-APIs which contain the actual implementations
        self._pdf = PdfToCsvApi()
        self._events = EventsApi(BASE_DIR)
        self._csv = CsvToFoldersApi()
        self._sorting = SortingApi()
        self._inventory = DriveInventoryApi()
        self._updater = AutoUpdater(BASE_DIR)

        # Admin-exclusive sub-APIs
        if self.edition.lower() == "admin":
            try:
                from backends.inventory_mapper import InventoryMapperApi
                self._mapper = InventoryMapperApi()
            except Exception as e:
                log_debug(f"Could not load InventoryMapperApi: {e}")
                self._mapper = None
        else:
            self._mapper = None

    # --------------------------------------------------------------------------
    # SECTION: PDF to CSV Pipeline Methods
    # --------------------------------------------------------------------------
    def pdf_pick_pdf(self, *args, **kwargs): 
        """Opens a file dialog to select a PDF and scans its column structure."""
        return self._pdf.pdf_pick_pdf(*args, **kwargs)

    def pdf_get_main_events(self, *args, **kwargs):
        """Returns the list of main events for part naming dropdowns."""
        return self._pdf.pdf_get_main_events(*args, **kwargs)
        
    def pdf_process(self, *args, **kwargs): 
        """Processes PDF rows based on header mapping and groups them by sticker number."""
        return self._pdf.pdf_process(*args, **kwargs)
        
    def pdf_download(self, *args, **kwargs): 
        """Converts extracted PDF tabular rows to a CSV file and prompts user to save it."""
        return self._pdf.pdf_download(*args, **kwargs)

    def pdf_get_base64(self, *args, **kwargs):
        """Returns the current loaded PDF encoded in Base64 for the in-app viewer."""
        return self._pdf.pdf_get_base64(*args, **kwargs)

    def pdf_open_external(self, *args, **kwargs):
        """Opens the loaded PDF file in the system default external application."""
        return self._pdf.pdf_open_external(*args, **kwargs)

    # --------------------------------------------------------------------------
    # SECTION: Event Creation & Architecture Methods (Offline Edition)
    # --------------------------------------------------------------------------
    def events_get_safars(self, *args, **kwargs):
        """Returns all registered safars along with date and event counts."""
        return self._events.get_safars(*args, **kwargs)

    def events_add_safar(self, *args, **kwargs):
        """Registers a new Safar."""
        return self._events.add_safar(*args, **kwargs)

    def events_update_safar_path(self, *args, **kwargs):
        """Updates the root path and creates AIN_Temp for an existing Safar."""
        return self._events.update_safar_path(*args, **kwargs)

    def events_update_safar_status(self, *args, **kwargs):
        """Updates the status of a Safar (e.g. 'completed', 'active')."""
        return self._events.update_safar_status(*args, **kwargs)

    def events_set_active_safar(self, *args, **kwargs):
        """Sets active safar and synchronizes app settings."""
        return self._events.set_active_safar(*args, **kwargs)

    def events_delete_safar(self, *args, **kwargs):
        """Deletes a Safar and its events."""
        return self._events.delete_safar(*args, **kwargs)

    def events_clear_all_safars(self, *args, **kwargs):
        """Clears all Safars, events, and assignments."""
        return self._events.clear_all_safars(*args, **kwargs)

    def events_check_safar_folder(self, *args, **kwargs):
        """Checks if chosen folder matches or contains the active Safar directory."""
        return self._events.check_safar_folder(*args, **kwargs)

    def events_get_cities(self, *args, **kwargs):
        """Returns list of registered cities with core team mappings."""
        return self._events.get_cities(*args, **kwargs)

    def events_add_city(self, *args, **kwargs):
        """Registers a new city with required team specifications."""
        return self._events.add_city(*args, **kwargs)

    def events_search_cities(self, *args, **kwargs):
        """Searches cities locally and queries Google / global geocoders for suggestions."""
        return self._events.search_cities(*args, **kwargs)

    def events_get_contributors(self, *args, **kwargs):
        """Returns list of registered crew contributors."""
        return self._events.get_contributors(*args, **kwargs)

    def events_add_contributor(self, *args, **kwargs):
        """Registers a new contributor / crew profile."""
        return self._events.add_contributor(*args, **kwargs)

    def events_update_contributor(self, *args, **kwargs):
        """Updates an existing contributor's details."""
        return self._events.update_contributor(*args, **kwargs)

    def events_select_crew_file(self, *args, **kwargs):
        """Native dialog to pick a crew roster file."""
        return self._events.select_crew_file(*args, **kwargs)

    def events_import_crew_file(self, *args, **kwargs):
        """Parses and imports a crew roster file for a Safar."""
        return self._events.import_crew_file(*args, **kwargs)

    def events_download_crew_template(self, *args, **kwargs):
        """Saves crew roster template to Safar AIN_Temp folder and system Downloads."""
        return self._events.download_crew_template(*args, **kwargs)

    def events_get_next_sequence(self, *args, **kwargs):
        """Calculates deterministic next sequence number scoped strictly to date|||slot."""
        return self._events.get_next_sequence(*args, **kwargs)

    def events_save_event(self, *args, **kwargs):
        """Saves or updates an event in local SQLite storage."""
        return self._events.save_event(*args, **kwargs)

    def events_sync_assignments(self, *args, **kwargs):
        """Synchronizes granular ceremony assignment rows."""
        return self._events.sync_assignments(*args, **kwargs)

    def events_list_events(self, *args, **kwargs):
        """Lists events with optional date, slot, and city filters."""
        return self._events.list_events(*args, **kwargs)

    def events_get_event(self, *args, **kwargs):
        """Retrieves full event details and child assignments."""
        return self._events.get_event(*args, **kwargs)

    def events_update_event(self, *args, **kwargs):
        """Updates event metadata and bumps updated_at."""
        return self._events.update_event(*args, **kwargs)

    def events_delete_event(self, *args, **kwargs):
        """Deletes an event and its cascading assignments."""
        return self._events.delete_event(*args, **kwargs)

    def events_select_export_dir(self, *args, **kwargs):
        """Opens folder dialog to pick export destination directory."""
        return self._events.select_export_dir(*args, **kwargs)

    def events_generate_folder_structure(self, *args, **kwargs):
        """Creates physical folder hierarchy formatted as {Safar_Name}/{Date}_{Slot}/{EventCode}/{Seq}_{Abr}_{Name}."""
        return self._events.generate_folder_structure(*args, **kwargs)

    def events_export_csv(self, *args, **kwargs):
        """Exports event assignments to an AIN53 compatible CSV file."""
        return self._events.export_csv(*args, **kwargs)

    def events_export_date_sync_csv(self, *args, **kwargs):
        """Exports slot events to human-readable Date Sync CSV for manual website synchronization."""
        return self._events.export_date_sync_csv(*args, **kwargs)

    def events_export_ain53(self, *args, **kwargs):
        """Exports the Safar or single date/slot to an .AIN53 sync package."""
        return self._events.export_ain53(*args, **kwargs)

    def events_import_ain53(self, *args, **kwargs):
        """Imports an .AIN53 sync package into local database."""
        return self._events.import_ain53(*args, **kwargs)

    def events_get_ain53_package_data(self, *args, **kwargs):
        """Returns .AIN53 JSON package data without prompting save dialog."""
        return self._events.get_ain53_package_data(*args, **kwargs)

    def events_pick_inventory_report(self):
        """Opens native file dialog for selecting an Inventory Report."""
        if self._window:
            result = self._window.create_file_dialog(
                webview.FileDialog.OPEN,
                file_types=("Inventory Reports (*.xlsx;*.csv)", "All Files (*.*)")
            )
            if result and len(result) > 0:
                path = result[0]
                return json.dumps({"success": True, "path": path, "filename": os.path.basename(path)})
        return json.dumps({"canceled": True})

    def events_upload_slot_inventory(self, *args, **kwargs):
        """Uploads and parses an Inventory Report for a specific slot."""
        return self._events.upload_slot_inventory(*args, **kwargs)

    def events_get_slot_inventory(self, *args, **kwargs):
        """Fetches the uploaded inventory report and event completion status for a slot."""
        return self._events.get_slot_inventory(*args, **kwargs)

    def events_end_event_slot(self, *args, **kwargs):
        """Marks all events in the specified date/slot as ENDED."""
        return self._events.end_event_slot(*args, **kwargs)

    def events_export_team_images_zip(self, *args, **kwargs):
        """Exports team assignment images into a ZIP archive."""
        return self._events.export_team_images_zip(*args, **kwargs)

    def events_import_csv(self, *args, **kwargs):
        """Imports CSV data and populates sequence assignments."""
        return self._events.import_csv(*args, **kwargs)

    def events_get_event_definitions(self, *args, **kwargs):
        """Returns standard event abbreviations and names from Event List.xlsx."""
        return self._events.get_event_definitions(*args, **kwargs)

    def events_select_import_file(self, *args, **kwargs):
        """Launches native file dialog to pick an Excel (.xlsx, .xls) or CSV file."""
        return self._events.select_import_file(*args, **kwargs)

    def events_read_table_as_csv(self, *args, **kwargs):
        """Reads an Excel or CSV file and converts it into standard CSV text."""
        return self._events.read_table_as_csv(*args, **kwargs)

    def events_select_sharaf_file(self, *args, **kwargs):
        """Launches native file dialog to pick a Sharaf Data Excel / CSV file."""
        return self._events.select_sharaf_file(*args, **kwargs)

    def events_parse_sharaf_file(self, *args, **kwargs):
        """Parses Sharaf Data Excel / CSV file and groups into Bethak segment structures."""
        return self._events.parse_sharaf_file(*args, **kwargs)

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

    def sorting_auto_detect_mapping(self, *args, **kwargs):
        """Auto-detects mapping CSV in Document folder matching root folder name."""
        return self._sorting.auto_detect_mapping_file(*args, **kwargs)
        
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

    def sorting_generate_thumbnails_batch(self, *args, **kwargs):
        """Triggers parallel batch thumbnail decoding for photos and videos."""
        return self._sorting.generate_thumbnails_batch(*args, **kwargs)
        
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

    def check_for_updates_async(self):
        """
        Non-blocking update check — returns {status:'pending'} immediately.
        Result is pushed asynchronously via window.onUpdateCheckResult(result).
        Use this from the JS frontend to prevent UI freezing during network requests.
        """
        return self._updater.check_for_updates_async()


    def download_and_install_update(self, download_url=""):
        """Downloads latest update setup installer with progress events."""
        return self._updater.download_and_install_update(download_url)

    def apply_update_now(self):
        """Launches the downloaded setup installer and restarts the app with the update applied."""
        return self._updater.apply_update_now()

    def get_app_version(self):
        """Returns local application version from version.txt."""
        return json.dumps({"version": self._updater.get_local_version()})

    def get_all_settings(self):
        """Returns all persisted app settings as a JSON object string."""
        return self._updater.get_all_settings()

    def get_setting(self, key):
        """Returns a persisted app setting value by key (JSON encoded)."""
        return self._updater.get_setting(key)

    def set_setting(self, key, value):
        """Persists an app setting value. Returns {success: true} on success."""
        return self._updater.set_setting(key, value)

    def set_settings(self, settings_json):
        """Persists multiple app settings from JSON."""
        return self._updater.set_settings(settings_json)

    def settings_select_downloads_folder(self, *args, **kwargs):
        """Launches folder picker dialog for downloads/working folder and updates setting."""
        return self._updater.select_downloads_folder(*args, **kwargs)

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


    def reload_app(self):
        """Reloads the webview window cleanly and hot-reloads backend modules."""
        try:
            import importlib
            import backends.events_api
            importlib.reload(backends.events_api)
            self._events = backends.events_api.EventsAPI()
            if self._window:
                self._events._window = self._window
        except Exception as e:
            print("Error reloading events_api:", e)

        if self._window:
            try:
                frontend_path = BASE_DIR / "frontend" / "index.html"
                self._window.load_url(frontend_path.as_uri())
                return json.dumps({"success": True})
            except Exception as e:
                return json.dumps({"error": str(e)})
        return json.dumps({"success": True})

    def set_window(self, window):
        """Propagates the active PyWebView window reference down to all sub-APIs."""
        self._window = window
        self._pdf._window = window
        self._events._window = window
        self._csv._window = window
        self._sorting._window = window
        self._inventory._window = window
        self._updater.set_window(window)
        if getattr(self, '_mapper', None):
            self._mapper.set_window(window)

        # Stage 1: fire silent update check after 4-second startup delay.
        # Runs in a daemon thread — non-blocking, errors are swallowed.
        import threading
        def _delayed_silent_check():
            import time
            time.sleep(4.0)
            self._updater.silent_check_and_push()
        threading.Thread(target=_delayed_silent_check, daemon=True,
                         name="updater-startup-delay").start()

    # --------------------------------------------------------------------------
    # SECTION: App Edition & Telemetry
    # --------------------------------------------------------------------------
    def get_app_edition(self):
        """Returns the active application build edition."""
        is_admin = self.edition.lower() == "admin"
        return json.dumps({"edition": self.edition, "is_admin": is_admin})

    def log_feature(self, feature_name, details=None, category="ui"):
        """Logs a feature addition / invocation with date-time stamp in the background."""
        try:
            from backends.feature_logger import note_feature
            rec = note_feature(feature_name, details, category=category, edition=self.edition)
            return json.dumps({"success": True, "record": rec})
        except Exception as e:
            return json.dumps({"error": str(e)})

    # --------------------------------------------------------------------------
    # SECTION: Exif Tools Endpoints
    # --------------------------------------------------------------------------
    def exif_inspect_folder(self, folder_path):
        """Inspects folder media for EXIF timestamps and series rollover status."""
        try:
            import datetime
            from backends.exif_tools import get_media_capture_timestamp
            results = []
            if os.path.isdir(folder_path):
                for f in os.listdir(folder_path):
                    fp = os.path.join(folder_path, f)
                    if os.path.isfile(fp):
                        ts = get_media_capture_timestamp(fp)
                        formatted_str = datetime.datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M:%S") if ts else "N/A"
                        results.append({
                            "name": f,
                            "timestamp": ts,
                            "formatted": formatted_str
                        })
            return json.dumps({"success": True, "files": results})
        except Exception as e:
            return json.dumps({"error": str(e)})

    # --------------------------------------------------------------------------
    # SECTION: Admin-Exclusive Inventory Mapping Endpoints
    # --------------------------------------------------------------------------
    def admin_select_inventory_excel(self, path=None):
        if not getattr(self, '_mapper', None):
            return json.dumps({"error": "Admin feature not available in Standard edition"})
        return self._mapper.select_inventory_excel(path)

    def admin_select_source_dump(self, path=None):
        if not getattr(self, '_mapper', None):
            return json.dumps({"error": "Admin feature not available in Standard edition"})
        return self._mapper.select_source_dump(path)

    def admin_select_dest_folder(self, path=None):
        if not getattr(self, '_mapper', None):
            return json.dumps({"error": "Admin feature not available in Standard edition"})
        return self._mapper.select_dest_folder(path)

    def admin_preview_mapping(self, excel_path, source_dir, dest_dir=None):
        if not getattr(self, '_mapper', None):
            return json.dumps({"error": "Admin feature not available in Standard edition"})
        return self._mapper.preview_mapping(excel_path, source_dir, dest_dir)

    def admin_execute_mapping(self, excel_path, source_dir, dest_dir, move_files=False):
        if not getattr(self, '_mapper', None):
            return json.dumps({"error": "Admin feature not available in Standard edition"})
        return self._mapper.execute_mapping(excel_path, source_dir, dest_dir, move_files)


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


def unregister_ain53_file_association():
    """
    Ensures .AIN53 files are NOT associated or opened with AIN53 or the viewer.
    Cleans up any user registry associations previously set.
    """
    if sys.platform == "win32":
        try:
            import winreg

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
            log_debug(f"unregister_ain53_file_association win32 note: {e}")


# ==============================================================================
# APPLICATION MAIN INITIALIZATION
# ==============================================================================
if __name__ == '__main__':
    try:
        # Ensure .AIN53 files are NOT associated or opened with AIN53 / viewer
        unregister_ain53_file_association()

        # Initialize our RPC API gateway
        api = UnifiedApi()

        # Standard Desktop App Mode (PyWebView container)
        frontend_path = BASE_DIR / "frontend" / "index.html"
        log_debug(f"frontend_path: {frontend_path} (exists? {frontend_path.exists()})")
        
        frontend_uri = frontend_path.as_uri()
        log_debug(f"frontend_uri: {frontend_uri}")
        
        win_title = "AIN53 Data Management — Admin Edition" if APP_EDITION.lower() == "admin" else "AIN53 Data Management"
        window = webview.create_window(
            title=win_title,
            url=frontend_uri,
            js_api=api,
            width=1280,
            height=880,
            min_size=(900, 600),
            maximized=True
        )
        
        api.set_window(window)
        
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
