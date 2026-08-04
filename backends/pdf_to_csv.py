"""
Backend API: PDF to CSV Processor
=================================

This module provides automated data extraction capabilities for converting tabular PDF reports
into standard CSV formats. It uses `pdfplumber` for robust vector-based text and cell extraction,
and maps dynamic target headers based on fuzzy synonym patterns.
"""

import io
import os
import re
import json
import tempfile
from pathlib import Path

import pandas as pd
import pdfplumber
import webview

# ==============================================================================
# SCHEMA & DICTIONARIES
# ==============================================================================
# The target columns defined for the output CSV schema.
CSV_COLUMNS = ["Seq", "Event", "Sticker", "Name", "ITS", "Location", "Mobile", "Mauze", "Sub Event"]

# Synonym registry to link dynamic headers in PDF source tables to target CSV keys.
# PDF generators often label columns slightly differently; this mapping allows fuzzy/partial matching.
SYNONYM_MAP = {
    "Event":    ["sharaf", "z / m/ q", "z/m/q", "z / m / q", "z/ m/ q", "q/m/z", "q / m / z", "q / m/ z", "q/ m/ z", "q/m/ z", "q /m/z"],
    "Sticker":  ["sr", "sr."],
    "Name":     ["name"],
    "ITS":      ["its id", "its"],
    "Location": ["address", "link", "location"],
    "Mobile":   ["contact", "mobile"],
}

# Approved sticker codes representing primary events.
MAIN_STICKERS = {
    "Z", "M", "Q", "MZ", "MQ", "H", "MF", "QMZ", "AQ", "ID", "ZO", "BETHAK", "DR", "AM", "MO", "MZR", "MYN", "TQ", "S", "BQMZ", "BZ", "BM", "BQ", "G", "O",
}

# Secondary event sub-codes that are tabulated separately.
SUB_EVENT_CODES = {"N"}


# ==============================================================================
# HELPER FUNCTIONS
# ==============================================================================
def _clean(val):
    """
    Cleans cell data by removing multiple internal spaces and stripping leading/trailing whitespace.
    Converts None value objects directly to empty strings.
    """
    if val is None:
        return ""
    return re.sub(r"\s+", " ", str(val)).strip()


def _is_header_or_merged_row(row, total_cols):
    """
    Heuristic check to identify if a row is a repeating header or an informational merged cell.
    If a row contains very few non-empty cells relative to the table width, it is skipped.
    """
    non_empty = [c for c in row if c and str(c).strip()]
    if len(non_empty) <= 2 and total_cols > 4:
        return True
    return False


def _extract_raw_table(pdf_path, window=None):
    """
    Iterates page-by-page through the PDF file using pdfplumber to extract table objects.
    Communicates progress asynchronously to the web GUI container.
    """
    all_rows = []
    with pdfplumber.open(pdf_path) as pdf:
        total_pages = len(pdf.pages)
        
        # Start progress rendering in the UI
        if window:
            window.evaluate_js(f"window.ProgressController.start('Reading PDF', 'Extracting tables...', {total_pages})")
            
        for i, page in enumerate(pdf.pages):
            tables = page.extract_tables()
            for table in tables:
                for row in table:
                    all_rows.append(row)
            # Update progress indicator
            if window:
                window.evaluate_js(f"window.ProgressController.update({i + 1}, 'Processing page {i + 1} of {total_pages}')")
        
        # Shutdown progress bar
        if window:
            window.evaluate_js("window.ProgressController.stop()")

    if not all_rows:
        raise ValueError("No tables found in the PDF.")

    # Locate the header row by searching for the first row containing at least 4 filled cells.
    header_idx = 0
    for i, row in enumerate(all_rows):
        non_empty = [c for c in row if c and str(c).strip()]
        if len(non_empty) >= 4:
            header_idx = i
            break

    # Clean extracted headers or construct placeholder names if header is null/blank.
    raw_headers = [_clean(h) if h else f"Col_{j}" for j, h in enumerate(all_rows[header_idx])]
    data_rows = all_rows[header_idx + 1:]

    return raw_headers, data_rows


def _auto_map(pdf_headers):
    """
    Fuzzy maps the columns found in the PDF source files against target CSV fields
    using the registered SYNONYM_MAP.
    """
    mapping = {}
    lower_headers = [h.lower() for h in pdf_headers]

    for csv_col, synonyms in SYNONYM_MAP.items():
        matched = None
        for syn in synonyms:
            for ph, plh in zip(pdf_headers, lower_headers):
                if syn in plh:
                    matched = ph
                    break
            if matched:
                break
        mapping[csv_col] = matched

    # Unmapped/constructed metadata targets are explicitly set to None initially.
    mapping["Seq"] = None
    mapping["Mauze"] = None
    mapping["Sub Event"] = None

    return mapping


