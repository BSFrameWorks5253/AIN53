import os
import shutil
import json
from pathlib import Path
import pandas as pd
import webview


def _get_app_setting(key, default=None):
    try:
        from backends.updater import AutoUpdater
        updater = AutoUpdater()
        val = updater._load_settings().get(key)
        return val if val is not None else default
    except Exception:
        return default


def _set_app_setting(key, val):
    try:
        from backends.updater import AutoUpdater
        updater = AutoUpdater()
        updater.set_setting(key, val)
    except Exception:
        pass


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
            _set_app_setting("csv_input_path", path)
            return json.dumps({"path": path})
        if not self._window: 
            return json.dumps({"error": "No window"})
        
        result = self._window.create_file_dialog(webview.FileDialog.OPEN, file_types=("CSV Files (*.csv)",))
        if result:
            selected = result[0]
            _set_app_setting("csv_input_path", selected)
            return json.dumps({"path": selected})
        return json.dumps({"error": "Cancelled"})

    def csv_select_dest(self, path=None):
        """
        Launches a directory folder selection dialog to set the target workspace path.
        """
        if path: 
            if not os.path.isdir(path):
                if self._window:
                    self._window.evaluate_js("window.showToast('Please select/drop a valid folder/directory.', true)")
                return json.dumps({"error": "Invalid directory"})
            _set_app_setting("csv_dest_path", path)
            return json.dumps({"path": path})
        if not self._window: 
            return json.dumps({"error": "No window"})
        
        result = self._window.create_file_dialog(webview.FileDialog.FOLDER)
        if result:
            selected = result[0]
            _set_app_setting("csv_dest_path", selected)
            return json.dumps({"path": selected})
        return json.dumps({"error": "Cancelled"})

    def csv_process(self, input_path, dest_dir):
        """
        Core folder compiler. Parses columns, extracts hierarchy tokens,
        designs corresponding physical folders on the storage media, and creates
        a default Document folder containing the mapping CSV and associated event docs.
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

        folder_name_col = None
        for col in df.columns:
            col_clean = col.strip().lower().replace('_', '').replace(' ', '').replace('-', '')
            if col_clean == 'foldername':
                folder_name_col = col
                break

        has_sub_event = 'Sub-Event List' in df.columns
        if not has_sub_event and not folder_name_col:
            # Check if this is a raw schedule CSV with Seq and Event
            cols_lower = [c.lower() for c in df.columns]
            if 'seq' in cols_lower and ('event' in cols_lower or 'sub event' in cols_lower):
                import re
                base_fn = Path(input_path).stem
                # Extract master date slot token from filename (e.g. "1448-02-25 _01M")
                m_match = re.search(r"(\d{4}-\d{2}-\d{2}\s*_\s*0[12][ME])", base_fn)
                master_name = m_match.group(1) if m_match else base_fn

                sub_event_col_name = next((c for c in df.columns if c.lower() == 'sub event'), None)
                event_col_name = next((c for c in df.columns if c.lower() == 'event'), None)
                seq_col_name = next((c for c in df.columns if c.lower() == 'seq'), None)
                stk_col_name = next((c for c in df.columns if c.lower() == 'sticker'), None)
                its_col_name = next((c for c in df.columns if c.lower() == 'its'), None)
                mauze_col_name = next((c for c in df.columns if c.lower() in ('mauze', 'location', 'city')), None)

                synthesized_sub_events = []
                synthesized_folder_names = []
                clean_rows_mask = []
                current_part_type = "Event"
                for idx, row in df.iterrows():
                    seq_v = str(row.get(seq_col_name) or "").strip()
                    if not seq_v or seq_v.lower() == 'nan':
                        clean_rows_mask.append(False)
                        continue
                    if seq_v.lower().startswith('part'):
                        current_part_type = str(row.get(event_col_name) or "").strip() or "Event"
                        clean_rows_mask.append(False)
                        continue

                    clean_rows_mask.append(True)
                    m_num = re.match(r"^(\d+)(.*)$", seq_v)
                    seq_fmt = f"{int(m_num.group(1)):02d}{m_num.group(2)}" if m_num else seq_v
                    evt_v = str(row.get(event_col_name) or current_part_type or "Event").strip()
                    if evt_v.lower() == 'nan':
                        evt_v = current_part_type or "Event"
                    stk_v = str(row.get(stk_col_name) or "").strip()
                    if stk_v.lower() == 'nan':
                        stk_v = ""
                    its_v = str(row.get(its_col_name) or "").strip()
                    if its_v.lower() == 'nan':
                        its_v = ""
                    mauze_v = str(row.get(mauze_col_name) or "Main").strip()
                    if mauze_v.lower() == 'nan':
                        mauze_v = "Main"
                    sub_evt_v = str(row.get(sub_event_col_name) or "").strip()
                    if not sub_evt_v or sub_evt_v.lower() == 'nan':
                        # Check if Name column contains sub event pattern (e.g. "1448-04-02 _ 01M-01-Waaz-Bilaspur")
                        name_col_val = str(row.get('Name') or "").strip()
                        if '-' in name_col_val:
                            n_parts = name_col_val.split('-')
                            if len(n_parts) >= 3:
                                sub_evt_v = f"{n_parts[1]}-{mauze_v}-{evt_v}"
                        if not sub_evt_v or sub_evt_v.lower() == 'nan':
                            sub_evt_v = f"01-{mauze_v}-{evt_v}"

                    sub_list_val = f"{master_name} - {sub_evt_v} - {seq_fmt}-{evt_v}"
                    mid_tok = stk_v if stk_v else evt_v
                    fn_val = f"{master_name}-{seq_fmt}-{mid_tok}-{its_v}" if its_v else f"{master_name}-{seq_fmt}-{mid_tok}-"

                    synthesized_sub_events.append(sub_list_val)
                    synthesized_folder_names.append(fn_val)

                # Filter df to clean data rows
                df = df[clean_rows_mask].copy().reset_index(drop=True)
                df['Sub-Event List'] = synthesized_sub_events
                df['Folder_Name'] = synthesized_folder_names
                has_sub_event = True
                folder_name_col = 'Folder_Name'
            else:
                return json.dumps({"error": "Input file is missing required columns: 'Sub-Event List' or 'Folder_Name'"})

        # Track distinct generated paths to return execution metrics to the UI.
        created_masters = set()
        created_leaves = set()
        created_subs = set()

        # --------------------------------------------------------------------------
        # DYNAMIC CONTRIBUTOR COLUMN SCANNER
        # --------------------------------------------------------------------------
        # Scan headers to find columns listing contributing photographers/camera numbers.
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

        # Scan all contributor event columns and the Contributor's Name column to index every crew member.
        cols_to_scan = list(contributor_event_cols)
        if contrib_name_col and contrib_name_col not in cols_to_scan:
            cols_to_scan.append(contrib_name_col)

        # First pass: Index all distinct contributors per Master folder.
        if cols_to_scan:
            for _, row in df.iterrows():
                sub_event_val = row.get('Sub-Event List') if has_sub_event else (row.get(folder_name_col) if folder_name_col else None)
                if pd.isna(sub_event_val) or str(sub_event_val).strip() == '' or str(sub_event_val).strip().lower() == 'nan':
                    continue

                sub_event_str = str(sub_event_val).strip()
                parts = [p.strip().rstrip('-').strip() for p in sub_event_str.split(' - ')]
                parts = [p for p in parts if p]
                if len(parts) < 1:
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
                
            sub_event_val = row.get('Sub-Event List') if has_sub_event else None
            fn_val = row.get(folder_name_col) if folder_name_col else None

            sub_event_str = str(sub_event_val).strip() if (sub_event_val is not None and pd.notna(sub_event_val)) else ''
            fn_str = str(fn_val).strip() if (fn_val is not None and pd.notna(fn_val) and str(fn_val).strip().lower() != 'nan') else ''

            if not sub_event_str and not fn_str:
                continue

            # Parse hierarchy tokens from sub_event_str or fn_str
            source_str = sub_event_str if sub_event_str else fn_str
            parts = [p.strip().rstrip('-').strip() for p in source_str.split(' - ')]
            parts = [p for p in parts if p]
            
            if len(parts) < 1:
                continue
                
            master_folder_name = parts[0]
            leaf_folder_name = parts[1] if len(parts) >= 2 else parts[0]
            
            if not master_folder_name:
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
                    for c_idx in range(1, num_cams + 1):
                        cam_name = f"Cam {c_idx:02d}"
                        cam_path = os.path.join(contributor_dir, cam_name)
                        os.makedirs(cam_path, exist_ok=True)

            # Create Leaf folder structure inside Master folder (if different from master)
            if leaf_folder_name != master_folder_name:
                leaf_folder_path = os.path.join(master_folder_path, leaf_folder_name)
                os.makedirs(leaf_folder_path, exist_ok=True)
                created_leaves.add(leaf_folder_path)
            else:
                leaf_folder_path = master_folder_path

            # Create Sub-folder structure inside Leaf folder (prioritize Folder_Name column over parts[2])
            subfolder_name = fn_str if fn_str else (parts[2] if len(parts) >= 3 and parts[2] else None)

            if subfolder_name and subfolder_name != leaf_folder_name and subfolder_name != master_folder_name:
                subfolder_path = os.path.join(leaf_folder_path, subfolder_name)
                os.makedirs(subfolder_path, exist_ok=True)
                created_subs.add(subfolder_path)

        # --------------------------------------------------------------------------
        # STEP 3: AUTOMATIC 'Document' FOLDER & MAPPING PIPELINE COMPILATION
        # --------------------------------------------------------------------------
        # Creates a default Document directory inside the master folder created by the user,
        # MOVES the mapping CSV and temporary working PDFs/CSVs into it,
        # and forwards the updated mapping CSV path to Media Sorting.
        if created_masters:
            for master_path in created_masters:
                os.makedirs(os.path.join(master_path, "Document"), exist_ok=True)
            primary_master = sorted(list(created_masters))[0]
            doc_dir = os.path.join(primary_master, "Document")
            sorting_root = primary_master
        else:
            doc_dir = os.path.join(dest_dir, "Document")
            os.makedirs(doc_dir, exist_ok=True)
            sorting_root = dest_dir

        working_folder = _get_app_setting("pdf_output_folder")
        pdf_src = _get_app_setting("pdf_source_path")
        csv_ext = _get_app_setting("pdf_extracted_csv_path")

        def _move_or_copy(src, dst):
            if not src or not os.path.isfile(src):
                return
            if os.path.abspath(src) == os.path.abspath(dst):
                return
            try:
                if os.path.exists(dst):
                    try:
                        os.remove(dst)
                    except Exception:
                        pass
                shutil.move(src, dst)
            except Exception:
                try:
                    shutil.copy2(src, dst)
                    try:
                        os.remove(src)
                    except Exception:
                        pass
                except Exception as ex:
                    print(f"[CSV-to-Folders] Notice: Could not move file {src} -> {dst}: {ex}")

        # 1. Save or copy the mapping CSV into Document/
        csv_filename = os.path.basename(input_path)
        new_mapping_path = os.path.join(doc_dir, csv_filename)
        try:
            df.to_csv(new_mapping_path, index=False)
        except Exception:
            try:
                shutil.copy2(input_path, new_mapping_path)
            except Exception as ex:
                print(f"[CSV-to-Folders] Notice: Could not copy mapping file: {ex}")
        if not os.path.exists(new_mapping_path) and os.path.exists(input_path):
            new_mapping_path = input_path

        # 2. Move working PDF into Document/
        if pdf_src and os.path.isfile(pdf_src):
            dst_pdf = os.path.join(doc_dir, os.path.basename(pdf_src))
            _move_or_copy(pdf_src, dst_pdf)
            if os.path.exists(dst_pdf):
                _set_app_setting("pdf_source_path", dst_pdf)

        # 3. Move working extracted CSV into Document/
        if csv_ext and os.path.isfile(csv_ext):
            dst_ext = os.path.join(doc_dir, os.path.basename(csv_ext))
            _move_or_copy(csv_ext, dst_ext)
            if os.path.exists(dst_ext):
                _set_app_setting("pdf_extracted_csv_path", dst_ext)

        # 4. Move any remaining temporary PDFs/CSVs from working_folder to Document/
        if working_folder and os.path.isdir(working_folder) and os.path.abspath(working_folder) != os.path.abspath(doc_dir):
            try:
                for item in os.listdir(working_folder):
                    if item.lower().endswith('.pdf') or item.lower().endswith('.csv') or item.lower().endswith('.xlsx'):
                        s_path = os.path.join(working_folder, item)
                        d_path = os.path.join(doc_dir, item)
                        _move_or_copy(s_path, d_path)
            except Exception:
                pass

        # Update persisted app settings with the new Document paths
        drive_name = os.path.basename(dest_dir.rstrip('/\\')) or "Media_Drive"
        default_inv_save = os.path.join(doc_dir, f"{drive_name}_Inventory_Report.xlsx")

        _set_app_setting("csv_input_path", new_mapping_path)
        _set_app_setting("csv_dest_path", dest_dir)
        _set_app_setting("sorting_mapping_path", new_mapping_path)
        _set_app_setting("sorting_root_path", sorting_root)
        _set_app_setting("inventory_drive_path", sorting_root)
        _set_app_setting("inventory_save_path", default_inv_save)

        # Build execution summary report text for UI display.
        success_text = (
            f"Folder creation completed successfully!\n"
            f"Master folders: {len(created_masters)}, Leaves: {len(created_leaves)}, Sub-folders: {len(created_subs)}\n"
            f"Document folder ready at: {doc_dir}"
        )
        
        if self._window:
            self._window.evaluate_js("window.ProgressController.stop()")

        try:
            from backends.feature_logger import note_feature
            note_feature("CSV Hierarchy Folder Creation", {
                "masters": len(created_masters),
                "leaves": len(created_leaves),
                "subs": len(created_subs),
                "dest_dir": dest_dir
            }, category="folders")
        except Exception:
            pass

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
            "subs": len(created_subs),
            "doc_dir": doc_dir,
            "updated_mapping_path": new_mapping_path,
            "dest_dir": sorting_root
        })
