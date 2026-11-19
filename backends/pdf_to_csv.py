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
import sys
import json
import shutil
import tempfile
import subprocess
from pathlib import Path

import pandas as pd
import pdfplumber
try:
    import pypdfium2 as pdfium
except Exception:
    pdfium = None
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


# ==============================================================================
# SCHEMA & DICTIONARIES
# ==============================================================================
# The target columns defined for the output CSV schema.
CSV_COLUMNS = ["Seq", "Event", "Sticker", "Name", "ITS", "Location", "Mobile", "Mauze", "Sub Event"]

# Synonym registry to link dynamic headers in PDF source tables to target CSV keys.
# PDF generators often label columns slightly differently; this mapping allows fuzzy/partial matching.
SYNONYM_MAP = {
    "Event":    ["sharaf", "event", "event name", "program", "z / m/ q", "z/m/q", "z / m / q", "z/ m/ q", "q/m/z", "q / m / z", "q / m/ z", "q/ m/ z", "q/m/ z", "q /m/z"],
    "Sticker":  ["sticker", "sr", "sr.", "no", "no.", "sr no", "sr. no", "sr.no", "s.no", "s.no.", "serial no", "serial no.", "serial", "sl no", "sl. no", "sl.no", "sno", "token", "seq", "#"],
    "Name":     ["name", "full name", "mumin name", "mumineen name"],
    "ITS":      ["its id", "its", "its_id", "its no", "its number", "itsid"],
    "Location": ["address", "link", "location", "venue", "mohalla", "building", "place"],
    "Mobile":   ["contact", "mobile", "phone", "contact no", "contact number", "mobile no", "mobile number", "cell", "tel", "whatsapp", "ph no", "ph.", "phone no", "phone number"],
    "Sub Event": ["safar code", "sharaf code", "safar_code", "sharaf_code", "code", "sub event", "sub_event", "sub-event", "pass code"],
}

EVENT_NAME_TO_CODE = {
    "QADAM": "Q",
    "MAJLIS": "M",
    "ZIYAFFAT": "Z",
    "ZIYARAT": "Z",
    "ZIYAFAT": "Z",
    "OLDA": "ZO",
    "ZAFAF OLDA": "ZO",
    "WAAZ": "WAAZ",
    "NAMAZ": "NAMAZ",
    "NIKAH": "N",
    "AQIQA": "AQ",
    "ISTEQBAL": "IST",
    "WADA": "WD",
    "BETHAK MAJLIS": "BM",
    "BETHAK QADAM": "BQ",
    "BETHAK ZIYAFAT": "BZ",
    "HADDIYAT": "H",
    "IDARAAT": "ID",
    "IFTETTAH": "IF",
    "MAFSUMIAT": "MF",
    "MAFSUHIYAT": "MF",
    "MAJMUI ZIYAFAT": "MZ",
    "SHIFA QADAM": "SQ",
    "TIJARAT": "TJR",
    "TALAQQI": "TQ",
}

# Approved sticker codes representing primary events.
MAIN_STICKERS = {
    "Z", "M", "Q", "MZ", "MQ", "H", "MF", "QMZ", "AQ", "ID", "ZO", "BETHAK", "DR", "AM", "MO", "MZR", "MYN", "TQ", "S", "BQMZ", "BZ", "BM", "BQ", "G", "O", "N",
    "QADAM", "ZIYARAT", "MAJLIS", "WAAZ", "NAMAZ", "OLDA", "ISTEQBAL", "WADA", "NIKAH", "AQIQA", "TIJARAT", "SHARAF", "SHIFA QADAM"
}

MAIN_EVENTS_LIST = ["Waaz", "Majlis", "Namaz", "Ziyarat", "Isteqbal", "Wada", "QMZ", "Bethak"]


def _get_main_events_list():
    """
    Returns the list of main events, attempting to read from 'List of Main Events.xlsx'
    and falling back to MAIN_EVENTS_LIST.
    """
    search_paths = [
        Path("New PDF - CSV part/List of Main Events.xlsx"),
        Path("List of Main Events.xlsx"),
        Path(__file__).resolve().parent.parent / "New PDF - CSV part" / "List of Main Events.xlsx",
        Path(__file__).resolve().parent.parent / "List of Main Events.xlsx",
    ]
    for p in search_paths:
        if p.exists():
            try:
                df = pd.read_excel(p)
                col = df.columns[0]
                events = df[col].dropna().astype(str).str.strip().tolist()
                events = [e for e in events if e]
                if events:
                    return events
            except Exception as ex:
                print(f"[PDF] Error reading main events from Excel: {ex}")
    return MAIN_EVENTS_LIST


# Secondary event sub-codes that are tabulated separately.
SUB_EVENT_CODES = set()


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


def _clean_phone_number(phone_str):
    """
    Cleans phone numbers:
    - Strips label prefixes like 'Ph:', 'Mo:', 'Tel:', 'Contact:'
    - Normalizes Indian numbers: strips leading +91 / 91 / 0 to yield clean 10-digit mobile number
    - Strips whitespace, dashes, and non-digit formatting characters
    """
    if not phone_str:
        return ""
    s = re.sub(r"^(?:ph(?:one)?|mo(?:bile)?|tel|contact)\s*[:\-]?\s*", "", str(phone_str), flags=re.IGNORECASE).strip()
    digits = re.sub(r"\D", "", s)
    if len(digits) == 12 and digits.startswith("91"):
        return digits[2:]
    if len(digits) == 11 and digits.startswith("0"):
        return digits[1:]
    if len(digits) == 10:
        return digits
    if len(digits) < 7:
        return ""
    return digits if digits else s


