"""
Backend API: Drive Inventory Crawler & Report Compiler
=======================================================

This module traverses storage volumes, detects missing file sequence gaps, 
identifies corrupt/incomplete media structures, and builds styled multi-tab Excel workbooks
summarizing drive statistics and integrity issues.
"""

import os
import pandas as pd
import re
import json
import webview
from collections import defaultdict
from openpyxl.styles import PatternFill, Font
from openpyxl.utils import get_column_letter

try:
    from backends.exif_tools import find_missing_with_exif_rollover_support
except Exception:
    find_missing_with_exif_rollover_support = None

try:
    from backends.feature_logger import note_feature
except Exception:
    note_feature = None

# ==============================================================================
# FILE EXTENSION CLASSIFICATIONS
# ==============================================================================
# Supported standard graphic and RAW image extensions
PHOTO_EXTENSIONS = {'.cr2', '.cr3', '.arw', '.nef', '.jpg', '.jpeg', '.png', '.heic', '.tif', '.tiff', '.dng', '.webp', '.gif'}
# Supported video container formats
VIDEO_EXTENSIONS = {'.mov', '.mp4', '.mts', '.m4v', '.mkv', '.avi', '.flv', '.webm', '.wmv', '.3gp'}
# Permissible auxiliary metadata sidecar extensions
SIDECAR_EXTENSIONS = {'.xml', '.pkf', '.xmp', '.thm', '.srt', '.lrf'}


# ==============================================================================
# STRING PARSING & SORTING HELPER FUNCTIONS
# ==============================================================================
def natural_keys(text):
    """
    Splits text into digits and non-digits to perform alphanumeric sorting.
    This ensures "img9.jpg" sorts before "img10.jpg" (natural sorting).
    """
    return [int(c) if c.isdigit() else c.lower() for c in re.split(r'(\d+)', str(text))]


def parse_sequence_info(filename):
    """
    Parses a filename to extract its name prefix, sequence number digits, suffix, and extension.
    Useful for scanning numerical gaps in sequence lists (e.g., DSC_0001.JPG to DSC_0005.JPG).
    """
    if '.' in filename:
        name_part, ext = filename.rsplit('.', 1)
        ext = '.' + ext
    else:
        name_part, ext = filename, ''
        
    # Search for numeric blocks in the name. We match the last numeric set as the sequence counter.
    match = list(re.finditer(r'\d+', name_part))
    if match:
        last_match = match[-1]
        start, end = last_match.span()
        seq_str = name_part[start:end]
        prefix = name_part[:start]
        suffix = name_part[end:]
        return prefix, seq_str, suffix, ext
    else:
        return name_part, None, '', ext


def get_camera_prefix(filename):
    """
    Analyzes standard file names (e.g. IMG_0023.JPG or A7R_1234.MP4) to extract camera model prefix signatures.
    Returns: A label string like "A7R (Photo)" or "Other (Video)".
    """
    prefix, seq_str, suffix, ext = parse_sequence_info(filename)
    
    # Strip common long timestamp stamps (like date sequences 20260715) to get clean device tags
    clean_prefix = re.sub(r'\d{6,}', '', prefix)
    clean_prefix = clean_prefix.strip('_- ')
    
    # Capture alphabetic prefixes
    match = re.match(r'^([a-zA-Z]+[0-9]*)', clean_prefix)
    if match:
        clean_prefix = match.group(1)
    if not clean_prefix:
        clean_prefix = "Other"
        
    _, ext_lower = os.path.splitext(filename.lower())
    if ext_lower in PHOTO_EXTENSIONS:
        media = "Photo"
    elif ext_lower in VIDEO_EXTENSIONS:
        media = "Video"
    else:
        media = "Misc"
    return f"{clean_prefix} ({media})"


