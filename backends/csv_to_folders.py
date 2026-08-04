"""
Backend API: CSV to Folders Struct Generator
============================================

This module automates directory layout provisioning based on CSV structures.
It reads a CSV listing, extracts Sub-Event structures, parses contributor data,
and recursively constructs directories representing the hierarchical folders.
"""

import os
import pandas as pd
import json
import webview

class CsvToFoldersApi:
    """
    API class for mapping CSV entries to physical folder layouts.
    Exposed to the HTML front-end via PyWebView.
    """
    def __init__(self):
        self._window = None

    def csv_select_input(self, path=None):
        """
        Launches a file dialog window allowing the user to select the source CSV mapping file.
        """
        if path: 
            if not os.path.isfile(path) or not path.lower().endswith('.csv'):
                if self._window:
                    self._window.evaluate_js("window.showToast('Please select/drop a valid CSV file (.csv).', true)")
                return json.dumps({"error": "Invalid CSV file"})
            return json.dumps({"path": path})
        if not self._window: 
            return json.dumps({"error": "No window"})
        
        result = self._window.create_file_dialog(webview.FileDialog.OPEN, file_types=("CSV Files (*.csv)",))
        return json.dumps({"path": result[0]} if result else {"error": "Cancelled"})

    def csv_select_dest(self, path=None):
        """
        Launches a directory folder selection dialog to set the target workspace path.
        """
        if path: 
            if not os.path.isdir(path):
                if self._window:
                    self._window.evaluate_js("window.showToast('Please select/drop a valid folder/directory.', true)")
                return json.dumps({"error": "Invalid directory"})
            return json.dumps({"path": path})
        if not self._window: 
            return json.dumps({"error": "No window"})
        
        result = self._window.create_file_dialog(webview.FileDialog.FOLDER)
        return json.dumps({"path": result[0]} if result else {"error": "Cancelled"})

    def csv_process(self, input_path, dest_dir):
        """
        Core folder compiler. Parses columns, extracts hierarchy tokens,
        and designs corresponding physical folders on the storage media.
        """
        if not input_path or not dest_dir:
            return json.dumps({"error": "Input path and destination directory are required."})
            
        if not input_path.lower().endswith('.csv'):
            return json.dumps({"error": "Error: Only CSV files (.csv) are accepted."})

        # Load CSV utilizing pandas, casting all values to string type to prevent floating conversion.
        try:
            df = pd.read_csv(input_path, dtype=str)
        except Exception as e:
            return json.dumps({"error": f"Failed to read file: {e}"})

        # Clean trailing white spaces from sheet column headers.
        df.columns = [col.strip() for col in df.columns]

        required_columns = ['Sub-Event List']
        missing_cols = [col for col in required_columns if col not in df.columns]
        if missing_cols:
            return json.dumps({"error": f"Input file is missing required columns: {', '.join(missing_cols)}"})

        # Track distinct generated paths to return execution metrics to the UI.
        created_masters = set()
        created_leaves = set()
        created_subs = set()

        # --------------------------------------------------------------------------
        # DYNAMIC CONTRIBUTOR COLUMN SCANNER
        # --------------------------------------------------------------------------
        # Scan headers to find columns listing contributing photographers/camera numbers.
        # - Matches columns beginning with 'Contributors' (e.g. Contributors 1, Contributors 2)
        # - Resolves specific reference columns 'Contributor's Name' and 'Contributor's Series'
        contributor_event_cols = []
        contrib_name_col = None
        contrib_series_col = None

        for col in df.columns:
            col_lower = col.strip().lower()
            if col_lower == "contributor's name":
                contrib_name_col = col
            elif col_lower == "contributor's series":
                contrib_series_col = col
            elif col_lower.startswith('contributors'):
                contributor_event_cols.append(col)

        # Sort the contributor column keys to scan data in a predictable order.
        contributor_event_cols.sort()

        # Map to hold unique contributors belonging to each distinct Master folder.
        master_contributors = {}

        # Prioritize looking in specific contributor columns, falling back to basic columns.
        cols_to_scan = contributor_event_cols if contributor_event_cols else ([contrib_name_col] if contrib_name_col else [])

        # First pass: Index all distinct contributors per Master folder.
        if cols_to_scan:
            for _, row in df.iterrows():
                sub_event_val = row.get('Sub-Event List')
                if pd.isna(sub_event_val) or str(sub_event_val).strip() == '' or str(sub_event_val).strip().lower() == 'nan':
                    continue

                sub_event_str = str(sub_event_val).strip()
                # Split event levels. E.g., "EventA - TaskB"
                parts = [p.strip().rstrip('-').strip() for p in sub_event_str.split(' - ')]
                parts = [p for p in parts if p]
                if len(parts) < 2:
                    continue

                master_folder_name = parts[0]

                # Collect contributors, split sub-lists by comma (,), and register them to the Master group.
                for ccol in cols_to_scan:
                    val = row.get(ccol)
                    if pd.notna(val):
                        val_str = str(val).strip()
                        if val_str and val_str.lower() != 'nan':
                            names = [n.strip() for n in val_str.split(',')]
                            names = [n for n in names if n]
                            if names:
                                if master_folder_name not in master_contributors:
                                    master_contributors[master_folder_name] = set()
                                master_contributors[master_folder_name].update(names)

        total_rows = len(df)
        if self._window:
            self._window.evaluate_js(f"window.ProgressController.start('Creating Folders', 'Scanning CSV...', {total_rows})")

        # Second pass: Create the physical directories based on the compiled hierarchy.
        for i, row in df.iterrows():
            if self._window and i % 50 == 0:
                self._window.evaluate_js(f"window.ProgressController.update({i}, 'Processing row {i}...')")
                
            sub_event_val = row.get('Sub-Event List')
            if pd.isna(sub_event_val) or str(sub_event_val).strip() == '' or str(sub_event_val).strip().lower() == 'nan':
                continue

            sub_event_str = str(sub_event_val).strip()
            parts = [p.strip().rstrip('-').strip() for p in sub_event_str.split(' - ')]
            parts = [p for p in parts if p]
            
            if len(parts) < 2:
                continue
                
            master_folder_name = parts[0]
            leaf_folder_name = parts[1]
            
            if not master_folder_name or not leaf_folder_name:
                continue

            # Create Master folder structure
            master_folder_path = os.path.join(dest_dir, master_folder_name)
            if master_folder_path not in created_masters:
                os.makedirs(master_folder_path, exist_ok=True)
                created_masters.add(master_folder_path)
                
                # Retrieve the indexed contributors and create standard 'Cam 01', 'Cam 02' structures.
                contributors_set = master_contributors.get(master_folder_name, set())
                num_cams = len(contributors_set)
                if num_cams > 0:
                    contributor_dir = os.path.join(master_folder_path, "Contributor")
                    os.makedirs(contributor_dir, exist_ok=True)
                    for i in range(1, num_cams + 1):
                        cam_name = f"Cam {i:02d}"
                        cam_path = os.path.join(contributor_dir, cam_name)
                        os.makedirs(cam_path, exist_ok=True)

            # Create Leaf folder structure inside Master folder
            leaf_folder_path = os.path.join(master_folder_path, leaf_folder_name)
            os.makedirs(leaf_folder_path, exist_ok=True)
            created_leaves.add(leaf_folder_path)

            # Create Sub-folder structure inside Leaf folder (optional tier 3, if present)
            if len(parts) >= 3 and parts[2]:
                subfolder_name = parts[2]
                subfolder_path = os.path.join(leaf_folder_path, subfolder_name)
                os.makedirs(subfolder_path, exist_ok=True)
                created_subs.add(subfolder_path)

        # Build execution summary report text for UI display.
        success_text = (
            f"Folder creation completed successfully!\n"
            f"Master folders processed: {len(created_masters)}\n"
            f"Leaf folders created: {len(created_leaves)}\n"
            f"Sub-folders created: {len(created_subs)}"
        )
        
        if self._window:
            self._window.evaluate_js("window.ProgressController.stop()")

        # Automatically pop open the target destination folder in File Explorer (Windows) or Finder (macOS)
        try:
            if os.name == 'nt':
                os.startfile(dest_dir)
            else:
                import subprocess
                subprocess.Popen(['open', dest_dir])
        except Exception:
            pass

        return json.dumps({
            "success": success_text, 
            "masters": len(created_masters), 
            "leaves": len(created_leaves), 
            "subs": len(created_subs)
        })