def _get_sr_suffix(idx):
    """
    Generates alphabetic sticker suffixes for split multi-event rows.
    idx 0 -> '' (e.g., 10)
    idx 1 -> 'a' (e.g., 10a)
    idx 2 -> 'b' (e.g., 10b)
    idx 3 -> 'c' (e.g., 10c)
    """
    if idx == 0:
        return ""
    idx -= 1
    res = ""
    while True:
        res = chr(ord("a") + (idx % 26)) + res
        idx = idx // 26 - 1
        if idx < 0:
            break
    return res


def _parse_event_codes(raw_ev_str):
    """
    Parses and splits composite event codes (e.g. Z+N, Q+N, N+H+MF, Z / N).
    Normalizes standard event names (e.g. QADAM -> Q, MAJLIS -> M, ZIYARAT -> Z).
    Maintains clean uppercase codes without duplicate entries.
    """
    if not raw_ev_str:
        return [""]
    parts = [p.strip().upper() for p in re.split(r"\s*[\+\/\,\&\n]\s*", str(raw_ev_str)) if p.strip()]
    final_codes = []
    for part in parts:
        part_norm = EVENT_NAME_TO_CODE.get(part, part)
        sub_tokens = part_norm.split()
        if len(sub_tokens) > 1 and all(st in MAIN_STICKERS or EVENT_NAME_TO_CODE.get(st) in MAIN_STICKERS for st in sub_tokens):
            for st in sub_tokens:
                st_code = EVENT_NAME_TO_CODE.get(st, st)
                if st_code and st_code not in final_codes:
                    final_codes.append(st_code)
        else:
            # Check if one or more tokens match MAIN_STICKERS
            valid_stickers = [EVENT_NAME_TO_CODE.get(st, st) for st in sub_tokens if st in MAIN_STICKERS or EVENT_NAME_TO_CODE.get(st) in MAIN_STICKERS]
            if valid_stickers:
                for st in valid_stickers:
                    if st and st not in final_codes:
                        final_codes.append(st)
            else:
                if part_norm and part_norm not in final_codes:
                    final_codes.append(part_norm)
    return final_codes if final_codes else [""]


def _is_header_or_merged_row(row, total_cols):
    """
    Heuristic check to identify if a row is a repeating header or an informational merged cell.
    If a row contains very few non-empty cells relative to the table width, it is skipped.
    """
    non_empty = [c for c in row if c and str(c).strip()]
    if len(non_empty) <= 2 and total_cols > 4:
        return True
    return False


def _run_ocr_helper(ps_script_path, img_path):
    """Executes backends/ocr_helper.ps1 via PowerShell and returns parsed lines/words JSON."""
    if sys.platform != "win32":
        return {"lines": []}
    try:
        res = subprocess.run(
            ["powershell", "-ExecutionPolicy", "Bypass", "-File", str(ps_script_path), "-ImagePath", str(img_path)],
            capture_output=True,
            text=True,
            timeout=30
        )
        if res.returncode == 0 and res.stdout.strip():
            raw = res.stdout.strip()
            idx = raw.find('{"lines":')
            if idx != -1:
                return json.loads(raw[idx:])
    except Exception as ex:
        print(f"[PDF OCR] Helper execution notice: {ex}")
    return {"lines": []}