def find_missing_in_sequence(files_list):
    """
    Compares adjacent files in sorted sequence list groups (matched by prefix + suffix + ext) 
    to detect missing sequential counts.
    """
    groups = {}
    for f in files_list:
        filename = f['name']
        camera_type = f['camera_type']
        prefix, seq_str, suffix, ext = parse_sequence_info(filename)
        norm_suffix = '' if suffix == '_' else suffix
        
        if seq_str:
            seq_num = int(seq_str)
            seq_len = len(seq_str)
            group_key = (prefix, norm_suffix, ext, camera_type)
            if group_key not in groups:
                groups[group_key] = []
            groups[group_key].append((seq_num, seq_len, f))
            
    missing_records = []
    # Identify numerical index skips
    for (prefix, norm_suffix, ext, camera_type), items in groups.items():
        items.sort(key=lambda x: x[0])
        for i in range(len(items) - 1):
            curr_seq, curr_len, _ = items[i]
            next_seq, _, _ = items[i+1]
            diff = next_seq - curr_seq
            
            # If gap exists (diff > 1), register missing filenames
            # Limit the gap to 50,000 files to prevent out-of-memory issues on corrupted entries.
            if 1 < diff < 50000:
                for missing_num in range(curr_seq + 1, next_seq):
                    padded_seq = str(missing_num).zfill(curr_len)
                    reconstructed = f"{prefix}{padded_seq}{norm_suffix}{ext}"
                    missing_records.append({
                        'name': reconstructed,
                        'is_missing': True,
                        'camera_type': camera_type
                    })
    return missing_records