def _process_rows(raw_headers, data_rows, mapping, mauze, sr_start, sr_end, window=None):
    """
    Core data restructuring engine.
    This function processes the table rows, groups sub-rows belonging to the same serial/sticker 
    number, splits vertical multi-line values into multiple distinct records, and applies filters.
    """
    total_cols = len(raw_headers)
    total_rows = len(data_rows)
    if window:
        window.evaluate_js(f"window.ProgressController.start('Formatting CSV', 'Grouping stickers...', {total_rows})")

    # Map column headers to list index keys.
    col_index = {}
    for csv_col, pdf_hdr in mapping.items():
        if pdf_hdr and pdf_hdr in raw_headers:
            col_index[csv_col] = raw_headers.index(pdf_hdr)
        else:
            col_index[csv_col] = None

    # Safe getter utility
    def _get(row, csv_col):
        idx = col_index.get(csv_col)
        if idx is not None and idx < len(row):
            return _clean(row[idx])
        return ""

    # Step 1: Collect rows in groups keyed by their Sticker (Serial) number.
    # Tables often split a single sticker's participants into separate sub-rows.
    sr_groups = {}
    sr_order = []
    last_sr_val = None

    for i, row in enumerate(data_rows):
        if window and i % 100 == 0:
            window.evaluate_js(f"window.ProgressController.update({i}, 'Scanning row {i}...')")
        if _is_header_or_merged_row(row, total_cols):
            continue

        sr_val = _get(row, "Sticker")
        sr_num_match = re.match(r"^\d+$", sr_val)

        if sr_num_match:
            sr_num = int(sr_val)

            # Apply serial number range filters (if set in the UI)
            if sr_start is not None and sr_num < sr_start:
                last_sr_val = None
                continue
            if sr_end is not None and sr_num > sr_end:
                last_sr_val = None
                continue

            if sr_val not in sr_groups:
                sr_groups[sr_val] = []
                sr_order.append(sr_val)
            sr_groups[sr_val].append(row)
            last_sr_val = sr_val
        else:
            # If the row doesn't start with a new sticker ID, append it to the active group
            # (handles multi-line text split across sequential cells).
            if last_sr_val is not None and last_sr_val in sr_groups:
                sr_groups[last_sr_val].append(row)

    PRIMARY_EVENTS = {"Q", "M", "Z"}
    output_rows = []
    seq = 1

    # Step 2: Unroll and process groups.
    for sr_val in sr_order:
        group = sr_groups[sr_val]

        sticker_values = []
        names = []
        its_values = []
        mobiles = []
        locations = []

        # Process sub-rows inside each Sticker group.
        for row in group:
            event_val = _get(row, "Event")
            name_val = _get(row, "Name")
            its_val = _get(row, "ITS")
            mobile_val = _get(row, "Mobile")
            loc_val = _get(row, "Location")

            # Split cells containing newline characters (\n) into arrays of entries.
            event_lines = [e.strip() for e in event_val.split("\n") if e.strip()] if "\n" in event_val else [event_val]
            name_lines = [n.strip() for n in name_val.split("\n") if n.strip()] if "\n" in name_val else [name_val]
            its_lines = [i.strip() for i in its_val.split("\n") if i.strip()] if "\n" in its_val else [its_val]
            mobile_lines = [m.strip() for m in mobile_val.split("\n") if m.strip()] if "\n" in mobile_val else [mobile_val]

            # Re-align vertically split values
            max_len = max(len(event_lines), len(name_lines), len(its_lines), len(mobile_lines), 1)
            for idx in range(max_len):
                ev = event_lines[idx] if idx < len(event_lines) else (event_lines[-1] if event_lines else "")
                nm = name_lines[idx] if idx < len(name_lines) else ""
                it = its_lines[idx] if idx < len(its_lines) else ""
                mb = mobile_lines[idx] if idx < len(mobile_lines) else ""
                sticker_values.append(ev.upper().strip())
                names.append(nm)
                its_values.append(it)
                mobiles.append(mb)

            locations.append(loc_val)

        # Skip this group if none of the primary events (Q, M, Z) are represented.
        if not any(s in PRIMARY_EVENTS for s in sticker_values):
            continue

        # Count secondary/sub-events (e.g., code "N") to create aggregated summary string.
        from collections import Counter
        sub_counts = Counter(s for s in sticker_values if s and s not in MAIN_STICKERS)
        sub_event_str = ", ".join(f"{code}-{cnt}" for code, cnt in sorted(sub_counts.items())) if sub_counts else ""

        # Merge unique non-empty locations with semicolons.
        loc_combined = "; ".join(dict.fromkeys(l for l in locations if l))

        # Flatten the grouped arrays into final output rows.
        for i, sticker in enumerate(sticker_values):
            if sticker not in MAIN_STICKERS:
                continue
            row_dict = {
                "Seq": seq,
                "Event": sticker,
                "Sticker": sr_val,
                "Name": names[i] if i < len(names) else "",
                "ITS": its_values[i] if i < len(its_values) else "",
                "Location": loc_combined,
                "Mobile": mobiles[i] if i < len(mobiles) else "",
                "Mauze": mauze,
                "Sub Event": sub_event_str,
            }
            output_rows.append(row_dict)
            seq += 1

    if window:
        window.evaluate_js("window.ProgressController.stop()")
    return output_rows