def _extract_table_via_ocr(pdf_path, window=None):
    """
    Robust OCR table extractor for scanned PDFs or PDFs where text is rendered as
    vector outlines (e.g. Microsoft Print to PDF). Uses Windows.Media.Ocr via PowerShell on Windows.
    """
    if sys.platform != "win32":
        print("[PDF OCR] Notice: WinRT OCR table extraction fallback is only available on Windows.")
        return None, None

    ps_script = Path(__file__).resolve().parent / "ocr_helper.ps1"
    if not ps_script.exists():
        raise FileNotFoundError(f"OCR helper script not found at {ps_script}")

    global pdfium
    if pdfium is None:
        try:
            import pypdfium2 as pdfium
        except Exception as e:
            raise RuntimeError(f"pypdfium2 is required for OCR rendering: {e}")

    doc = pdfium.PdfDocument(str(pdf_path))
    total_pages = len(doc)
    all_pages = []

    temp_dir = tempfile.mkdtemp(prefix="ain53_ocr_")
    try:
        for p_idx, page in enumerate(doc):
            if window:
                try:
                    window.evaluate_js(f"window.ProgressController.update({p_idx + 1}, 'OCR scanning page {p_idx + 1} of {total_pages}...')")
                except Exception:
                    pass

            img = page.render(scale=2).to_pil()
            tmp_0 = os.path.join(temp_dir, f"p_{p_idx}_0.png")
            tmp_90 = os.path.join(temp_dir, f"p_{p_idx}_90.png")

            img.save(tmp_0)
            ocr0 = _run_ocr_helper(ps_script, tmp_0)

            # Test 270-degree rotation (common when landscape pages are printed in portrait layout)
            img_rot = img.rotate(270, expand=True)
            img_rot.save(tmp_90)
            ocr90 = _run_ocr_helper(ps_script, tmp_90)

            best_ocr = ocr90 if len(ocr90.get("lines", [])) > len(ocr0.get("lines", [])) else ocr0

            words = []
            for l in best_ocr.get("lines", []):
                for w in l.get("words", []):
                    words.append(w)
            all_pages.append(words)
    finally:
        try:
            shutil.rmtree(temp_dir, ignore_errors=True)
        except Exception:
            pass

    KNOWN_HEADER_KEYWORDS = [
        "seq", "event", "sticker", "name", "location", "address",
        "its", "contact", "mobile", "sr", "sharaf", "code", "venue", "team", "photographer"
    ]

    col_defs = None
    header_page = 0
    header_y = 0

    for p_idx, words in enumerate(all_pages):
        words.sort(key=lambda w: (w["y"], w["x"]))
        bands = []
        for w in words:
            added = False
            for b in bands:
                if abs(w["y"] - b["avg_y"]) <= 14:
                    b["words"].append(w)
                    b["avg_y"] = sum(x["y"] for x in b["words"]) / len(b["words"])
                    added = True
                    break
            if not added:
                bands.append({"avg_y": w["y"], "words": [w]})

        for b in bands:
            b["words"].sort(key=lambda w: w["x"])
            matches = [w["text"] for w in b["words"] if any(kh in w["text"].lower() for kh in KNOWN_HEADER_KEYWORDS)]
            if len(matches) >= 3:
                groups = []
                curr_g = [b["words"][0]]
                for w in b["words"][1:]:
                    prev_w = curr_g[-1]
                    if w["x"] - (prev_w["x"] + prev_w["w"]) < 25:
                        curr_g.append(w)
                    else:
                        groups.append(curr_g)
                        curr_g = [w]
                groups.append(curr_g)

                col_defs = []
                for g in groups:
                    cname = " ".join(w["text"] for w in g)
                    min_x = min(w["x"] for w in g)
                    max_x = max(w["x"] + w["w"] for w in g)
                    col_defs.append({"name": cname, "min_x": min_x, "max_x": max_x, "mid_x": (min_x + max_x) / 2})

                for i in range(len(col_defs)):
                    l_bound = 0 if i == 0 else (col_defs[i-1]["mid_x"] + col_defs[i]["mid_x"]) / 2
                    r_bound = 99999 if i == len(col_defs)-1 else (col_defs[i]["mid_x"] + col_defs[i+1]["mid_x"]) / 2
                    col_defs[i]["left"] = l_bound
                    col_defs[i]["right"] = r_bound

                header_page = p_idx
                header_y = b["avg_y"]
                break
        if col_defs:
            break

    if not col_defs:
        return [], []

    raw_headers = [c["name"] for c in col_defs]
    data_rows = []

    anchor_col_idx = 0
    for idx, c in enumerate(col_defs):
        if any(kw in c["name"].lower() for kw in ["#", "seq", "sr", "sticker", "no"]):
            anchor_col_idx = idx
            break

    anchor_col = col_defs[anchor_col_idx]

    for p_idx, words in enumerate(all_pages):
        words.sort(key=lambda w: (w["y"], w["x"]))

        page_header_y = 0
        bands = []
        for w in words:
            added = False
            for b in bands:
                if abs(w["y"] - b["avg_y"]) <= 14:
                    b["words"].append(w)
                    b["avg_y"] = sum(x["y"] for x in b["words"]) / len(b["words"])
                    added = True
                    break
            if not added:
                bands.append({"avg_y": w["y"], "words": [w]})
        for b in bands:
            matches = [w["text"] for w in b["words"] if any(kh in w["text"].lower() for kh in KNOWN_HEADER_KEYWORDS)]
            if len(matches) >= 3:
                page_header_y = b["avg_y"]
                break

        cutoff = (page_header_y if page_header_y > 0 else header_y) + 15
        p_words = [w for w in words if w["y"] > cutoff]
        p_words.sort(key=lambda w: (w["y"], w["x"]))

        filtered_words = []
        for w in p_words:
            t = w["text"].lower()
            if any(k in t for k in ["ain53", "confidential", "internal", "total", "sequences:", "generated:", "going project", "frontend/index.html", "about:blank", "& use only"]):
                continue
            filtered_words.append(w)

        anchors = []
        for w in filtered_words:
            if anchor_col["left"] <= w["x"] < anchor_col["right"]:
                m = re.search(r"^\d+$", w["text"].strip())
                if m:
                    if not anchors or abs(w["y"] - anchors[-1]["y"]) > 20:
                        anchors.append(w)

        # Check if unanchored Row 1 exists above the first anchor
        if anchors and anchors[0]["y"] > (cutoff + 55):
            pre_words = [w for w in filtered_words if cutoff < w["y"] < (anchors[0]["y"] - 15)]
            if len(pre_words) >= 4:
                synth_num = str(max(1, int(anchors[0]["text"]) - 1))
                synth_anchor = {
                    "text": synth_num,
                    "x": anchor_col["min_x"],
                    "y": cutoff + 20,
                    "w": 20,
                    "h": 20
                }
                anchors.insert(0, synth_anchor)

        for a_idx, a in enumerate(anchors):
            top_y = a["y"] - 14
            bot_y = anchors[a_idx + 1]["y"] - 14 if a_idx < len(anchors) - 1 else 99999

            row_words = [w for w in filtered_words if top_y <= w["y"] < bot_y]

            cells = [[] for _ in col_defs]
            for w in row_words:
                for c_idx, cd in enumerate(col_defs):
                    if cd["left"] <= w["x"] < cd["right"]:
                        cells[c_idx].append(w)
                        break

            if not cells[anchor_col_idx]:
                cells[anchor_col_idx].append(a)

            formatted_cells = []
            for c_words in cells:
                c_words.sort(key=lambda w: (w["y"], w["x"]))
                lines = []
                cur_line = []
                for w in c_words:
                    if not cur_line or abs(w["y"] - cur_line[-1]["y"]) <= 12:
                        cur_line.append(w)
                    else:
                        cur_line.sort(key=lambda x: x["x"])
                        lines.append(" ".join(x["text"] for x in cur_line))
                        cur_line = [w]
                if cur_line:
                    cur_line.sort(key=lambda x: x["x"])
                    lines.append(" ".join(x["text"] for x in cur_line))
                formatted_cells.append("\n".join(lines).strip())

            data_rows.append(formatted_cells)

    return raw_headers, data_rows