# ==============================================================================
# MAIN DRIVE INVENTORY CRAWLER API
# ==============================================================================
class DriveInventoryApi:
    """
    API endpoints for executing drive scanning and report exports.
    """
    def __init__(self):
        self._window = None
        # Diagnostic warning accumulator
        self.issues_log = []

    def inventory_select_drive(self, path=None):
        """Opens native directory dialog to set root scan folder."""
        if path: 
            if not os.path.isdir(path):
                if self._window:
                    self._window.evaluate_js("window.showToast('Please select/drop a valid folder/directory.', true)")
                return json.dumps({"error": "Invalid directory"})
            try:
                from backends.updater import AutoUpdater
                AutoUpdater().set_setting("inventory_drive_path", path)
            except Exception:
                pass
            return json.dumps({"path": path})
        if not self._window: 
            return json.dumps({"error": "No window"})
        
        result = self._window.create_file_dialog(webview.FileDialog.FOLDER)
        if result:
            path_val = result[0] if isinstance(result, (list, tuple)) else result
            try:
                from backends.updater import AutoUpdater
                AutoUpdater().set_setting("inventory_drive_path", path_val)
            except Exception:
                pass
            return json.dumps({"path": path_val})
        return json.dumps({"error": "Cancelled"})

    def inventory_select_save_file(self, default_name, directory=None):
        """Opens native save dialog to specify target Excel filepath."""
        if not self._window: 
            return json.dumps({"error": "No window"})
        
        save_dir = directory if directory and os.path.isdir(directory) else None
        result = self._window.create_file_dialog(
            webview.FileDialog.SAVE,
            directory=save_dir or "",
            save_filename=f"{default_name}.xlsx",
            file_types=("Excel Files (*.xlsx)",)
        )
        if result:
            path_val = result[0] if isinstance(result, (list, tuple)) else result
            try:
                from backends.updater import AutoUpdater
                AutoUpdater().set_setting("inventory_save_path", path_val)
            except Exception:
                pass
            return json.dumps({"path": path_val})
        return json.dumps({"error": "Cancelled"})

    def _process_folder_files(self, folder_path, files):
        """
        Inspects files inside a specific directory:
        1. Checks file sizes: Flags photo/video files < 1MB as potentially corrupt.
        2. Inspects extensions: Flags non-standard suffixes.
        3. Identifies missing sequence records.
        """
        existing_files = []
        for f in files:
            full_path = os.path.join(folder_path, f)
            file_size = 0
            try:
                file_size = os.stat(full_path).st_size
            except Exception as e:
                # Log system access file errors
                self.issues_log.append({
                    'Path': full_path,
                    'Issue Type': 'File Stat Error',
                    'Description': f"Failed to access file details: {str(e)}"
                })
                
            camera_type = get_camera_prefix(f)
            existing_files.append({
                'name': f,
                'is_missing': False,
                'camera_type': camera_type
            })
            
            _, ext = os.path.splitext(f.lower())
            
            # Skip checking/logging metadata sidecar files
            if ext in SIDECAR_EXTENSIONS:
                continue
                
            # Log warnings for unknown file extensions
            if ext not in PHOTO_EXTENSIONS and ext not in VIDEO_EXTENSIONS:
                self.issues_log.append({
                    'Path': full_path,
                    'Issue Type': 'Notice - Other Extension',
                    'Description': f"File has non-standard extension: {ext if ext else 'no extension'}"
                })
            
            # Flag photos/videos under 1 MB as potentially truncated/corrupted
            if ext in PHOTO_EXTENSIONS or ext in VIDEO_EXTENSIONS:
                if file_size > 0 and file_size < 1 * 1024 * 1024:  # 1 MB
                    size_kb = file_size / 1024
                    self.issues_log.append({
                        'Path': full_path,
                        'Issue Type': 'Small File Size',
                        'Description': f"File is only {size_kb:.1f} KB (under 1 MB) — may be corrupt or incomplete"
                    })
            
        # Discover gaps in this folder's sequence ranges (with Exif rollover 600/9999 support)
        if find_missing_with_exif_rollover_support:
            try:
                missing_files = find_missing_with_exif_rollover_support(existing_files)
            except Exception:
                missing_files = find_missing_in_sequence(existing_files)
        else:
            missing_files = find_missing_in_sequence(existing_files)
        combined = existing_files + missing_files
        # Re-sort utilizing natural keys
        combined.sort(key=lambda x: natural_keys(x['name']))
        return combined

    def _dfs_scan(self, directory, all_folders, in_contributor=False, contributor_files=None, state=None):
        """
        Depth-First-Search crawler. Recursively scans directories to aggregate folders.
        Filters out system configuration files (e.g. Thumbs.db, desktop.ini).
        """
        if contributor_files is None:
            contributor_files = []
        if state is None:
            state = {"count": 0}
            
        try:
            entries = list(os.scandir(directory))
        except Exception as e:
            self.issues_log.append({
                'Path': directory,
                'Issue Type': 'Permission/Access Error',
                'Description': f"Failed to list directory contents: {str(e)}"
            })
            return
            
        files = []
        subfolders = []
        
        # Sort and filter files using fast DirEntry cached metadata
        for entry in entries:
            name = entry.name
            # Skip OS junk files
            if name.startswith('.') or name.startswith('._') or name.startswith('~$') or name == 'Icon\r' or name in ['Thumbs.db', 'desktop.ini']:
                continue
            try:
                if entry.is_dir(follow_symlinks=False):
                    subfolders.append(name)
                else:
                    files.append(name)
            except Exception as e:
                self.issues_log.append({
                    'Path': entry.path,
                    'Issue Type': 'Check Dir/File Error',
                    'Description': f"Could not determine if directory or file: {str(e)}"
                })
                
        subfolders.sort(key=natural_keys)
        files.sort(key=natural_keys)
        
        folder_name = os.path.basename(directory)
        # Check if currently inside a contributor directory
        if folder_name.lower() == 'contributor':
            in_contributor = True
            
        if in_contributor:
            # Store contributor assets directly in flattened arrays
            for item in files:
                full_path = os.path.join(directory, item)
                _, ext = os.path.splitext(item.lower())
                if ext not in PHOTO_EXTENSIONS and ext not in VIDEO_EXTENSIONS and ext not in SIDECAR_EXTENSIONS:
                    self.issues_log.append({
                        'Path': full_path,
                        'Issue Type': 'Notice - Other Extension',
                        'Description': f"File in contributor folder has non-standard extension: {ext if ext else 'no extension'}"
                    })
                contributor_files.append({
                    'Folder Path': directory,
                    'File Name': item
                })
                state["count"] += 1
                if self._window and state["count"] % 100 == 0:
                    self._window.evaluate_js(f"window.ProgressController.update(0, 'Scanned {state['count']} files...')")
        else:
            state["count"] += len(files)
            if self._window and state["count"] % 100 == 0:
                self._window.evaluate_js(f"window.ProgressController.update(0, 'Scanned {state['count']} files...')")
            
            # Analyze files and sequence missing records
            folder_files = self._process_folder_files(directory, files)
            all_folders.append({
                'folder_path': directory,
                'folder_name': folder_name,
                'files': folder_files,
                'has_subfolders': len(subfolders) > 0
            })
        
        # Recursively scan children folders
        for sub in subfolders:
            self._dfs_scan(os.path.join(directory, sub), all_folders, in_contributor, contributor_files, state)

    def inventory_generate_report(self, root_directory, output_excel_path):
        """
        Orchestrates scanning and maps stats into a styled multi-tab Excel Workbook.
        Creates sheets:
        1. 'Missing Files' (list of sequence gaps, highlighted in Red)
        2. 'Folder Structure' (visual column-based tree structure representing disk directories)
        3. 'Camera Summary' (device statistics listing file counts and missing rates)
        4. 'Contributor' (listing files found in dedicated contributor uploads)
        5. 'Issues' (system logs representing small sizes or unknown files)
        """
        if isinstance(root_directory, (list, tuple)) and len(root_directory) > 0:
            root_directory = root_directory[0]
        if isinstance(output_excel_path, (list, tuple)) and len(output_excel_path) > 0:
            output_excel_path = output_excel_path[0]

        self.issues_log = []
        all_folders = []
        contributor_files = []
        
        if self._window:
            self._window.evaluate_js("window.ProgressController.start('Drive Inventory', 'Scanning file system...', 0)")
            
        # Execute DFS crawl
        self._dfs_scan(root_directory, all_folders, in_contributor=False, contributor_files=contributor_files, state={"count": 0})
        
        # Collect all files present anywhere in the selected directory (regardless of folder depth)
        all_drive_present_files = set()
        for folder in all_folders:
            for f in folder['files']:
                if not f.get('is_missing', False):
                    all_drive_present_files.add(f['name'].lower())
        for cf in contributor_files:
            all_drive_present_files.add(cf['File Name'].lower())

        # Requirement 2 Fix: If a file exists anywhere in the selected directory
        # (even if in a folder without an intermediate folder in between),
        # it is seen as present only and MUST NOT be considered as a missing file!
        for folder in all_folders:
            folder['files'] = [
                f for f in folder['files']
                if not (f.get('is_missing', False) and f['name'].lower() in all_drive_present_files)
            ]

        total_files = sum(len(f['files']) for f in all_folders) + len(contributor_files)
        if self._window:
            self._window.evaluate_js(f"window.ProgressController.start('Drive Inventory', 'Generating Excel Report...', {total_files})")
            self._window.evaluate_js("window.ProgressController.update(0, 'Formatting sheets...')")
        
        if not all_folders and not contributor_files:
            return json.dumps({"error": "No folders or files found."})
            
        # Compile unique camera devices/prefixes
        seen_cameras = set()
        for folder in all_folders:
            for f in folder['files']:
                if not f['is_missing']:
                    if "(Misc)" not in f['camera_type']:
                        seen_cameras.add(f['camera_type'])
                    
        camera_rankings = sorted(list(seen_cameras), key=natural_keys)
        # Create standard Cam 01, Cam 02 labels
        cam_to_label = {cam: f"Cam {str(idx+1).zfill(2)}" for idx, cam in enumerate(camera_rankings)}
        
        # Gather missing records for Tab 1
        sheet1_data = []
        for folder in all_folders:
            for f in folder['files']:
                if f['is_missing'] and "(Misc)" not in f['camera_type']:
                    sheet1_data.append({
                        'Folder Path': folder['folder_path'],
                        'File Name': f['name'],
                        'Status': 'MISSING',
                        'Camera Type': f['camera_type']
                    })
        df_sheet1 = pd.DataFrame(sheet1_data)
        
        try:
            # Initialize openpyxl excel writer context
            with pd.ExcelWriter(output_excel_path, engine='openpyxl') as writer:
                # Remove default empty sheet created by openpyxl if present
                if 'Sheet' in writer.book.sheetnames:
                    writer.book.remove(writer.book['Sheet'])

                # Custom cell styles and fills
                red_fill = PatternFill(start_color='FFFFC7CE', end_color='FFFFC7CE', fill_type='solid')
                red_font = Font(color='9C0006', bold=True)
                yellow_fill = PatternFill(start_color='FFFFFF00', end_color='FFFFFF00', fill_type='solid')
                blue_fill = PatternFill(start_color='DDEBF7', end_color='DDEBF7', fill_type='solid')
                blue_font = Font(color='1F4E78', bold=False)
                bold_font = Font(bold=True)
                
                # --- TAB 1: Missing Files ---
                if not df_sheet1.empty:
                    df_sheet1.to_excel(writer, sheet_name='Missing Files', index=False)
                else:
                    pd.DataFrame(columns=['Folder Path', 'File Name', 'Status', 'Camera Type']).to_excel(writer, sheet_name='Missing Files', index=False)
                    
                # Format sheet 1 with red fill warnings
                ws1 = writer.sheets['Missing Files']
                for row in range(2, ws1.max_row + 1):
                    for col in range(1, ws1.max_column + 1):
                        cell = ws1.cell(row=row, column=col)
                        cell.fill = red_fill
                        cell.font = red_font
                        
                # --- TAB 2: Folder Structure tree view ---
                ws2 = writer.book.create_sheet(title='Folder Structure')
                from collections import defaultdict
                grouped_folders = defaultdict(list)
                for folder in all_folders:
                    if len(folder['files']) > 0:
                        parent_dir = os.path.dirname(folder['folder_path'])
                        rel_parent = os.path.relpath(parent_dir, root_directory)
                        grouped_folders[rel_parent].append(folder)
                        
                sorted_parent_paths = sorted(list(grouped_folders.keys()), key=natural_keys)
                header_fill = PatternFill(start_color='DDEBF7', end_color='DDEBF7', fill_type='solid')
                header_font = Font(bold=True, size=11, color='1F4E78')
                subheader_fill = PatternFill(start_color='F2F2F2', end_color='F2F2F2', fill_type='solid')
                subheader_font = Font(bold=True, size=10, italic=True)
                
                # Build tree columns layout
                for col_idx, parent_path in enumerate(sorted_parent_paths, start=1):
                    if parent_path in ('.', '..'):
                        parent_display_name = os.path.basename(root_directory.rstrip('/\\'))
                        if not parent_display_name:
                            parent_display_name = "Root"
                    else:
                        parent_display_name = parent_path
                        
                    cell = ws2.cell(row=1, column=col_idx, value=parent_display_name)
                    cell.font = header_font
                    cell.fill = header_fill
                    
                    folders_list = grouped_folders[parent_path]
                    folders_list.sort(key=lambda x: natural_keys(x['folder_name']))
                    
                    current_row = 2
                    for folder in folders_list:
                        sub_cell = ws2.cell(row=current_row, column=col_idx, value=f"📂 {folder['folder_name']}")
                        sub_cell.font = subheader_font
                        sub_cell.fill = subheader_fill
                        current_row += 1
                        
                        ext_counts = defaultdict(int)
                        for f in folder['files']:
                            cell_file = ws2.cell(row=current_row, column=col_idx, value=f['name'])
                            if f['is_missing']:
                                cell_file.fill = red_fill
                                cell_file.font = red_font
                            else:
                                _, ext = os.path.splitext(f['name'].lower())
                                ext_counts[ext] += 1
                                if ext not in PHOTO_EXTENSIONS and ext not in VIDEO_EXTENSIONS:
                                    cell_file.fill = blue_fill
                                    cell_file.font = blue_font
                            current_row += 1
                            
                        for ext in sorted(ext_counts.keys(), key=natural_keys):
                            count = ext_counts[ext]
                            if count > 0:
                                display_name = ext if ext else "no extension"
                                cell_ext = ws2.cell(row=current_row, column=col_idx, value=f"{display_name}: {count}")
                                cell_ext.font = bold_font
                                if ext not in PHOTO_EXTENSIONS and ext not in VIDEO_EXTENSIONS:
                                    cell_ext.fill = yellow_fill
                                current_row += 1
                        current_row += 1
 
                # --- TAB 3: Camera Summary list ---
                ws3 = writer.book.create_sheet(title='Camera Summary')
                camera_files = {cam: [] for cam in camera_rankings}
                for folder in all_folders:
                    for f in folder['files']:
                        if not f['is_missing']:
                            cam = f['camera_type']
                            if cam in camera_files:
                                camera_files[cam].append(f)
                                
                camera_series_combined = {}
                for cam in camera_rankings:
                    existing = camera_files[cam]
                    if find_missing_with_exif_rollover_support:
                        try:
                            missing = find_missing_with_exif_rollover_support(existing)
                        except Exception:
                            missing = find_missing_in_sequence(existing)
                    else:
                        missing = find_missing_in_sequence(existing)
                    # Filter any missing file that actually exists anywhere in the drive
                    missing = [m for m in missing if m['name'].lower() not in all_drive_present_files]
                    combined = existing + missing
                    combined.sort(key=lambda x: natural_keys(x['name']))
                    camera_series_combined[cam] = combined
                    
                # Format camera breakdown columns
                for col_idx, cam in enumerate(camera_rankings, start=1):
                    label = cam_to_label.get(cam, cam)
                    cell = ws3.cell(row=1, column=col_idx, value=f"{label} ({cam})")
                    cell.font = bold_font
                    
                    current_row = 2
                    found_count = 0
                    missing_count = 0
                    
                    for f in camera_series_combined[cam]:
                        cell = ws3.cell(row=current_row, column=col_idx, value=f['name'])
                        if f['is_missing']:
                            cell.fill = red_fill
                            cell.font = red_font
                            missing_count += 1
                        else:
                            found_count += 1
                        current_row += 1
                        
                    cell_sum = ws3.cell(row=current_row, column=col_idx, value=f"Total Found: {found_count}")
                    cell_sum.font = bold_font
                    current_row += 1
                    cell_miss = ws3.cell(row=current_row, column=col_idx, value=f"Total Missing: {missing_count}")
                    cell_miss.font = bold_font
                    cell_miss.fill = red_fill

                # --- TAB 4: Contributor Submissions ---
                df_contributor = pd.DataFrame(contributor_files)
                if not df_contributor.empty:
                    # Sort contributor rows utilizing natural sorting keys
                    df_contributor['Sort_Key_Path'] = df_contributor['Folder Path'].apply(lambda x: tuple(natural_keys(x)))
                    df_contributor['Sort_Key_Name'] = df_contributor['File Name'].apply(lambda x: tuple(natural_keys(x)))
                    df_contributor.sort_values(by=['Sort_Key_Path', 'Sort_Key_Name'], inplace=True)
                    df_contributor.drop(columns=['Sort_Key_Path', 'Sort_Key_Name'], inplace=True)
                    df_contributor.to_excel(writer, sheet_name='Contributor', index=False)
                else:
                    pd.DataFrame(columns=['Folder Path', 'File Name']).to_excel(writer, sheet_name='Contributor', index=False)

                # --- TAB 5: System Issues Log ---
                df_issues = pd.DataFrame(self.issues_log)
                if not df_issues.empty:
                    df_issues.to_excel(writer, sheet_name='Issues', index=False)
                else:
                    pd.DataFrame(columns=['Path', 'Issue Type', 'Description']).to_excel(writer, sheet_name='Issues', index=False)

                # Auto-adjust column widths dynamically based on length of maximum string values for all worksheets
                for ws in writer.book.worksheets:
                    for col in ws.columns:
                        max_len = 0
                        for cell in col:
                            if cell.value is not None:
                                max_len = max(max_len, len(str(cell.value)))
                        col_letter = get_column_letter(col[0].column)
                        ws.column_dimensions[col_letter].width = max(max_len + 3, 10)

            if self._window:
                self._window.evaluate_js("window.ProgressController.stop()")

            if note_feature:
                note_feature("Drive Inventory Report Generated", {
                    "root_dir": root_directory,
                    "output_path": output_excel_path,
                    "total_folders": len(all_folders),
                    "total_files": total_files,
                    "missing_count": len(sheet1_data)
                }, category="inventory")

            return json.dumps({"success": True, "path": output_excel_path})
        except Exception as e:
            if self._window:
                self._window.evaluate_js("window.ProgressController.stop()")
            return json.dumps({"error": str(e)})