# ==============================================================================
# PYWEBVIEW EXPOSED JS API HANDLER
# ==============================================================================
class PdfToCsvApi:
    """
    API methods for PDF table reading and formatting, exposed to the web frontend.
    """
    def __init__(self):
        self._raw_headers = []
        self._data_rows = []
        self._filename = ""
        self._window = None

    def pdf_pick_pdf(self, path=None):
        """
        Triggers file selection dialog, extracts headers, maps synonyms, 
        and extracts bounds for GUI display.
        """
        if path:
            pdf_path = path
        else:
            if not self._window:
                return json.dumps({"error": "Window not initialized."})
                
            # Launch native Windows file selection wizard
            result = self._window.create_file_dialog(
                webview.FileDialog.OPEN,
                file_types=("PDF Files (*.pdf)",),
            )
            if not result:
                return json.dumps({"error": "No file selected."})

            pdf_path = result[0]

        self._filename = Path(pdf_path).name

        try:
            # Run the extractor
            self._raw_headers, self._data_rows = _extract_raw_table(pdf_path, self._window)
        except Exception as e:
            return json.dumps({"error": str(e)})

        # Compute initial auto-mapped mapping values
        auto_mapping = _auto_map(self._raw_headers)

        # Locate Min/Max sticker numbers to pre-fill filtration bounds in the GUI.
        sr_idx = None
        if auto_mapping.get("Sticker"):
            try:
                sr_idx = self._raw_headers.index(auto_mapping["Sticker"])
            except ValueError:
                pass

        sr_nums = []
        if sr_idx is not None:
            for row in self._data_rows:
                if sr_idx < len(row) and row[sr_idx]:
                    m = re.match(r"^\d+$", _clean(row[sr_idx]))
                    if m:
                        sr_nums.append(int(m.group()))

        # Package statistics to bootstrap JS interface state
        return json.dumps({
            "filename": self._filename,
            "pdf_headers": self._raw_headers,
            "auto_mapping": auto_mapping,
            "row_count": len(self._data_rows),
            "sr_min": min(sr_nums) if sr_nums else None,
            "sr_max": max(sr_nums) if sr_nums else None,
        })

    def pdf_process(self, mapping_json, mauze, sr_start, sr_end):
        """
        Executes parsing logic based on mappings and filter parameters, 
        returning records as preview arrays to populate UI tables.
        """
        mapping = json.loads(mapping_json) if isinstance(mapping_json, str) else mapping_json

        sr_s = int(sr_start) if sr_start else None
        sr_e = int(sr_end) if sr_end else None

        rows = _process_rows(
            self._raw_headers,
            self._data_rows,
            mapping,
            mauze,
            sr_s,
            sr_e,
            self._window
        )

        return json.dumps({"preview": rows, "total_rows": len(rows)})

    def pdf_download(self, mapping_json, mauze, sr_start, sr_end):
        """
        Processes dataset and displays save dialog to export to CSV file using Pandas.
        """
        if not self._window:
            return json.dumps({"error": "Window not initialized."})
            
        mapping = json.loads(mapping_json) if isinstance(mapping_json, str) else mapping_json

        sr_s = int(sr_start) if sr_start else None
        sr_e = int(sr_end) if sr_end else None

        # Build clean output rows
        rows = _process_rows(
            self._raw_headers,
            self._data_rows,
            mapping,
            mauze,
            sr_s,
            sr_e,
            self._window
        )

        # Convert to Pandas DataFrame to leverage stable CSV serialisation utilities
        df = pd.DataFrame(rows, columns=CSV_COLUMNS)

        default_name = Path(self._filename).stem + "_extracted.csv"

        # Show native Windows save dialog
        save_path = self._window.create_file_dialog(
            webview.FileDialog.SAVE,
            save_filename=default_name,
            file_types=("CSV Files (*.csv)",),
        )

        if not save_path:
            return json.dumps({"error": "Save cancelled."})

        if isinstance(save_path, (list, tuple)):
            save_path = save_path[0]

        # Write to disk
        df.to_csv(save_path, index=False)
        return json.dumps({"saved": str(save_path), "total_rows": len(rows)})