def _extract_raw_table(pdf_path, window=None):
    """
    Iterates page-by-page through the PDF file using pdfplumber to extract table objects.
    If the PDF lacks vector text (scanned or rendered as outlines e.g. Microsoft Print to PDF),
    automatically falls back to Windows OCR engine.
    """
    all_rows = []
    with pdfplumber.open(pdf_path) as pdf:
        total_pages = len(pdf.pages)
        
        # Start progress rendering in the UI
        if window:
            try:
                window.evaluate_js(f"window.ProgressController.start('Reading PDF', 'Extracting tables...', {total_pages})")
            except Exception:
                pass
            
        for i, page in enumerate(pdf.pages):
            tables = page.extract_tables()
            # If standard lines strategy finds no tables, try text-based vertical strategy
            if not tables:
                try:
                    tables = page.extract_tables(table_settings={"vertical_strategy": "text", "horizontal_strategy": "lines"})
                except Exception:
                    pass
            for table in tables:
                for row in table:
                    all_rows.append(row)
            # Update progress indicator
            if window:
                try:
                    window.evaluate_js(f"window.ProgressController.update({i + 1}, 'Processing page {i + 1} of {total_pages}')")
                except Exception:
                    pass

    # Check if vector extraction found usable text
    has_usable_text = False
    if all_rows:
        for row in all_rows:
            non_empty = [c for c in row if c and str(c).strip()]
            if len(non_empty) >= 3:
                has_usable_text = True
                break

    # If no usable text found in vector tables, invoke OCR fallback
    if not has_usable_text:
        try:
            if window:
                try:
                    window.evaluate_js("window.ProgressController.start('Scanning PDF', 'Detecting outline/scanned text with OCR...', 1)")
                except Exception:
                    pass
            ocr_headers, ocr_data_rows = _extract_table_via_ocr(pdf_path, window)
            if ocr_headers and ocr_data_rows:
                if window:
                    try:
                        window.evaluate_js("window.ProgressController.stop()")
                    except Exception:
                        pass
                return ocr_headers, ocr_data_rows
        except Exception as ocr_err:
            print(f"[PDF] OCR fallback notice: {ocr_err}")

    # Shutdown progress bar
    if window:
        try:
            window.evaluate_js("window.ProgressController.stop()")
        except Exception:
            pass

    if not all_rows:
        raise ValueError("No tables or readable text found in the PDF.")

    # Locate the header row by searching for a row matching known synonyms,
    # or falling back to the first row containing at least 3 filled cells.
    header_idx = None
    all_synonyms = set()
    for syn_list in SYNONYM_MAP.values():
        for syn in syn_list:
            all_synonyms.add(syn.lower())

    for i, row in enumerate(all_rows):
        cleaned_cells = [_clean(c).lower() for c in row if c and str(c).strip()]
        if sum(1 for c in cleaned_cells if any(s in c for s in all_synonyms)) >= 2:
            header_idx = i
            break

    if header_idx is None:
        for i, row in enumerate(all_rows):
            non_empty = [c for c in row if c and str(c).strip()]
            if len(non_empty) >= 3:
                header_idx = i
                break

    if header_idx is None:
        header_idx = 0

    # Clean extracted headers or construct placeholder names if header is null/blank.
    raw_headers = [_clean(h) if h else f"Col_{j}" for j, h in enumerate(all_rows[header_idx])]
    data_rows = all_rows[header_idx + 1:]

    return raw_headers, data_rows


def _auto_map(pdf_headers):
    """
    Fuzzy maps the columns found in the PDF source files against target CSV fields
    using the registered SYNONYM_MAP. Matches exact matches first, followed by
    word-boundary / substring matching, to prevent short tokens (e.g. 'no') from
    matching compound headers (e.g. 'contact no').
    """
    mapping = {}
    lower_headers = [h.strip().lower() for h in pdf_headers]
    used_headers = set()

    # Pass 1: exact match
    for csv_col, synonyms in SYNONYM_MAP.items():
        matched = None
        for syn in synonyms:
            syn_lower = syn.strip().lower()
            for ph, plh in zip(pdf_headers, lower_headers):
                if plh == syn_lower or plh.rstrip('.') == syn_lower:
                    matched = ph
                    break
            if matched:
                break
        if matched:
            mapping[csv_col] = matched
            used_headers.add(matched)

    # Pass 2: word-boundary or substring match for columns not yet matched
    for csv_col, synonyms in SYNONYM_MAP.items():
        if csv_col in mapping and mapping[csv_col]:
            continue
        matched = None
        for syn in synonyms:
            syn_lower = syn.strip().lower()
            for ph, plh in zip(pdf_headers, lower_headers):
                if ph in used_headers:
                    continue
                if len(syn_lower) <= 3:
                    if re.search(r'\b' + re.escape(syn_lower) + r'\b', plh):
                        matched = ph
                        break
                else:
                    if syn_lower in plh:
                        matched = ph
                        break
            if matched:
                break
        if matched:
            mapping[csv_col] = matched
            used_headers.add(matched)
        else:
            mapping[csv_col] = None

    # Unmapped/constructed metadata targets
    mapping["Seq"] = None
    mapping["Mauze"] = None
    if "Sub Event" not in mapping:
        mapping["Sub Event"] = None

    return mapping


def _process_rows(raw_headers, data_rows, mapping, mauze, sr_start=None, sr_end=None, parts=None, window=None):
    """
    Core data restructuring engine.
    This function processes the table rows, groups sub-rows belonging to the same serial/sticker 
    number, splits vertical multi-line values into multiple distinct records, unrolls multi-event codes 
    (e.g. Z+N -> 01 Z, 01a N), and supports optional multi-part dividing sections.
    """
    total_cols = len(raw_headers)
    total_rows = len(data_rows)
    if window:
        window.evaluate_js(f"window.ProgressController.start('Formatting CSV', 'Grouping stickers...', {total_rows})")

    if isinstance(parts, str) and parts.strip():
        try:
            parts = json.loads(parts)
        except Exception:
            parts = None

    # Guard against accidental user inversion of Event and Sticker
    if mapping and mapping.get("Event") and mapping.get("Sticker"):
        ev_hdr = (mapping.get("Event") or "").strip().lower()
        st_hdr = (mapping.get("Sticker") or "").strip().lower()
        if ev_hdr in ["no", "no.", "sr", "sr.", "s.no", "serial", "sno"] and any(kw in st_hdr for kw in ["sharaf", "event", "z", "q", "m"]):
            mapping["Event"], mapping["Sticker"] = mapping["Sticker"], mapping["Event"]

    # Map column headers to list index keys.
    col_index = {}
    for csv_col, pdf_hdr in mapping.items():
        if pdf_hdr and pdf_hdr in raw_headers:
            col_index[csv_col] = raw_headers.index(pdf_hdr)
        else:
            col_index[csv_col] = None

    # Pre-compute a shifted header signature for detecting sub-table repeat-header rows.
    _shifted_headers = raw_headers[1:] if len(raw_headers) > 1 else []
    _shifted_headers_set = set(h.lower() for h in _shifted_headers if h)

    def _is_shifted_header_row(row):
        """Returns True if this row looks like a repeated header shifted by one column."""
        if not _shifted_headers:
            return False
        cleaned = [_clean(c) for c in row]
        non_empty = [c for c in cleaned if c]
        if not non_empty:
            return False
        matches = sum(1 for c in non_empty if c.lower() in _shifted_headers_set)
        return matches / len(non_empty) >= 0.6

    def _get_sr_from_row(row):
        """
        Returns the SR string from a row, trying the mapped Sticker column first,
        then falling back to column 0 to handle tables whose leading empty column
        is absent (second-section tables shifted left by one).
        """
        idx = col_index.get("Sticker")
        sr_val = _clean(row[idx]) if (idx is not None and idx < len(row)) else ""
        if re.search(r"^\s*\d+", sr_val):
            return sr_val, 0  # 0 = no column offset
        # Fallback: only if row actually has fewer columns than total_cols (shifted table)
        if len(row) < total_cols and len(row) > 0 and idx is not None and idx > 0:
            col0 = _clean(row[0])
            if re.search(r"^\s*\d+", col0):
                return col0, len(row) - total_cols
        # If Sticker is not mapped, or row[idx] does not start with digits, check column 0 with 0 offset
        if len(row) > 0:
            col0 = _clean(row[0])
            if re.search(r"^\s*\d+", col0):
                return col0, 0
        return sr_val, 0

    WAYPOINT_KEYWORDS = {"masjid", "zyarat", "ziyarat", "waaz", "namaz", "istiraahat", "isteraahat", "utara", "taraf"}

    def _is_header_or_merged_row_local(row):
        """
        Heuristic check to identify if a row is a repeating section header banner,
        travel step, or waypoint note (e.g. 'Towards Takhatpur', 'Noor Masjid', 'Moulaya Raja Saheb Masjid').
        Rows containing a numeric serial number in the Sticker/Sr column must NOT be skipped.
        """
        sr_val, _ = _get_sr_from_row(row)
        if re.search(r"^\s*\d+", sr_val):
            return False

        non_empty = [c for c in row if c and str(c).strip()]
        if not non_empty:
            return True
        if len(non_empty) <= 2 and total_cols > 4:
            return True

        its_idx = col_index.get("ITS")
        ev_idx = col_index.get("Event")
        sub_idx = col_index.get("Sub Event")
        name_idx = col_index.get("Name")

        its_val = str(row[its_idx]).strip() if (its_idx is not None and its_idx < len(row) and row[its_idx]) else ""
        ev_val = str(row[ev_idx]).strip() if (ev_idx is not None and ev_idx < len(row) and row[ev_idx]) else ""
        sub_val = str(row[sub_idx]).strip() if (sub_idx is not None and sub_idx < len(row) and row[sub_idx]) else ""
        name_val = str(row[name_idx]).strip() if (name_idx is not None and name_idx < len(row) and row[name_idx]) else ""

        # A legitimate sub-person has an ITS ID or recognized Safar code
        if re.search(r"\d{6,}", its_val) or re.search(r"^[A-Z]{2,4}-\d+", sub_val):
            return False
        # Or has an Event code and a Name
        if ev_val in MAIN_STICKERS and name_val:
            return False

        row_text = " ".join(str(c).lower() for c in row if c)
        if any(kw in row_text for kw in WAYPOINT_KEYWORDS):
            return True
        if not name_val and not its_val and not ev_val:
            return True
        return False

    # Step 1: Collect rows into chronological groups keyed by their Sticker (Serial) number.
    # Preserves exact sequential PDF order (non-adjacent identical SRs remain separate in their PDF locations).
    groups = []
    current_group = None
    last_sr_val = None

    for i, row in enumerate(data_rows):
        if window and i % 100 == 0:
            window.evaluate_js(f"window.ProgressController.update({i}, 'Scanning row {i}...')")
        if _is_header_or_merged_row_local(row):
            continue

        cleaned_row = [_clean(c) for c in row]
        if cleaned_row == raw_headers:
            continue

        # Skip rows that are a shifted repeat of the table header
        if _is_shifted_header_row(row):
            continue

        sr_val_raw, col_offset = _get_sr_from_row(row)
        if sr_val_raw.lower() in ["sr", "sr.", "sticker"]:
            continue

        sr_num_match = re.search(r"^\s*(\d+)", sr_val_raw)

        if sr_num_match:
            sr_clean_val = sr_num_match.group(1)
            sr_num = int(sr_clean_val)

            if current_group is not None and sr_clean_val == last_sr_val:
                current_group["rows"].append(row)
            else:
                current_group = {
                    "sr_val": sr_clean_val,
                    "sr_num": sr_num,
                    "rows": [row],
                    "col_offset": col_offset
                }
                groups.append(current_group)
                last_sr_val = sr_clean_val
        else:
            # If the row doesn't start with a new sticker ID, append it to the active group
            # (handles multi-line text split across sequential cells).
            if current_group is not None:
                current_group["rows"].append(row)

    def _convert_group_to_rows(grp):
        sr_val = grp["sr_val"]
        group = grp["rows"]
        col_offset = grp.get("col_offset", 0)

        persons = []
        locations = []
        group_event_strs = []

        def _get_col_raw(row, csv_col, offset=col_offset):
            """Column-offset-aware getter that preserves newline separation within cells."""
            idx = col_index.get(csv_col)
            if idx is None:
                return ""
            adj_idx = idx if len(row) >= total_cols else (idx + offset)
            if adj_idx < 0 or adj_idx >= len(row):
                return ""
            val = row[adj_idx]
            if val is None:
                return ""
            return str(val).strip()

        sub_event_vals = []
        # Process sub-rows inside each Sticker group.
        for row in group:
            event_val = _get_col_raw(row, "Event")
            name_val = _get_col_raw(row, "Name")
            its_val = _get_col_raw(row, "ITS")
            mobile_val = _get_col_raw(row, "Mobile")
            loc_val = _clean(_get_col_raw(row, "Location"))
            sub_event_val = _clean(_get_col_raw(row, "Sub Event"))

            # Auto-repair column boundary text bleeding between Sticker, Name, and Event cells
            sr_cell = _get_col_raw(row, "Sticker") or ""
            sr_bleed = re.match(r"^\s*\d+\s+([A-Za-z]+)\s*$", sr_cell)
            if sr_bleed and name_val:
                bled_prefix = sr_bleed.group(1)
                if not name_val.startswith(bled_prefix):
                    name_val = bled_prefix + name_val

            if event_val:
                ev_tokens = event_val.split()
                if len(ev_tokens) > 1:
                    stickers = [t for t in ev_tokens if t.upper() in MAIN_STICKERS]
                    non_stickers = [t for t in ev_tokens if t.upper() not in MAIN_STICKERS]
                    if stickers and non_stickers:
                        bled_text = " ".join(non_stickers)
                        if name_val and not name_val.endswith(bled_text):
                            if name_val.endswith(" ") or bled_text.startswith(" ") or bled_text.startswith(")") or name_val.endswith("(") or (name_val[-1].isalnum() and bled_text[0].isalnum()):
                                name_val = (name_val + bled_text).strip()
                            else:
                                name_val = (name_val + " " + bled_text).strip()
                        event_val = " + ".join(stickers)

            if sub_event_val and sub_event_val not in sub_event_vals:
                sub_event_vals.append(sub_event_val)

            if event_val:
                group_event_strs.append(_clean(event_val))

            # Split cells containing newline characters (\n) or delimiters into arrays of entries.
            event_lines = [e.strip() for e in event_val.split("\n") if e.strip()] if event_val else []
            name_lines = [n.strip() for n in name_val.split("\n") if n.strip()] if name_val else []
            its_lines = [i.strip() for i in its_val.split("\n") if i.strip()] if its_val else []

            # For mobile: support newlines or slash/comma separated numbers
            mobile_lines = []
            if mobile_val:
                raw_parts = [m.strip() for m in re.split(r"[\n\/,]+", mobile_val) if m.strip()]
                mobile_lines = [_clean_phone_number(m) for m in raw_parts if m]

            num_people_in_row = max(len(its_lines), len(mobile_lines))
            if num_people_in_row <= 1:
                nm_full = " ".join(name_lines)
                its_full = its_lines[0] if its_lines else ""
                mb_full = mobile_lines[0] if mobile_lines else ""
                ev_full = event_lines[0] if event_lines else ""
                if nm_full or its_full or mb_full:
                    persons.append({"name": nm_full, "its": its_full, "mobile": mb_full, "event": ev_full})
            else:
                for idx in range(num_people_in_row):
                    nm = name_lines[idx] if idx < len(name_lines) else (" ".join(name_lines) if name_lines else "")
                    it = its_lines[idx] if idx < len(its_lines) else ""
                    mb = mobile_lines[idx] if idx < len(mobile_lines) else (mobile_lines[0] if mobile_lines else "")
                    ev = event_lines[idx] if idx < len(event_lines) else (event_lines[-1] if event_lines else "")
                    if nm or it or mb:
                        persons.append({"name": nm, "its": it, "mobile": mb, "event": ev})

            if loc_val:
                locations.append(loc_val)

        # Separate actual person entries from informational title/venue notes
        # A valid person must have an identifiable name or ITS, plus details
        valid_persons = [p for p in persons if (p.get("name") or p.get("its")) and (p.get("its") or p.get("mobile") or p.get("event"))]
        if valid_persons:
            for p in persons:
                if not ((p.get("name") or p.get("its")) and (p.get("its") or p.get("mobile") or p.get("event"))) and p.get("name"):
                    locations.append(p["name"])
            persons = valid_persons

        if not persons:
            persons = [{"name": "", "its": "", "mobile": "", "event": ""}]

        # Merge unique non-empty locations with semicolons.
        loc_combined = "; ".join(dict.fromkeys(l for l in locations if l))
        sub_event_combined = "; ".join(sub_event_vals)

        # Parse event codes (split by '+', '/', ',', '&', or newlines)
        raw_ev_str = " + ".join(group_event_strs) if group_event_strs else ""
        split_codes = _parse_event_codes(raw_ev_str)

        # Unroll sub-events and persons into sequential rows (01 Z, 01a N, etc.)
        num_entries = max(len(split_codes), len(persons))
        group_rows = []
        for idx in range(num_entries):
            code = split_codes[idx] if idx < len(split_codes) else (split_codes[-1] if split_codes else "")
            p = persons[idx] if idx < len(persons) else persons[-1]
            if p.get("event") and idx < len(persons) and len(persons) > len(split_codes):
                p_codes = _parse_event_codes(p["event"])
                if p_codes and p_codes[0]:
                    code = p_codes[0]
            elif p.get("event") and idx < len(persons) and len(persons) == len(split_codes):
                p_codes = _parse_event_codes(p["event"])
                if p_codes and p_codes[0]:
                    code = p_codes[0]
            seq_val = f"{sr_val}{_get_sr_suffix(idx)}"
            row_dict = {
                "Seq": seq_val,
                "Event": code,
                "Sticker": str(sr_val),
                "Name": p["name"],
                "ITS": p["its"],
                "Location": loc_combined,
                "Mobile": p["mobile"],
                "Mauze": mauze,
                "Sub Event": sub_event_combined or "",
            }
            group_rows.append(row_dict)
        return group_rows

    output_rows = []

    # Check if parts mode is active (parts list provided with >= 1 part)
    has_parts = parts is not None and isinstance(parts, list) and len(parts) > 0

    if has_parts:
        for p_idx, part in enumerate(parts):
            p_name = part.get("name") or f"Part {p_idx + 1}"
            p_event = part.get("event") or ""
            p_start = int(part["start"]) if part.get("start") not in [None, ""] else None
            p_end = int(part["end"]) if part.get("end") not in [None, ""] else None

            # Add part header divider row
            divider_row = {
                "Seq": p_name,
                "Event": p_event,
                "Sticker": "",
                "Name": "",
                "ITS": "",
                "Location": "",
                "Mobile": "",
                "Mauze": "",
                "Sub Event": "",
            }
            output_rows.append(divider_row)

            # Filter and convert matching groups for this part
            for grp in groups:
                sr_num = grp.get("sr_num")
                if sr_num is not None:
                    if p_start is not None and sr_num < p_start:
                        continue
                    if p_end is not None and sr_num > p_end:
                        continue
                output_rows.extend(_convert_group_to_rows(grp))
    else:
        # Fallback single range / default mode
        s_bound = sr_start
        e_bound = sr_end

        for grp in groups:
            sr_num = grp.get("sr_num")
            if sr_num is not None:
                if s_bound is not None and sr_num < s_bound:
                    continue
                if e_bound is not None and sr_num > e_bound:
                    continue
            output_rows.extend(_convert_group_to_rows(grp))

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

    def pdf_get_main_events(self):
        """
        Returns the list of main events for part naming dropdowns.
        """
        events = _get_main_events_list()
        return json.dumps({"events": events})

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
        self._pdf_source_path = pdf_path

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
                # Primary: check the mapped Sticker column
                if sr_idx < len(row) and row[sr_idx]:
                    m = re.match(r"^\d+$", _clean(row[sr_idx]))
                    if m:
                        sr_nums.append(int(m.group()))
                        continue
                # Fallback: check column 0 for shifted table sections where the
                # leading empty column is absent and the SR number lands at index 0.
                if len(row) > 0 and row[0]:
                    m0 = re.match(r"^\d+$", _clean(row[0]))
                    if m0:
                        sr_nums.append(int(m0.group()))

        # Package statistics to bootstrap JS interface state
        b64_str = ""
        try:
            import base64
            with open(pdf_path, "rb") as f:
                b64_str = base64.b64encode(f.read()).decode("utf-8")
        except Exception as b64_err:
            print(f"[PDF] Warning: Could not encode base64 for viewer: {b64_err}")

        return json.dumps({
            "filename": self._filename,
            "path": pdf_path,
            "pdf_headers": self._raw_headers,
            "auto_mapping": auto_mapping,
            "row_count": len(self._data_rows),
            "sr_min": min(sr_nums) if sr_nums else None,
            "sr_max": max(sr_nums) if sr_nums else None,
            "base64": b64_str,
        })

    def pdf_get_base64(self, path=None):
        """
        Reads the currently selected PDF file and returns its data Base64-encoded
        for direct in-app PDF rendering via Blob URL in WebView2 and web browsers.
        """
        pdf_path = path or getattr(self, "_pdf_source_path", None)
        if not pdf_path or not os.path.isfile(pdf_path):
            pdf_path = _get_app_setting("pdf_source_path")
            if pdf_path and os.path.isfile(pdf_path):
                self._pdf_source_path = pdf_path

        if not pdf_path or not os.path.isfile(pdf_path):
            return json.dumps({"error": "No PDF file currently loaded."})

        try:
            import base64
            with open(pdf_path, "rb") as f:
                encoded = base64.b64encode(f.read()).decode("utf-8")
            return json.dumps({
                "success": True,
                "filename": os.path.basename(pdf_path),
                "path": str(pdf_path),
                "base64": encoded,
                "size": os.path.getsize(pdf_path)
            })
        except Exception as e:
            return json.dumps({"error": f"Failed to read PDF file: {str(e)}"})

    def pdf_open_external(self):
        """
        Opens the currently loaded PDF in the user's default external PDF reader application.
        """
        pdf_path = getattr(self, "_pdf_source_path", None) or _get_app_setting("pdf_source_path")
        if not pdf_path or not os.path.isfile(pdf_path):
            return json.dumps({"error": "No PDF file currently loaded."})

        try:
            if sys.platform == "win32":
                os.startfile(pdf_path)
            else:
                import subprocess
                subprocess.Popen(["xdg-open" if sys.platform != "darwin" else "open", pdf_path])
            return json.dumps({"success": True, "path": str(pdf_path)})
        except Exception as e:
            return json.dumps({"error": f"Failed to launch external viewer: {str(e)}"})

    def pdf_process(self, mapping_json, mauze, sr_start=None, sr_end=None, parts_json=None):
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
            parts=parts_json,
            window=self._window
        )

        return json.dumps({"preview": rows, "total_rows": len(rows)})

    def pdf_download(self, mapping_json, mauze, sr_start=None, sr_end=None, parts_json=None):
        """
        Processes dataset and displays save dialog to export to CSV file using Pandas.
        Once the user confirms the save path, saves the CSV and syncs a copy into the working directory.
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
            parts=parts_json,
            window=self._window
        )

        # Convert to Pandas DataFrame to leverage stable CSV serialisation utilities
        df = pd.DataFrame(rows, columns=CSV_COLUMNS)

        default_name = Path(self._filename).stem + "_extracted.csv"
        working_folder = _get_app_setting("pdf_output_folder") or _get_app_setting("ain_temp_path")

        if not working_folder or not os.path.exists(working_folder):
            if working_folder:
                try:
                    os.makedirs(working_folder, exist_ok=True)
                except Exception:
                    working_folder = None
            if not working_folder:
                downloads = str(Path.home() / "Downloads")
                if os.path.isdir(downloads):
                    working_folder = downloads
                elif hasattr(self, '_pdf_source_path') and self._pdf_source_path and os.path.isfile(self._pdf_source_path):
                    working_folder = os.path.dirname(self._pdf_source_path)
                else:
                    working_folder = str(Path.home() / "Desktop")
                try:
                    _set_app_setting("pdf_output_folder", working_folder)
                except Exception:
                    pass

        os.makedirs(working_folder, exist_ok=True)
        working_csv_path = os.path.join(working_folder, default_name)

        # 1. Write the extracted CSV directly into the configured working/temporary directory
        df.to_csv(working_csv_path, index=False)

        # 2. Copy the source PDF to the working directory if not already there
        if hasattr(self, '_pdf_source_path') and self._pdf_source_path and os.path.isfile(self._pdf_source_path):
            try:
                dest_pdf = os.path.join(working_folder, os.path.basename(self._pdf_source_path))
                if os.path.abspath(self._pdf_source_path) != os.path.abspath(dest_pdf):
                    shutil.copy2(self._pdf_source_path, dest_pdf)
            except Exception as ex:
                print(f"[PDF] Could not copy PDF to working folder: {ex}")

        # 3. Propagate path to global application state
        try:
            _set_app_setting("pdf_extracted_csv_path", str(working_csv_path))
            _set_app_setting("csv_input_path", str(working_csv_path))
        except Exception:
            pass

        res_obj = {
            "success": f"The CSV file has been successfully generated and saved to your temporary working directory at: {working_csv_path}",
            "saved": str(working_csv_path),
            "working_csv": str(working_csv_path),
            "working_folder": str(working_folder),
            "filename": default_name,
            "total_rows": len(rows)
        }
        try:
            from backends.feature_logger import note_feature
            note_feature("PDF Schedule Extraction", {
                "total_rows": len(rows),
                "filename": default_name,
                "mauze": mauze
            }, category="pdf")
        except Exception:
            pass
        return json.dumps(res_obj)
