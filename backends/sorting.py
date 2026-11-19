"""
Backend API: Media Sorter & Marker Detector
===========================================

This module organizes bulk photo and video media streams using "event marker" files.
It performs the following:
1. Detects covered-lens/black marker files using image analysis (OpenCV standard deviation).
2. Maps contributor camera prefixes (e.g., DSC, IMG, A7R) to directory positions.
3. Groups sequential images/videos between marker frames.
4. Generates visual thumbnails (JPEG base64 data) for various formats, including CR2/CR3 RAW images.
5. Executes transfers (copy or move) with transactional logging and undo/revert capabilities.
"""

import os
import shutil
import csv
import sys
import base64
import io
import re
import subprocess
import threading
import time
import json
import tempfile
import hashlib
import webview
import cv2
from PIL import Image

# ==============================================================================
# FILE EXTENSION CATEGORIES
# ==============================================================================
# Comprehensive collection of photo formats including mirrorless and RAW models.
IMAGE_EXTENSIONS = (
    '.jpg', '.jpeg', '.png', '.tiff', '.tif', '.heic', '.heif', '.webp',
    '.cr2', '.cr3', '.nef', '.nrw', '.arw', '.srf', '.sr2', '.dng',
    '.rw2', '.orf', '.gpr', '.pef', '.raf'
)

# Standard video container extensions.
VIDEO_EXTENSIONS = (
    '.mp4', '.mov', '.mkv', '.mxf', '.avi', '.flv', '.wmv', '.webm',
    '.m4v', '.mpg', '.mpeg', '.m2ts', '.mts', '.ts', '.3gp', '.dv',
    '.mp4v', '.3g2', '.mod', '.tod'
)

# Metadata files that must remain co-located with their parent media.
# These files are processed but omitted from UI grid renderers.
SIDECAR_EXTENSIONS = (
    '.xml', '.xmp', '.pkf', '.srt', '.thm', '.aae', '.lrv',
    '.json', '.ini', '.log', '.txt'
)

# ==============================================================================
# EXIFTOOL & TIME-LAPSE / CAPTURE TIMESTAMP METADATA ENGINE
# ==============================================================================
_EXIFTOOL_PATH = None
_EXIFTOOL_CHECKED = False
_TIMESTAMP_CACHE = {}
_TIMESTAMP_CACHE_LOCK = threading.Lock()

def find_exiftool():
    """Locates exiftool binary from PATH or project tool directories."""
    global _EXIFTOOL_PATH, _EXIFTOOL_CHECKED
    if _EXIFTOOL_CHECKED:
        return _EXIFTOOL_PATH
    
    candidates = [
        shutil.which("exiftool"),
        shutil.which("exiftool.exe"),
        os.path.join(os.path.dirname(__file__), "..", "tools", "exiftool.exe"),
        os.path.join(os.path.dirname(__file__), "..", "tools", "exiftool", "exiftool.exe"),
        os.path.join(os.path.dirname(__file__), "exiftool.exe"),
    ]
    for c in candidates:
        if c and os.path.exists(c) and os.access(c, os.X_OK):
            _EXIFTOOL_PATH = os.path.normpath(c)
            break
            
    _EXIFTOOL_CHECKED = True
    return _EXIFTOOL_PATH


def extract_media_timestamp(filepath):
    """
    Extracts high-precision capture timestamp (epoch seconds) for photos and videos.
    Solves camera sequence reset / rollover issues (e.g. 9999 -> 0001) by sorting
    in true chronological time order ("time slapes / timeslab").
    Prioritizes:
    1. Memory cache (0ms)
    2. ExifTool (if available) for native RAW, CR3, ARW, MP4 metadata
    3. PIL EXIF parser for JPEG/TIFF/RAW (DateTimeOriginal / DateTimeDigitized)
    4. Fast binary atom parser for MP4/MOV mvhd creation_time
    5. File modification timestamp (os.path.getmtime)
    """
    if not filepath or not os.path.exists(filepath):
        return 0.0

    try:
        stat = os.stat(filepath)
        mtime = stat.st_mtime
    except Exception:
        return 0.0

    cache_key = f"{filepath}_{mtime}"
    with _TIMESTAMP_CACHE_LOCK:
        if cache_key in _TIMESTAMP_CACHE:
            return _TIMESTAMP_CACHE[cache_key]

    ts = None
    ext = os.path.splitext(filepath)[1].lower()

    # If it's a sidecar file, attempt to derive timestamp from matching parent media
    if ext in SIDECAR_EXTENSIONS:
        parent_base = os.path.splitext(filepath)[0]
        for candidate_ext in IMAGE_EXTENSIONS + VIDEO_EXTENSIONS:
            parent_file = parent_base + candidate_ext
            if os.path.exists(parent_file):
                ts = extract_media_timestamp(parent_file)
                break
            parent_file_upper = parent_base + candidate_ext.upper()
            if os.path.exists(parent_file_upper):
                ts = extract_media_timestamp(parent_file_upper)
                break

    # 1. Try ExifTool if available
    exiftool_bin = find_exiftool()
    if ts is None and exiftool_bin:
        try:
            cmd = [
                exiftool_bin,
                "-s3",
                "-d", "%Y-%m-%d %H:%M:%S",
                "-DateTimeOriginal",
                "-CreateDate",
                "-SubSecDateTimeOriginal",
                "-MediaCreateDate",
                "-TrackCreateDate",
                filepath
            ]
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=2.5)
            lines = [l.strip() for l in res.stdout.strip().splitlines() if l.strip()]
            for line in lines:
                try:
                    import datetime
                    clean_dt = line.split('.')[0]
                    parsed = datetime.datetime.strptime(clean_dt, "%Y-%m-%d %H:%M:%S")
                    ts = parsed.timestamp()
                    break
                except Exception:
                    pass
        except Exception:
            pass

    # 2. Try Pillow EXIF for photos
    if ts is None and ext in IMAGE_EXTENSIONS:
        try:
            with Image.open(filepath) as img:
                exif = img._getexif()
                if exif:
                    # 36867 = DateTimeOriginal, 36868 = DateTimeDigitized, 306 = DateTime
                    val = exif.get(36867) or exif.get(36868) or exif.get(306)
                    if val:
                        import datetime
                        dt = datetime.datetime.strptime(str(val).strip(), '%Y:%m:%d %H:%M:%S')
                        ts = dt.timestamp()
        except Exception:
            pass

    # 3. Fast binary parser for MP4/MOV mvhd atom
    if ts is None and ext in ('.mp4', '.mov', '.m4v'):
        try:
            with open(filepath, 'rb') as f:
                header = f.read(1024 * 1024)
            pos = header.find(b'mvhd')
            if pos != -1 and len(header) >= pos + 16:
                import struct, datetime
                version = header[pos + 4]
                if version == 1 and len(header) >= pos + 24:
                    raw_time = struct.unpack('>Q', header[pos+8:pos+16])[0]
                else:
                    raw_time = struct.unpack('>I', header[pos+8:pos+12])[0]
                mac_epoch = datetime.datetime(1904, 1, 1).timestamp()
                calc_ts = mac_epoch + raw_time
                if 946684800 <= calc_ts <= 2208988800:
                    ts = calc_ts
        except Exception:
            pass

    # 4. Fallback to OS file modification time
    if ts is None or ts <= 0:
        ts = float(mtime)

    with _TIMESTAMP_CACHE_LOCK:
        _TIMESTAMP_CACHE[cache_key] = ts

    return ts

# Photo-only folder prefixes/codes (MQ, H, MF) that cannot contain video files
PHOTO_ONLY_SUFFIX_REGEX = re.compile(r'(?:^|[\s\-_/\\.]|\d+)(MQ|H|MF)\d*(?:[\s\-_/\\.]|$)', re.IGNORECASE)

def is_photo_only_folder(folder_path):
    if not folder_path:
        return False
    return bool(PHOTO_ONLY_SUFFIX_REGEX.search(folder_path))

def get_target_slot_for_file(idx, assigned_slots, is_video=False):
    if not assigned_slots:
        return "Unmapped - No Slots"
    
    target_idx = min(idx, len(assigned_slots) - 1)
    target_slot = assigned_slots[target_idx]
    
    if is_video and is_photo_only_folder(target_slot):
        found_slot = None
        for s_idx in range(target_idx, len(assigned_slots)):
            if not is_photo_only_folder(assigned_slots[s_idx]):
                found_slot = assigned_slots[s_idx]
                break
        if found_slot is None:
            for s_idx in range(target_idx - 1, -1, -1):
                if not is_photo_only_folder(assigned_slots[s_idx]):
                    found_slot = assigned_slots[s_idx]
                    break
        if found_slot is not None:
            target_slot = found_slot

    return target_slot

def get_target_slot_for_group(idx, assigned_slots, has_video=False):
    return get_target_slot_for_file(idx, assigned_slots, is_video=has_video)


def get_contributor_dir(root_dir):
    """
    Returns the path to the Contributor directory inside root_dir, or root_dir itself
    if root_dir IS named 'Contributor'.
    Ensures media sorting ONLY scans the Contributor folder and its subfolders.
    """
    if not root_dir or not os.path.isdir(root_dir):
        return os.path.join(root_dir or ".", "Contributor")
    
    norm_root = os.path.normpath(os.path.abspath(root_dir))
    if os.path.basename(norm_root).lower() == "contributor":
        return norm_root
        
    for entry in os.listdir(norm_root):
        full_path = os.path.join(norm_root, entry)
        if os.path.isdir(full_path) and entry.lower() == "contributor":
            return full_path
            
    return os.path.join(norm_root, "Contributor")


def get_document_dir(root_dir):
    """
    Returns the path to the Document directory inside root_dir.
    If root_dir itself is a Contributor directory, checks the parent folder.
    Creates the Document folder if it does not exist.
    """
    if not root_dir:
        root_dir = "."
    norm_root = os.path.normpath(os.path.abspath(root_dir))
    
    if os.path.basename(norm_root).lower() == "contributor":
        parent_dir = os.path.dirname(norm_root)
        doc_dir = os.path.join(parent_dir, "Document")
    else:
        doc_dir = os.path.join(norm_root, "Document")
        
    os.makedirs(doc_dir, exist_ok=True)
    return doc_dir


def find_auto_mapping_csv(root_dir):
    """
    Auto-detects the mapping CSV file for the given root_dir.
    The mapping CSV is located in the Document folder with the same name as the root directory:
    e.g. <root_dir>/Document/<folder_name>.csv.
    Also handles root_dir being the Contributor folder, Documents plural, and case variations.
    """
    if not root_dir or not os.path.isdir(root_dir):
        return None

    norm_root = os.path.normpath(os.path.abspath(root_dir))
    folder_name = os.path.basename(norm_root)

    check_dirs = [norm_root]
    # If the user selected the 'Contributor' subfolder directly, also check parent
    if folder_name.lower() in ("contributor", "contributors"):
        parent = os.path.dirname(norm_root)
        if parent and os.path.isdir(parent):
            check_dirs.insert(0, parent)
            folder_name = os.path.basename(parent)

    for base in check_dirs:
        base_name = os.path.basename(base)
        doc_candidates = []
        try:
            for entry in os.listdir(base):
                entry_path = os.path.join(base, entry)
                if os.path.isdir(entry_path) and entry.lower() in ("document", "documents", "doc", "docs"):
                    doc_candidates.append(entry_path)
        except Exception:
            pass

        # 1. Exact match in Document folders: <base>/Document/<base_name>.csv
        for doc_dir in doc_candidates:
            target_csv = os.path.join(doc_dir, f"{base_name}.csv")
            if os.path.isfile(target_csv):
                return os.path.normpath(target_csv)
            try:
                for f in os.listdir(doc_dir):
                    if f.lower() == f"{base_name.lower()}.csv":
                        return os.path.normpath(os.path.join(doc_dir, f))
            except Exception:
                pass

        # 2. Look for any CSV matching base_name or any CSV file in Document folder
        for doc_dir in doc_candidates:
            try:
                csvs = [
                    os.path.normpath(os.path.join(doc_dir, f)) for f in os.listdir(doc_dir)
                    if f.lower().endswith('.csv') and not f.startswith('.') and not f.startswith('~')
                ]
                if csvs:
                    for c in csvs:
                        if base_name.lower() in os.path.basename(c).lower():
                            return c
                    return csvs[0]
            except Exception:
                pass

        # 3. Direct check in base directory: <base>/<base_name>.csv
        direct_csv = os.path.join(base, f"{base_name}.csv")
        if os.path.isfile(direct_csv):
            return os.path.normpath(direct_csv)

    return None


# ==============================================================================
# OPENCV COVERED-LENS / BLACK MARKER DETECTION
# ==============================================================================
def is_image_marker(file_path, std_dev_threshold=25.0):
    """
    Ultra-fast image marker check.
    Uses PIL low-res draft decoding or fast OpenCV/RAW preview decode to check variance.
    """
    try:
        with Image.open(file_path) as img:
            img.draft('L', (128, 128))
            gray = img.convert('L')
            extrema = gray.getextrema()
            if isinstance(extrema, tuple) and len(extrema) == 2 and isinstance(extrema[0], (int, float)) and isinstance(extrema[1], (int, float)):
                if (float(extrema[1]) - float(extrema[0])) < std_dev_threshold:
                    return True
            import numpy as np
            arr = np.asarray(gray)
            return float(np.std(arr)) < std_dev_threshold
    except Exception:
        pass

    # Check RAW formats (.cr2, .cr3, .nef, .arw, etc.)
    ext = os.path.splitext(file_path)[1].lower()
    if ext in ('.cr3', '.cr2', '.nef', '.arw', '.dng', '.orf', '.pef', '.raf'):
        try:
            with open(file_path, 'rb') as f:
                data = f.read(3 * 1024 * 1024)
            pos = 0
            while True:
                soi = data.find(b'\xff\xd8\xff', pos)
                if soi == -1:
                    break
                eoi = data.find(b'\xff\xd9', soi)
                if eoi != -1:
                    try:
                        with Image.open(io.BytesIO(data[soi:eoi+2])) as img:
                            gray = img.convert('L')
                            extrema = gray.getextrema()
                            if isinstance(extrema, tuple) and len(extrema) == 2 and isinstance(extrema[0], (int, float)) and isinstance(extrema[1], (int, float)):
                                if (float(extrema[1]) - float(extrema[0])) < std_dev_threshold:
                                    return True
                            import numpy as np
                            arr = np.asarray(gray)
                            return float(np.std(arr)) < std_dev_threshold
                    except Exception:
                        pass
                    pos = eoi + 2
                else:
                    pos = soi + 3
        except Exception:
            pass

    # Fallback to OpenCV grayscale decode with downscaling
    try:
        img = cv2.imread(file_path, cv2.IMREAD_GRAYSCALE)
        if img is None:
            return False
        if img.shape[0] > 300 or img.shape[1] > 300:
            img = cv2.resize(img, (150, 150), interpolation=cv2.INTER_NEAREST)
        _, std_dev = cv2.meanStdDev(img)
        return float(std_dev[0][0]) < std_dev_threshold
    except Exception:
        return False


def is_video_marker(file_path, std_dev_threshold=25.0, max_mean_threshold=28.0, high_iso_std_dev_threshold=40.0):
    """
    Ultra-fast video marker detection.
    Reads Frame 0 (I-frame keyframe) first without seeking.
    A marker clip MUST be dark (mean brightness m < 28.0) with low variance.
    If Frame 0 is bright/normal (m >= 28.0), exits immediately in < 3ms.
    If Frame 0 is dark (candidate marker), verifies with a second frame at 1 sec mark.
    """
    try:
        cap = cv2.VideoCapture(file_path)
        if not cap.isOpened():
            return False

        # Fast Step 1: Read Frame 0 (I-frame/Keyframe) instantly without seeking
        success, frame = cap.read()
        if not success or frame is None or frame.size == 0:
            cap.release()
            return False

        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        if gray.shape[0] > 300 or gray.shape[1] > 300:
            gray = cv2.resize(gray, (150, 150), interpolation=cv2.INTER_NEAREST)

        mean_val, std_dev_val = cv2.meanStdDev(gray)
        m0 = float(mean_val[0][0])
        s0 = float(std_dev_val[0][0])

        # A video marker MUST be dark (m0 < 28.0) AND have low variance (s0 < 25.0 or high ISO s0 < 40.0)
        is_frame0_dark = (m0 < max_mean_threshold) and ((s0 < std_dev_threshold) or (s0 < high_iso_std_dev_threshold))

        # Fast exit: if Frame 0 is not dark/black, this video clip is 100% NOT a marker clip.
        if not is_frame0_dark:
            cap.release()
            return False

        # Fast Step 2: Frame 0 was dark. Confirm with a second frame at ~1.0 second (30th frame or 1000ms)
        sample_ms = 1000
        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        frame_idx = int((sample_ms / 1000.0) * fps)
        
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
        success, frame2 = cap.read()

        if success and frame2 is not None and frame2.size > 0:
            gray2 = cv2.cvtColor(frame2, cv2.COLOR_BGR2GRAY)
            if gray2.shape[0] > 300 or gray2.shape[1] > 300:
                gray2 = cv2.resize(gray2, (150, 150), interpolation=cv2.INTER_NEAREST)

            m2, s2 = cv2.meanStdDev(gray2)
            m_val = float(m2[0][0])
            s_val = float(s2[0][0])

            is_frame2_dark = (m_val < max_mean_threshold) and ((s_val < std_dev_threshold) or (s_val < high_iso_std_dev_threshold))
            cap.release()
            return is_frame2_dark

        cap.release()
        return True
    except Exception:
        return False


def check_media_file(file_path):
    """
    Routes a file to the appropriate marker detection helper based on its extension.
    """
    ext = os.path.splitext(file_path)[1].lower()

    if ext in IMAGE_EXTENSIONS:
        return is_image_marker(file_path, std_dev_threshold=25.0)

    elif ext in VIDEO_EXTENSIONS:
        return is_video_marker(file_path, std_dev_threshold=25.0)

    return False


# ==============================================================================
# TEMPLATE CSV MAPPING & CONTRIBUTOR PARSING
# ==============================================================================
def update_mapping_csv_series(mapping_path, contributor_series):
    """
    Updates or persists contributor series prefixes back into the selected CSV mapping file.
    If 'Contributor's Name' or 'Contributor's Series' columns do not exist, they will be created.
    """
    if not mapping_path or not os.path.isfile(mapping_path):
        return False
    
    try:
        rows = []
        with open(mapping_path, 'r', encoding='utf-8-sig') as f:
            reader = csv.reader(f)
            rows = list(reader)
            
        if not rows:
            rows = [["Sub-Event List", "Contributor's Name", "Contributor's Series"]]
            
        headers = list(rows[0])
        headers_lower = [h.strip().lower() for h in headers]
        
        name_col = None
        series_col = None
        for i, h in enumerate(headers_lower):
            if "contributor" in h and "name" in h:
                name_col = i
            elif "contributor" in h and "series" in h:
                series_col = i
                
        if name_col is None:
            headers.append("Contributor's Name")
            name_col = len(headers) - 1
            headers_lower.append("contributor's name")
            
        if series_col is None:
            headers.append("Contributor's Series")
            series_col = len(headers) - 1
            headers_lower.append("contributor's series")
            
        rows[0] = headers
        num_cols = len(headers)
        
        # Ensure all data rows match header column length
        for r in range(1, len(rows)):
            if len(rows[r]) < num_cols:
                rows[r].extend([''] * (num_cols - len(rows[r])))
                
        placed = set()
        
        # Update existing rows that already list the contributor name
        for r in range(1, len(rows)):
            row_name = rows[r][name_col].strip()
            if row_name in contributor_series:
                rows[r][series_col] = str(contributor_series[row_name]).strip()
                placed.add(row_name)
                
        # Place any remaining contributors into empty name_col slots or new rows
        for cname, cseries in contributor_series.items():
            if cname in placed:
                continue
            
            # Look for an existing row with empty name_col
            slot_found = False
            for r in range(1, len(rows)):
                if not rows[r][name_col].strip():
                    rows[r][name_col] = cname
                    rows[r][series_col] = str(cseries).strip()
                    placed.add(cname)
                    slot_found = True
                    break
                    
            if not slot_found:
                new_row = [''] * num_cols
                new_row[name_col] = cname
                new_row[series_col] = str(cseries).strip()
                rows.append(new_row)
                placed.add(cname)
                
        with open(mapping_path, 'w', encoding='utf-8-sig', newline='') as f:
            writer = csv.writer(f)
            writer.writerows(rows)
            
        return True
    except Exception as e:
        print(f"[Error] Failed to update mapping CSV series: {e}")
        return False


def parse_mapping_file(file_path):
    """
    Parses the template CSV mapping to match event groups with contributor names and series prefixes.
    """
    sub_event_contributors = []
    contributor_series = {}
    ordered_contributors = []
    seen_contribs = set()
    
    with open(file_path, 'r', encoding='utf-8-sig') as f:
        reader = csv.reader(f)
        headers = next(reader)
        headers_lower = [h.strip().lower() for h in headers]
        
        name_col = None
        series_col = None
        for i, h in enumerate(headers_lower):
            if "contributor" in h and "name" in h:
                name_col = i
            elif "contributor" in h and "series" in h:
                series_col = i
        
        folder_name_col = None
        for i, h in enumerate(headers_lower):
            h_clean = h.replace('_', '').replace(' ', '').replace('-', '')
            if h_clean == "foldername":
                folder_name_col = i
                break
        
        contrib_cols = []
        for i, h in enumerate(headers_lower):
            if h.startswith("contributors") and "name" not in h and "series" not in h:
                contrib_cols.append(i)
        
        if not contrib_cols:
            contrib_cols = [1, 2]
        
        for row in reader:
            if not row:
                continue
            
            if name_col is not None and series_col is not None:
                cont_name = row[name_col].strip() if len(row) > name_col else ""
                cont_series = row[series_col].strip() if len(row) > series_col else ""
                
                if cont_name:
                    if cont_name not in seen_contribs:
                        seen_contribs.add(cont_name)
                        ordered_contributors.append(cont_name)
                    if cont_series:
                        contributor_series[cont_name] = cont_series

            sub_event_str = row[0].strip() if len(row) > 0 else ""
            folder_name_val = row[folder_name_col].strip() if (folder_name_col is not None and len(row) > folder_name_col) else ""
            if not sub_event_str and not folder_name_val:
                continue
            
            contribs = []
            for ci in contrib_cols:
                if len(row) > ci and row[ci].strip():
                    cname = row[ci].strip()
                    contribs.append(cname)
                    if cname not in seen_contribs:
                        seen_contribs.add(cname)
                        ordered_contributors.append(cname)
            
            sub_event_contributors.append({
                'sub_event_str': sub_event_str,
                'folder_name': folder_name_val,
                'contribs': contribs
            })
            
    return sub_event_contributors, contributor_series, ordered_contributors


def parse_file_number(filename):
    """
    Extracts numeric value from filename for sequential range comparison.
    E.g. 'C0042.MP4' -> 42, 'DSC_0150.JPG' -> 150, '1' -> 1.
    """
    stem = os.path.splitext(filename)[0]
    matches = re.findall(r'\d+', stem)
    if matches:
        return int(matches[-1])
    return None


def is_file_in_range(filepath, start_filename, end_filename):
    """
    Checks if a file falls within [start_filename, end_filename] range inclusively.
    Handles numeric sequences (e.g. C0001 to C0050, 1 to 50) as well as string ranges.
    """
    if not start_filename and not end_filename:
        return True
    filename = os.path.basename(filepath)
    file_num = parse_file_number(filename)
    start_num = parse_file_number(start_filename) if start_filename else None
    end_num = parse_file_number(end_filename) if end_filename else None

    if file_num is not None:
        if start_num is not None and end_num is not None:
            return start_num <= file_num <= end_num
        elif start_num is not None:
            return file_num >= start_num
        elif end_num is not None:
            return file_num <= end_num

    fn_lower = filename.lower()
    st_lower = start_filename.lower() if start_filename else ""
    en_lower = end_filename.lower() if end_filename else ""
    if st_lower and en_lower:
        return st_lower <= fn_lower <= en_lower
    elif st_lower:
        return fn_lower >= st_lower
    elif en_lower:
        return fn_lower <= en_lower
    return True


def map_files_to_contributors(src_dir, contributor_series, ordered_contributors, camera_ranges=None):
    """
    Scans src_dir (files can be in any subfolder or root).
    Maps files to contributors based on contributor_series prefix.
    If multiple contributors share the same series prefix (e.g. C0 for Cam 1 and Cam 2),
    detects same-series conflict and applies camera_ranges if provided.
    """
    if camera_ranges is None:
        camera_ranges = {}

    all_files = []
    if os.path.isdir(src_dir):
        for root, dirs, files in os.walk(src_dir):
            for f in files:
                if f.startswith('.') or f.lower() == 'thumbs.db':
                    continue
                all_files.append(os.path.join(root, f))

    def sort_key(filepath):
        try:
            from backends.exif_tools import make_exif_sort_key
            return make_exif_sort_key(filepath)
        except Exception:
            filename = os.path.splitext(os.path.basename(filepath))[0]
            ext = os.path.splitext(filepath)[1].lower()
            is_sidecar = 1 if ext in SIDECAR_EXTENSIONS else 0
            match = re.search(r'\d+', filename)
            num = int(match.group()) if match else 0
            try:
                mtime = os.path.getmtime(filepath)
            except Exception:
                mtime = 0.0
            return (num, is_sidecar, mtime, filename.lower())

    all_files.sort(key=sort_key)

    # Normalize contributor series mapping (case-insensitive)
    series_to_conts = {}
    for cont in ordered_contributors:
        ser = contributor_series.get(cont, '')
        ser_clean = ser.strip().upper() if ser else ''
        if ser_clean:
            if ser_clean not in series_to_conts:
                series_to_conts[ser_clean] = []
            series_to_conts[ser_clean].append(cont)

    # Also detect if multiple contributors have no prefix configured, but actual
    # video files on disk share a common prefix like C0 or C
    if len(ordered_contributors) > 1 and not series_to_conts:
        video_files = [f for f in all_files if os.path.splitext(f)[1].lower() in VIDEO_EXTENSIONS]
        if video_files:
            # Check most frequent prefix
            prefix_counts = {}
            for vf in video_files:
                stem = os.path.splitext(os.path.basename(vf))[0]
                m = re.match(r'^([a-zA-Z0-9]+?)(?=\d)', stem)
                if m:
                    p = m.group(1).upper()
                    prefix_counts[p] = prefix_counts.get(p, 0) + 1
            if prefix_counts:
                dominant_p = max(prefix_counts.items(), key=lambda x: x[1])[0]
                series_to_conts[dominant_p] = list(ordered_contributors)

    subfolder_files = {}
    for f in all_files:
        rel = os.path.relpath(f, src_dir)
        parts = rel.split(os.sep)
        if len(parts) > 1:
            sf_name = parts[0]
            if sf_name not in subfolder_files:
                subfolder_files[sf_name] = []
            subfolder_files[sf_name].append(f)

    conflicts = []

    for ser, conts in series_to_conts.items():
        if len(conts) > 1:
            matching_files = [f for f in all_files if os.path.basename(f).upper().startswith(ser)]
            if matching_files:
                cam_list = []
                
                # Check for folder-wise subdirectories matching the series
                sub_matches = []
                for sf_name in sorted(subfolder_files.keys()):
                    s_files = [f for f in subfolder_files[sf_name] if os.path.basename(f).upper().startswith(ser)]
                    if s_files:
                        sub_matches.append((sf_name, s_files))
                
                if len(sub_matches) >= len(conts):
                    # Folder-wise allocation: match subfolder files to each camera
                    for idx, cname in enumerate(conts):
                        cam_key = f"Cam {idx+1:02d}"
                        sf_name, s_files = sub_matches[min(idx, len(sub_matches)-1)]
                        min_f = os.path.basename(s_files[0]) if s_files else ""
                        max_f = os.path.basename(s_files[-1]) if s_files else ""
                        cam_list.append({
                            'cam_name': cam_key,
                            'contributor': cname,
                            'series': ser,
                            'min_file': min_f,
                            'max_file': max_f,
                            'file_count': len(s_files),
                            'subfolder': sf_name
                        })
                else:
                    # Sequential chunk splitting across total dump files
                    total_match = len(matching_files)
                    chunk_size = (total_match + len(conts) - 1) // len(conts)
                    for idx, cname in enumerate(conts):
                        cam_key = f"Cam {idx+1:02d}"
                        chunk = matching_files[idx * chunk_size : (idx + 1) * chunk_size]
                        min_f = os.path.basename(chunk[0]) if chunk else ""
                        max_f = os.path.basename(chunk[-1]) if chunk else ""
                        cam_list.append({
                            'cam_name': cam_key,
                            'contributor': cname,
                            'series': ser,
                            'min_file': min_f,
                            'max_file': max_f,
                            'file_count': len(chunk),
                            'subfolder': None
                        })

                conflicts.append({
                    'series': ser,
                    'cams': cam_list
                })

    has_conflict = len(conflicts) > 0

    contrib_files_dict = {cont: [] for cont in ordered_contributors}
    for cont in contributor_series.keys():
        if cont not in contrib_files_dict:
            contrib_files_dict[cont] = []

    unassigned_files = []

    for f in all_files:
        bname = os.path.basename(f)
        rel = os.path.relpath(f, src_dir)
        parts = rel.split(os.sep)
        subfolder = parts[0] if len(parts) > 1 else ""
        assigned = False

        # 1. First priority: Check camera_ranges constraints if configured
        if camera_ranges:
            for cont in ordered_contributors:
                cam_range = camera_ranges.get(cont)
                if not cam_range:
                    for k, r in camera_ranges.items():
                        if cont.lower() in k.lower() or k.lower() in cont.lower():
                            cam_range = r
                            break
                if cam_range:
                    target_sub = cam_range.get('subfolder')
                    start_f = cam_range.get('start')
                    end_f = cam_range.get('end')

                    if target_sub:
                        # Tied to a specific subfolder (e.g. 'Cam 1' or 'Cam 2')
                        if subfolder and (subfolder.lower() == target_sub.lower() or target_sub.lower() in subfolder.lower() or subfolder.lower() in target_sub.lower()):
                            if is_file_in_range(f, start_f, end_f):
                                contrib_files_dict[cont].append(f)
                                assigned = True
                                break
                    else:
                        ser = contributor_series.get(cont, '')
                        if not ser or bname.upper().startswith(ser.upper()):
                            if is_file_in_range(f, start_f, end_f):
                                contrib_files_dict[cont].append(f)
                                assigned = True
                                break

        # 2. Second priority: Standard series prefix matching
        if not assigned:
            sorted_conts = sorted(ordered_contributors, key=lambda c: len(contributor_series.get(c, '')), reverse=True)
            for cont in sorted_conts:
                ser = contributor_series.get(cont, '')
                if ser and bname.upper().startswith(ser.upper()):
                    contrib_files_dict[cont].append(f)
                    assigned = True
                    break

        # 3. Third priority: Subfolder name matching 'Cam 1', 'Cam 2', etc.
        if not assigned and subfolder:
            if subfolder.lower().startswith('cam'):
                match = re.search(r'\d+', subfolder)
                if match:
                    cam_idx = int(match.group()) - 1
                    if 0 <= cam_idx < len(ordered_contributors):
                        target_cont = ordered_contributors[cam_idx]
                        contrib_files_dict[target_cont].append(f)
                        assigned = True

        if not assigned:
            unassigned_files.append(f)

    for cont in contrib_files_dict:
        contrib_files_dict[cont].sort(key=sort_key)

    if unassigned_files and ordered_contributors:
        first_cont = ordered_contributors[0]
        contrib_files_dict[first_cont].extend(unassigned_files)
        contrib_files_dict[first_cont].sort(key=sort_key)

    return contrib_files_dict, conflicts, has_conflict



def group_files_by_indicator(files):
    """
    Groups sorted lists of files into sub-events using black marker pictures
    as partition points. Uses parallel thread execution for maximum speed.
    """
    from concurrent.futures import ThreadPoolExecutor

    # Pre-filter media files that require marker analysis
    media_files = [f for f in files if os.path.splitext(f)[1].lower() not in SIDECAR_EXTENSIONS]
    marker_results = {}

    if media_files:
        workers = min(32, (os.cpu_count() or 4) * 4)
        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = {executor.submit(check_media_file, f): f for f in media_files}
            for future in futures:
                f = futures[future]
                try:
                    marker_results[f] = future.result()
                except Exception:
                    marker_results[f] = False

    groups = []
    current_group = []

    for f in files:
        filename, ext = os.path.splitext(os.path.basename(f))
        ext = ext.lower()

        # Sidecar files remain grouped with their parent media files.
        if ext in SIDECAR_EXTENSIONS:
            if not current_group:
                current_group = [f]
            else:
                current_group.append(f)
            continue

        # Check pre-computed marker status
        if marker_results.get(f, False):
            # Split group: start a new collection.
            if current_group:
                groups.append(current_group)
            current_group = [f]
        else:
            if not current_group:
                current_group = [f]
            else:
                current_group.append(f)

    if current_group:
        groups.append(current_group)

    return groups


def get_target_dir(root_dir, master_folder, leaf_folder, sub_event_folder, cont):
    """
    Constructs the absolute target path for sorted output files.
    """
    norm_root = os.path.normpath(root_dir)
    root_basename = os.path.basename(norm_root)
    
    if root_basename.lower() == "contributor":
        parent = os.path.dirname(norm_root)
        if os.path.basename(parent) == master_folder:
            base = parent
        else:
            base = os.path.join(parent, master_folder)
    elif root_basename == master_folder:
        base = norm_root
    else:
        candidate = os.path.join(norm_root, master_folder)
        if os.path.isdir(candidate):
            base = candidate
        else:
            base = os.path.join(norm_root, master_folder)
            
    if sub_event_folder:
        return os.path.join(base, leaf_folder, sub_event_folder, cont)
    else:
        if leaf_folder == master_folder:
            return os.path.join(base, cont)
        return os.path.join(base, leaf_folder, cont)


# ==============================================================================
# ASYNCHRONOUS THUMBNAIL DECODING ENGINE & PERSISTENT CACHE
# ==============================================================================
_DISK_CACHE_DIR = os.path.join(tempfile.gettempdir(), 'ain53_thumbnail_cache')
try:
    os.makedirs(_DISK_CACHE_DIR, exist_ok=True)
except Exception:
    pass

_THUMBNAIL_CACHE = {}
_THUMBNAIL_CACHE_LOCK = threading.Lock()
_MAX_THUMB_CACHE_SIZE = 20000

def _get_disk_cache_filename(file_path, mtime, filesize):
    key_str = f"{file_path}_{mtime}_{filesize}_320x210"
    file_hash = hashlib.md5(key_str.encode('utf-8')).hexdigest()
    return os.path.join(_DISK_CACHE_DIR, f"{file_hash}.jpg")

def get_cached_thumbnail(file_path):
    """
    Returns base64 thumbnail string from memory or persistent disk cache.
    Generates downscaled JPEG if not cached, and saves to disk cache for 0ms future re-fetches.
    """
    if not file_path or not os.path.exists(file_path):
        return None
        
    try:
        stat = os.stat(file_path)
        mtime = stat.st_mtime
        filesize = stat.st_size
    except Exception:
        mtime = 0
        filesize = 0

    # 1. Memory Cache check (0ms)
    with _THUMBNAIL_CACHE_LOCK:
        entry = _THUMBNAIL_CACHE.get(file_path)
        if entry and entry[0] == mtime:
            return entry[1]

    # 2. Persistent Disk Cache check (< 0.5ms)
    cache_file = _get_disk_cache_filename(file_path, mtime, filesize)
    if os.path.exists(cache_file):
        try:
            with open(cache_file, 'rb') as cf:
                jpg_bytes = cf.read()
            if jpg_bytes:
                b64_data = f"data:image/jpeg;base64,{base64.b64encode(jpg_bytes).decode('utf-8')}"
                with _THUMBNAIL_CACHE_LOCK:
                    _THUMBNAIL_CACHE[file_path] = (mtime, b64_data)
                return b64_data
        except Exception:
            pass

    # 3. Compute thumbnail Base64 & raw JPEG bytes
    b64_data, raw_jpg = _compute_file_thumbnail(file_path)
    
    if b64_data and raw_jpg:
        try:
            with open(cache_file, 'wb') as cf:
                cf.write(raw_jpg)
        except Exception:
            pass

    if b64_data:
        with _THUMBNAIL_CACHE_LOCK:
            if len(_THUMBNAIL_CACHE) >= _MAX_THUMB_CACHE_SIZE:
                keys_to_remove = list(_THUMBNAIL_CACHE.keys())[:int(_MAX_THUMB_CACHE_SIZE * 0.2)]
                for k in keys_to_remove:
                    _THUMBNAIL_CACHE.pop(k, None)
            _THUMBNAIL_CACHE[file_path] = (mtime, b64_data)
            
    return b64_data

def _compute_file_thumbnail(file_path):
    """
    Generates lightweight downscaled JPEG thumbnails (320x210, quality=70).
    Extracts embedded EXIF previews for RAW camera files in <2ms.
    """
    if not os.path.exists(file_path):
        return None, None
        
    ext = os.path.splitext(file_path)[1].lower()
    if ext in SIDECAR_EXTENSIONS:
        return None, None
    
    target_dim = (320, 210)
    
    # 1. Video files: Extract keyframe
    video_exts = ('.mp4', '.mov', '.avi', '.mkv', '.m4v', '.mts', '.m2ts', '.wmv', '.webm', '.3gp', '.flv')
    if ext in video_exts:
        try:
            import cv2
            cap = cv2.VideoCapture(file_path)
            success = False
            frame = None
            if cap.isOpened():
                success, frame = cap.read()
            if not success or frame is None or frame.size == 0:
                if cap.isOpened():
                    cap.set(cv2.CAP_PROP_POS_MSEC, 500)
                    success, frame = cap.read()
            cap.release()
            
            if success and frame is not None and frame.size > 0:
                frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                img = Image.fromarray(frame_rgb)
                img.thumbnail(target_dim, Image.Resampling.BILINEAR)
                buffered = io.BytesIO()
                img.save(buffered, format="JPEG", quality=70)
                raw_jpg = buffered.getvalue()
                b64 = f"data:image/jpeg;base64,{base64.b64encode(raw_jpg).decode('utf-8')}"
                return b64, raw_jpg
        except Exception:
            pass
            
    # 2. RAW files (CR2/CR3, NEF, ARW, DNG, ORF, PEF, RAF, RW2, SRW): Embedded EXIF JPEG extraction
    elif ext in ('.cr3', '.cr2', '.nef', '.arw', '.dng', '.orf', '.pef', '.raf', '.rw2', '.srw'):
        try:
            found_images = []
            with open(file_path, 'rb') as f:
                data = f.read(3 * 1024 * 1024)
            pos = 0
            while True:
                soi = data.find(b'\xff\xd8\xff', pos)
                if soi == -1:
                    break
                eoi = data.find(b'\xff\xd9', soi)
                if eoi != -1:
                    try:
                        img = Image.open(io.BytesIO(data[soi:eoi+2]))
                        found_images.append(img)
                    except Exception:
                        pass
                    pos = eoi + 2
                else:
                    pos = soi + 3

            if not found_images:
                with open(file_path, 'rb') as f:
                    data = f.read(10 * 1024 * 1024)
                pos = 0
                while True:
                    soi = data.find(b'\xff\xd8\xff', pos)
                    if soi == -1:
                        break
                    eoi = data.find(b'\xff\xd9', soi)
                    if eoi != -1:
                        try:
                            img = Image.open(io.BytesIO(data[soi:eoi+2]))
                            found_images.append(img)
                        except Exception:
                            pass
                        pos = eoi + 2
                    else:
                        pos = soi + 3

            if found_images:
                found_images.sort(key=lambda img: img.size[0] * img.size[1], reverse=True)
                img = found_images[0]
                img.thumbnail(target_dim, Image.Resampling.BILINEAR)
                buffered = io.BytesIO()
                img.save(buffered, format="JPEG", quality=70)
                raw_jpg = buffered.getvalue()
                b64 = f"data:image/jpeg;base64,{base64.b64encode(raw_jpg).decode('utf-8')}"
                return b64, raw_jpg
        except Exception:
            pass
            
    # 3. Standard image files
    try:
        with Image.open(file_path) as img:
            try:
                from PIL import ImageOps
                img = ImageOps.exif_transpose(img)
            except Exception:
                pass
            img.thumbnail(target_dim, Image.Resampling.BILINEAR)
            buffered = io.BytesIO()
            img.save(buffered, format="JPEG", quality=70)
            raw_jpg = buffered.getvalue()
            b64 = f"data:image/jpeg;base64,{base64.b64encode(raw_jpg).decode('utf-8')}"
            return b64, raw_jpg
    except Exception:
        pass
        
    return None, None

def get_high_res_preview(file_path):
    """
    Returns instant high-res preview for RAW files and media in Lightbox.
    Uses persistent disk cache for 0ms re-fetch.
    """
    if not file_path or not os.path.exists(file_path):
        return None
        
    try:
        stat = os.stat(file_path)
        mtime = stat.st_mtime
        filesize = stat.st_size
    except Exception:
        mtime = 0
        filesize = 0

    high_cache_file = _get_disk_cache_filename(file_path, mtime, filesize) + "_preview.jpg"
    if os.path.exists(high_cache_file):
        try:
            with open(high_cache_file, 'rb') as cf:
                jpg_bytes = cf.read()
            if jpg_bytes:
                return f"data:image/jpeg;base64,{base64.b64encode(jpg_bytes).decode('utf-8')}"
        except Exception:
            pass

    ext = os.path.splitext(file_path)[1].lower()
    raw_jpg = None

    if ext in ('.cr3', '.cr2', '.nef', '.arw', '.dng', '.orf', '.pef', '.raf', '.rw2', '.srw'):
        try:
            with open(file_path, 'rb') as f:
                header_data = f.read(3500000)
            soi_idx = header_data.find(b'\xff\xd8\xff')
            if soi_idx != -1:
                eoi_idx = header_data.find(b'\xff\xd9', soi_idx + 100)
                if eoi_idx != -1:
                    raw_jpg = header_data[soi_idx : eoi_idx + 2]
        except Exception:
            pass

    if not raw_jpg:
        try:
            with Image.open(file_path) as img:
                try:
                    from PIL import ImageOps
                    img = ImageOps.exif_transpose(img)
                except Exception:
                    pass
                img.thumbnail((1920, 1080), Image.Resampling.BILINEAR)
                buffered = io.BytesIO()
                img.save(buffered, format="JPEG", quality=85)
                raw_jpg = buffered.getvalue()
        except Exception:
            pass

    if raw_jpg:
        try:
            with open(high_cache_file, 'wb') as cf:
                cf.write(raw_jpg)
        except Exception:
            pass
        return f"data:image/jpeg;base64,{base64.b64encode(raw_jpg).decode('utf-8')}"

    return get_cached_thumbnail(file_path)

def get_file_thumbnail_base64(file_path):
    return get_cached_thumbnail(file_path)


# ==============================================================================
# PYWEBVIEW EXPOSED SORTING API
# ==============================================================================
class SortingApi:
    """
    Main sorting service API. Exposes methods to map, sort, transfer,
    and undo transfers.
    """
    def __init__(self):
        self._window = None
        self.mapping_path = None
        self.root_dir = None
        self.sub_events = []
        self.contributor_series = {}
        self.ordered_contributors = []
        self.camera_ranges = {}
        self.folders = []
        # Revert history stack
        self.transfer_history = []
        self._analysis_thread = None

    def select_mapping_file(self, path=None):
        """Displays dialog to select the template CSV mapping file."""
        selected_path = None
        if path: 
            if not os.path.isfile(path) or not path.lower().endswith('.csv'):
                if self._window:
                    self._window.evaluate_js("window.showToast('Please select/drop a valid CSV file (.csv).', true)")
                return None
            selected_path = path
        else:
            result = self._window.create_file_dialog(
                webview.FileDialog.OPEN,
                allow_multiple=False,
                file_types=('CSV Files (*.csv)',)
            )
            selected_path = result[0] if result else None

        if selected_path:
            try:
                from backends.updater import AutoUpdater
                AutoUpdater().set_setting("sorting_mapping_path", selected_path)
            except Exception:
                pass
        return selected_path
        
    def select_root_dir(self, path=None):
        """Displays folder selection dialog to set the target working directory."""
        selected_path = None
        if path: 
            if not os.path.isdir(path):
                if self._window:
                    self._window.evaluate_js("window.showToast('Please select/drop a valid folder/directory.', true)")
                return None
            selected_path = path
        else:
            result = self._window.create_file_dialog(
                webview.FileDialog.FOLDER
            )
            selected_path = result[0] if result else None

        if selected_path:
            try:
                from backends.updater import AutoUpdater
                AutoUpdater().set_setting("sorting_root_path", selected_path)
            except Exception:
                pass
        return selected_path

    def auto_detect_mapping_file(self, root_dir):
        """
        Scans for mapping CSV in Document folder with matching root directory name.
        Returns dict with found status, mapping_path and filename.
        """
        try:
            if not root_dir:
                return {'found': False, 'mapping_path': None}
            csv_path = find_auto_mapping_csv(root_dir)
            if csv_path and os.path.isfile(csv_path):
                self.mapping_path = csv_path
                return {
                    'found': True,
                    'mapping_path': csv_path,
                    'filename': os.path.basename(csv_path)
                }
            return {'found': False, 'mapping_path': None}
        except Exception as e:
            return {'found': False, 'error': str(e)}

    def select_folder_dialog(self):
        """Helper to request directory inputs from the frontend."""
        result = self._window.create_file_dialog(
            webview.FileDialog.FOLDER
        )
        return result[0] if result else None

    def create_physical_folder(self, parent_dir, folder_name):
        """Creates a folder in the file system and returns its path relative to root_dir."""
        try:
            new_dir = os.path.normpath(os.path.join(parent_dir, folder_name))
            os.makedirs(new_dir, exist_ok=True)
            rel_path = os.path.relpath(new_dir, self.root_dir)
            return {'success': True, 'rel_path': rel_path}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def add_files_dialog(self):
        """Displays file picker allowing multi-selection of media files."""
        result = self._window.create_file_dialog(
            webview.FileDialog.OPEN,
            allow_multiple=True,
            file_types=('All Files (*.*)',)
        )
        return result if result else []

    def _send_progress(self, data):
        """Sends analysis progress updates to the HTML frontend."""
        try:
            json_payload = json.dumps(json.dumps(data))
            self._window.evaluate_js(f"updateAnalysisProgress({json_payload})")
        except Exception:
            pass

    def set_camera_ranges(self, ranges):
        """Receives user-specified start and end file ranges for same-series conflicts."""
        try:
            if isinstance(ranges, str):
                self.camera_ranges = json.loads(ranges)
            else:
                self.camera_ranges = ranges
            return {'success': True}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def get_contributor_prefixes(self, mapping_path, root_dir):
        """
        Parses mapping CSV to retrieve contributor names and camera series prefixes.
        Scans root_dir to detect candidate prefixes from actual filenames.
        Returns data for user review/editing in the frontend modal.
        """
        try:
            prev_mapping = getattr(self, 'mapping_path', None)
            self.mapping_path = mapping_path
            self.root_dir = root_dir
            sub_events, contributor_series, ordered_contributors = parse_mapping_file(mapping_path)
            self.sub_events = sub_events
            
            if self.contributor_series and prev_mapping == mapping_path:
                for k, v in self.contributor_series.items():
                    if k in contributor_series:
                        contributor_series[k] = v
            else:
                self.contributor_series = dict(contributor_series)

            self.ordered_contributors = ordered_contributors

            detected_prefixes = set()
            src_dir = get_contributor_dir(root_dir)

            if os.path.isdir(src_dir):
                for root, dirs, files in os.walk(src_dir):
                    for f in files:
                        if f.startswith('.') or f.lower() == 'thumbs.db':
                            continue
                        ext = os.path.splitext(f)[1].lower()
                        if ext in IMAGE_EXTENSIONS or ext in VIDEO_EXTENSIONS:
                            stem = os.path.splitext(f)[0]
                            m = re.match(r'^([a-zA-Z0-9]+?)(?=\d)', stem)
                            if m:
                                detected_prefixes.add(m.group(1).upper())
                            parts = stem.split('_')
                            if parts and parts[0]:
                                detected_prefixes.add(parts[0].upper())

            return {
                'success': True,
                'contributor_series': self.contributor_series,
                'ordered_contributors': ordered_contributors,
                'detected_prefixes': sorted(list(detected_prefixes))
            }
        except Exception as e:
            import traceback
            return {'success': False, 'error': str(e) + '\n' + traceback.format_exc()}

    def set_contributor_series(self, series, mapping_path=None):
        """
        Receives user-confirmed or updated camera series prefix mapping per contributor.
        Saves changes into memory and updates the selected CSV mapping file on disk.
        """
        try:
            if isinstance(series, str):
                try:
                    self.contributor_series = json.loads(series)
                except Exception:
                    self.contributor_series = {}
            elif isinstance(series, dict):
                self.contributor_series = dict(series)
            else:
                self.contributor_series = {}

            target_mapping = mapping_path or getattr(self, 'mapping_path', None)
            if target_mapping and os.path.isfile(target_mapping):
                self.mapping_path = target_mapping
                update_mapping_csv_series(target_mapping, self.contributor_series)

            return {'success': True}
        except Exception as e:
            import traceback
            print(f"[Error] set_contributor_series error: {e}\n{traceback.format_exc()}")
            return {'success': False, 'error': str(e)}

    def scan_files(self, mapping_path, root_dir):
        """
        Phase 1: Quick Scan. Parses the CSV and counts total files per contributor
        to display on the loading screen before running heavy analysis.
        """
        try:
            self.mapping_path = mapping_path
            self.root_dir = root_dir

            sub_events, csv_contributor_series, ordered_contributors = parse_mapping_file(mapping_path)
            self.sub_events = sub_events
            self.ordered_contributors = ordered_contributors

            if not self.contributor_series:
                self.contributor_series = csv_contributor_series
            else:
                for c in ordered_contributors:
                    if c not in self.contributor_series:
                        self.contributor_series[c] = csv_contributor_series.get(c, '')

            contributor_series = self.contributor_series

            # Only scan the Contributor folder and its subfolders
            src_dir = get_contributor_dir(root_dir)

            contrib_files_dict, conflicts, has_conflict = map_files_to_contributors(
                src_dir, contributor_series, ordered_contributors, self.camera_ranges
            )

            # If same-series conflict is detected and no range constraints were submitted yet, prompt UI
            if has_conflict and not self.camera_ranges:
                return {
                    'has_conflict': True,
                    'conflicts': conflicts
                }

            # Sum total counts of media files
            total_photos = 0
            total_videos = 0
            total_other = 0
            all_contrib_file_lists = []

            for cont, flist in contrib_files_dict.items():
                ser = contributor_series.get(cont, '')
                for f in flist:
                    ext = os.path.splitext(f)[1].lower()
                    if ext in IMAGE_EXTENSIONS:
                        total_photos += 1
                    elif ext in VIDEO_EXTENSIONS:
                        total_videos += 1
                    else:
                        total_other += 1

                all_contrib_file_lists.append({
                    'contributor': cont,
                    'series': ser,
                    'files': flist
                })

            # Cache the files list for Phase 2 (start_analysis)
            self._cached_scan = {
                'src_dir': src_dir,
                'all_contrib_file_lists': all_contrib_file_lists
            }

            return {
                'has_conflict': False,
                'total_files': total_photos + total_videos + total_other,
                'total_photos': total_photos,
                'total_videos': total_videos,
                'total_other': total_other,
                'contributors': list(contrib_files_dict.keys())
            }
        except Exception as e:
            import traceback
            return {'error': str(e) + '\n' + traceback.format_exc()}


    def start_analysis(self):
        """
        Phase 2: Full Analysis. Runs covered-lens marker detection in parallel worker pool
        and pre-caches thumbnails in background threads to keep GUI fast and responsive.
        """
        def _run_analysis():
            try:
                from concurrent.futures import ThreadPoolExecutor, as_completed

                scan = self._cached_scan
                root_dir = self.root_dir
                sub_events = self.sub_events
                contributor_series = self.contributor_series

                folders_set = []

                # Compile expected folders structure
                for cont, ser in contributor_series.items():
                    for se in sub_events:
                        if cont in se['contribs']:
                            parts = [p.strip() for p in se['sub_event_str'].split(' - ')]
                            if len(parts) >= 1 and parts[0]:
                                master_folder = parts[0]
                                leaf_folder = parts[1].rstrip('-').strip() if len(parts) >= 2 else parts[0]
                                fn_ovr = se.get('folder_name', '').strip() if isinstance(se, dict) else ''
                                sub_event_folder = fn_ovr if fn_ovr else (parts[2] if (len(parts) > 2 and parts[2].strip() != "") else None)
                                target_dir = get_target_dir(root_dir, master_folder, leaf_folder, sub_event_folder, cont)
                                rel_target = os.path.relpath(target_dir, root_dir)
                                if rel_target not in folders_set:
                                    folders_set.append(rel_target)

                self.folders = folders_set

                # Collect all media items needing marker inspection across all contributors
                all_media_items = []
                for cdata in scan['all_contrib_file_lists']:
                    cont = cdata['contributor']
                    for f in cdata['files']:
                        ext = os.path.splitext(f)[1].lower()
                        if ext in IMAGE_EXTENSIONS:
                            all_media_items.append((f, 'photo', cont))
                        elif ext in VIDEO_EXTENSIONS:
                            all_media_items.append((f, 'video', cont))

                total_media = len(all_media_items)
                marker_results = {}

                def _analyze_single_file(item):
                    f, f_type, cont = item
                    is_marker = False
                    if f_type == 'photo':
                        is_marker = is_image_marker(f, std_dev_threshold=25.0)
                    elif f_type == 'video':
                        is_marker = is_video_marker(f, std_dev_threshold=25.0)
                    
                    # Pre-populate thumbnail in memory cache during analysis
                    try:
                        get_cached_thumbnail(f)
                    except Exception:
                        pass
                    return f, is_marker, f_type, cont

                workers = min(32, (os.cpu_count() or 4) * 4)
                analysed_count = 0
                photos_analysed = 0
                videos_analysed = 0
                markers_found = 0

                if all_media_items:
                    with ThreadPoolExecutor(max_workers=workers) as executor:
                        futures = {executor.submit(_analyze_single_file, item): item for item in all_media_items}
                        for future in as_completed(futures):
                            try:
                                f, is_marker, f_type, cont = future.result()
                                marker_results[f] = is_marker
                                analysed_count += 1
                                if f_type == 'photo':
                                    photos_analysed += 1
                                elif f_type == 'video':
                                    videos_analysed += 1
                                if is_marker:
                                    markers_found += 1

                                # Throttle progress reports to prevent UI lag
                                if analysed_count % 10 == 0 or analysed_count == total_media or is_marker:
                                    self._send_progress({
                                        'type': 'progress',
                                        'current': analysed_count,
                                        'total': total_media,
                                        'photos_analysed': photos_analysed,
                                        'videos_analysed': videos_analysed,
                                        'markers_found': markers_found,
                                        'current_file': os.path.basename(f),
                                        'current_contributor': cont,
                                        'file_type': f_type,
                                        'is_marker': is_marker
                                    })
                            except Exception:
                                pass

                files_list = []
                file_id_counter = 1

                for cdata in scan['all_contrib_file_lists']:
                    cont = cdata['contributor']
                    contrib_files = cdata['files']

                    assigned_slots = []
                    for se in sub_events:
                        if cont in se['contribs']:
                            parts = [p.strip() for p in se['sub_event_str'].split(' - ')]
                            if len(parts) >= 1 and parts[0]:
                                master_folder = parts[0]
                                leaf_folder = parts[1].rstrip('-').strip() if len(parts) >= 2 else parts[0]
                                fn_ovr = se.get('folder_name', '').strip() if isinstance(se, dict) else ''
                                sub_event_folder = fn_ovr if fn_ovr else (parts[2] if (len(parts) > 2 and parts[2].strip() != "") else None)
                                target_dir = get_target_dir(root_dir, master_folder, leaf_folder, sub_event_folder, cont)
                                assigned_slots.append(os.path.relpath(target_dir, root_dir))

                    groups = []
                    current_group = []

                    # Analyze files in contributor lists and identify markers
                    for f in contrib_files:
                        filename, ext = os.path.splitext(os.path.basename(f))
                        ext = ext.lower()

                        if ext in SIDECAR_EXTENSIONS:
                            if not current_group:
                                current_group = [f]
                            else:
                                current_group.append(f)
                            continue

                        is_marker = marker_results.get(f, False)

                        if is_marker:
                            if current_group:
                                groups.append(current_group)
                            current_group = [f]
                        else:
                            if not current_group:
                                current_group = [f]
                            else:
                                current_group.append(f)

                    if current_group:
                        groups.append(current_group)

                    # Map analyzed file groups to destination folders.
                    for idx, gp in enumerate(groups):
                        for f in gp:
                            f_ext = os.path.splitext(f)[1].lower()
                            is_vid = f_ext in VIDEO_EXTENSIONS
                            is_img = f_ext in IMAGE_EXTENSIONS
                            f_type = 'video' if is_vid else ('photo' if is_img else 'other')
                            
                            target_folder_path = get_target_slot_for_file(idx, assigned_slots, is_video=is_vid)

                            if target_folder_path not in self.folders:
                                self.folders.append(target_folder_path)

                            folder_index = self.folders.index(target_folder_path)

                            thumb_b64 = get_cached_thumbnail(f)
                            files_list.append({
                                'id': file_id_counter,
                                'filename': os.path.basename(f),
                                'path': f,
                                'contributor': cont,
                                'folder_index': folder_index,
                                'dont_copy': False,
                                'selected': False,
                                'is_new': False,
                                'is_video': is_vid,
                                'is_photo': is_img,
                                'file_type': f_type,
                                'is_sidecar': f_ext in SIDECAR_EXTENSIONS,
                                'thumbnail': thumb_b64
                            })
                            file_id_counter += 1

                contributors_summary = {}
                for f in files_list:
                    c = f['contributor']
                    contributors_summary[c] = contributors_summary.get(c, 0) + 1

                # Send final results and completion status to the frontend
                result = {
                    'files': files_list,
                    'folders': self.folders,
                    'contributors': contributors_summary
                }
                result_payload = json.dumps(result)
                self._window.evaluate_js(f"onAnalysisComplete({json.dumps(result_payload)})")

            except Exception as e:
                import traceback
                err = str(e) + '\n' + traceback.format_exc()
                err_payload = json.dumps({'error': err})
                self._window.evaluate_js(f"onAnalysisComplete({json.dumps(err_payload)})")

        # Launch background thread
        self._analysis_thread = threading.Thread(target=_run_analysis, daemon=True)
        self._analysis_thread.start()
        return {'started': True}

    def generate_thumbnail(self, file_path):
        """Exposes single thumbnail Base64 encoder function to the UI."""
        try:
            return get_file_thumbnail_base64(file_path)
        except Exception as e:
            print(f"Error base64 thumbnail generation: {e}")
            return None

    def get_high_res_preview(self, file_path):
        """Exposes high-res preview generator for RAW photos and media to Lightbox UI."""
        try:
            return get_high_res_preview(file_path)
        except Exception as e:
            print(f"Error generating high-res preview for {file_path}: {e}")
            return None

    def generate_thumbnails_batch(self, file_paths):
        """
        Generates and returns downscaled thumbnails in parallel for a batch of file paths.
        Uses persistent disk cache and thread-safe memory cache for 0ms re-fetch times.
        """
        if not file_paths:
            return {}
        
        results = {}
        from concurrent.futures import ThreadPoolExecutor
        workers = min(32, max(4, (os.cpu_count() or 4) * 2))
        
        with ThreadPoolExecutor(max_workers=workers) as executor:
            future_to_path = {executor.submit(get_cached_thumbnail, path): path for path in file_paths if path}
            for future in future_to_path:
                path = future_to_path[future]
                try:
                    b64 = future.result()
                    if b64:
                        results[path] = b64
                except Exception:
                    pass
        return results

    def load_data(self, mapping_path, root_dir):
        """Synchronous load helper (fallback for simple/legacy CLI triggers)."""
        try:
            self.mapping_path = mapping_path
            self.root_dir = root_dir
            
            sub_events, contributor_series, ordered_contributors = parse_mapping_file(mapping_path)
            self.sub_events = sub_events
            self.contributor_series = contributor_series
            self.ordered_contributors = ordered_contributors
            
            src_dir = get_contributor_dir(root_dir)
                
            contrib_files_dict, conflicts, has_conflict = map_files_to_contributors(
                src_dir, contributor_series, ordered_contributors, self.camera_ranges
            )
            
            files_list = []
            folders_set = []
            
            # Map folders
            for cont, ser in contributor_series.items():
                for se in sub_events:
                    if cont in se['contribs']:
                        parts = [p.strip() for p in se['sub_event_str'].split(' - ')]
                        if len(parts) >= 1 and parts[0]:
                            master_folder = parts[0]
                            leaf_folder = parts[1].rstrip('-').strip() if len(parts) >= 2 else parts[0]
                            fn_ovr = se.get('folder_name', '').strip() if isinstance(se, dict) else ''
                            sub_event_folder = fn_ovr if fn_ovr else (parts[2] if (len(parts) > 2 and parts[2].strip() != "") else None)
                            target_dir = get_target_dir(root_dir, master_folder, leaf_folder, sub_event_folder, cont)
                            
                            rel_target = os.path.relpath(target_dir, root_dir)
                            if rel_target not in folders_set:
                                folders_set.append(rel_target)

            self.folders = folders_set
            
            file_id_counter = 1
            for cont, flist in contrib_files_dict.items():
                assigned_slots = []
                for se in sub_events:
                    if cont in se['contribs']:
                        parts = [p.strip() for p in se['sub_event_str'].split(' - ')]
                        if len(parts) >= 1 and parts[0]:
                            master_folder = parts[0]
                            leaf_folder = parts[1].rstrip('-').strip() if len(parts) >= 2 else parts[0]
                            fn_ovr = se.get('folder_name', '').strip() if isinstance(se, dict) else ''
                            sub_event_folder = fn_ovr if fn_ovr else (parts[2] if (len(parts) > 2 and parts[2].strip() != "") else None)
                            target_dir = get_target_dir(root_dir, master_folder, leaf_folder, sub_event_folder, cont)
                            assigned_slots.append(os.path.relpath(target_dir, root_dir))
                
                groups = group_files_by_indicator(flist)
                
                for idx, gp in enumerate(groups):
                    for f in gp:
                        f_ext = os.path.splitext(f)[1].lower()
                        is_vid = f_ext in VIDEO_EXTENSIONS
                        is_img = f_ext in IMAGE_EXTENSIONS
                        f_type = 'video' if is_vid else ('photo' if is_img else 'other')
                        
                        target_folder_path = get_target_slot_for_file(idx, assigned_slots, is_video=is_vid)
                            
                        if target_folder_path not in self.folders:
                            self.folders.append(target_folder_path)
                            
                        folder_index = self.folders.index(target_folder_path)
                        
                        files_list.append({
                            'id': file_id_counter,
                            'filename': os.path.basename(f),
                            'path': f,
                            'contributor': cont,
                            'folder_index': folder_index,
                            'dont_copy': False,
                            'selected': False,
                            'is_new': False,
                            'is_video': is_vid,
                            'is_photo': is_img,
                            'file_type': f_type,
                            'is_sidecar': f_ext in SIDECAR_EXTENSIONS
                        })
                        file_id_counter += 1
            
            contributors_summary = {}
            for f in files_list:
                c = f['contributor']
                contributors_summary[c] = contributors_summary.get(c, 0) + 1

            return {
                'files': files_list,
                'folders': self.folders,
                'contributors': contributors_summary
            }
        except Exception as e:
            import traceback
            return {'error': str(e) + '\n' + traceback.format_exc()}

    def generate_thumbnail(self, file_path):
        """Exposes the thumbnail Base64 encoder function to the UI."""
        try:
            return get_file_thumbnail_base64(file_path)
        except Exception as e:
            print(f"Error base64 thumbnail generation: {e}")
            return None

    def _send_transfer_progress(self, data):
        """Sends live transfer progress payload to the frontend PyWebView layer."""
        if self._window:
            try:
                payload = json.dumps(json.dumps(data))
                self._window.evaluate_js(f"if(window.updateTransferProgress) window.updateTransferProgress({payload});")
            except Exception as e:
                print("Error sending transfer progress:", e)

    def _send_transfer_complete(self, data):
        """Sends transfer completion payload to the frontend PyWebView layer."""
        if self._window:
            try:
                payload = json.dumps(json.dumps(data))
                self._window.evaluate_js(f"if(window.onTransferComplete) window.onTransferComplete({payload});")
            except Exception as e:
                print("Error sending transfer completion:", e)

    def _send_undo_transfer_progress(self, data):
        """Sends undo transfer progress payload to the frontend PyWebView layer."""
        if self._window:
            try:
                payload = json.dumps(json.dumps(data))
                self._window.evaluate_js(f"if(window.updateUndoTransferProgress) window.updateUndoTransferProgress({payload});")
            except Exception as e:
                print("Error sending undo progress:", e)

    def _send_undo_transfer_complete(self, data):
        """Sends undo transfer completion payload to the frontend PyWebView layer."""
        if self._window:
            try:
                payload = json.dumps(json.dumps(data))
                self._window.evaluate_js(f"if(window.onUndoTransferComplete) window.onUndoTransferComplete({payload});")
            except Exception as e:
                print("Error sending undo completion:", e)

    def execute_transfer(self, action, files, folders):
        """
        Executes physical file transfers asynchronously in a background thread.
        Always moves files directly into target folders (copy option removed).
        Streams live byte-level and file-level progress to the frontend UI.
        """
        action = 'move'
        def _run_transfer():
            try:
                root_dir = self.root_dir or "."
                log_lines = ["=== FILE TRANSFER LOG ===", f"Action: {action.upper()}", ""]
                
                # Pre-calculate total files and size in bytes
                valid_files = []
                total_bytes = 0
                for f in files:
                    folder_idx = f.get('folder_index', -1)
                    if not f.get('dont_copy', False) and 0 <= folder_idx < len(folders):
                        src_path = f.get('path', '')
                        if os.path.exists(src_path):
                            fsize = os.path.getsize(src_path)
                            total_bytes += fsize
                            valid_files.append((f, fsize))
                
                total_file_count = len(valid_files) if valid_files else len(files)
                transferred = []
                mismatches = 0
                matches = 0
                completed_files = 0
                completed_bytes = 0
                start_time = time.time()
                last_update_time = 0
                
                for f in files:
                    folder_idx = f.get('folder_index', -1)
                    intended_folder = folders[folder_idx] if (0 <= folder_idx < len(folders)) else "Unmapped / Excluded"
                    
                    # Skip excluded or invalid files
                    if f.get('dont_copy', False) or folder_idx < 0 or folder_idx >= len(folders):
                        log_lines.append(f"File: {f.get('filename', '')}")
                        log_lines.append(f"  Intended: {intended_folder} (Excluded/Invalid)")
                        log_lines.append(f"  Actual: Not Transferred")
                        log_lines.append("  Status: MATCH")
                        log_lines.append("")
                        matches += 1
                        continue
                    
                    target_folder_rel = folders[folder_idx]
                    src_path = f.get('path', '')
                    filename = f.get('filename', os.path.basename(src_path))
                    ext = os.path.splitext(filename)[1].lower()
                    is_vid = ext in VIDEO_EXTENSIONS or f.get('is_video', False) or f.get('file_type') == 'video'
                    
                    # Safety guard: Ensure video files never land in photo-only folders (H, MQ, MF, TQ)
                    if is_vid and is_photo_only_folder(target_folder_rel):
                        redirected_folder = None
                        for alt_idx in range(folder_idx, len(folders)):
                            if not is_photo_only_folder(folders[alt_idx]):
                                redirected_folder = folders[alt_idx]
                                break
                        if not redirected_folder:
                            for alt_idx in range(folder_idx - 1, -1, -1):
                                if not is_photo_only_folder(folders[alt_idx]):
                                    redirected_folder = folders[alt_idx]
                                    break
                        if redirected_folder:
                            target_folder_rel = redirected_folder

                    target_dir = os.path.join(root_dir, target_folder_rel)
                    dest_path = os.path.join(target_dir, filename)
                    actual_folder_rel = os.path.relpath(target_dir, root_dir)
                    
                    if not os.path.exists(src_path):
                        log_lines.append(f"File: {filename}")
                        log_lines.append(f"  Intended: {intended_folder}")
                        log_lines.append(f"  Actual: Not Transferred (Source File Not Found)")
                        log_lines.append("  Status: MISMATCH")
                        log_lines.append("")
                        mismatches += 1
                        continue
                    
                    status = "MATCH" if intended_folder == actual_folder_rel else "MISMATCH"
                    if status == "MATCH":
                        matches += 1
                    else:
                        mismatches += 1
                    
                    try:
                        os.makedirs(target_dir, exist_ok=True)
                        fsize = os.path.getsize(src_path)
                        
                        def _chunk_cb(chunk_len):
                            nonlocal completed_bytes, last_update_time
                            completed_bytes += chunk_len
                            now = time.time()
                            if now - last_update_time >= 0.12 or completed_bytes >= total_bytes:
                                last_update_time = now
                                elapsed = max(0.05, now - start_time)
                                speed_bps = completed_bytes / elapsed
                                pct = min(100, int((completed_bytes / total_bytes) * 100)) if total_bytes > 0 else min(100, int(((completed_files + 1) / max(1, total_file_count)) * 100))
                                remaining_bytes = max(0, total_bytes - completed_bytes)
                                eta_sec = int(remaining_bytes / speed_bps) if speed_bps > 0 else 0
                                
                                self._send_transfer_progress({
                                    'type': 'progress',
                                    'action': action,
                                    'current_file': filename,
                                    'target_folder': target_folder_rel,
                                    'completed_files': completed_files,
                                    'total_files': total_file_count,
                                    'completed_bytes': completed_bytes,
                                    'total_bytes': total_bytes,
                                    'percent': pct,
                                    'speed_bps': speed_bps,
                                    'eta_sec': eta_sec
                                })

                        # Execute transfer with streaming chunk updates
                        _copy_file_with_chunk_progress(src_path, dest_path, action, on_chunk_bytes=_chunk_cb)
                        transferred.append((src_path, dest_path))
                        completed_files += 1
                        
                        # Final per-file push
                        elapsed = max(0.05, time.time() - start_time)
                        speed_bps = completed_bytes / elapsed
                        pct = min(100, int((completed_bytes / total_bytes) * 100)) if total_bytes > 0 else min(100, int((completed_files / max(1, total_file_count)) * 100))
                        self._send_transfer_progress({
                            'type': 'progress',
                            'action': action,
                            'current_file': filename,
                            'target_folder': target_folder_rel,
                            'completed_files': completed_files,
                            'total_files': total_file_count,
                            'completed_bytes': completed_bytes,
                            'total_bytes': total_bytes,
                            'percent': pct,
                            'speed_bps': speed_bps,
                            'eta_sec': max(0, int((total_bytes - completed_bytes) / speed_bps)) if speed_bps > 0 else 0
                        })
                        
                        log_lines.append(f"File: {filename}")
                        log_lines.append(f"  Intended: {intended_folder}")
                        log_lines.append(f"  Actual: {actual_folder_rel}")
                        log_lines.append(f"  Status: {status}")
                        log_lines.append("")
                    except Exception as file_err:
                        log_lines.append(f"File: {filename}")
                        log_lines.append(f"  Intended: {intended_folder}")
                        log_lines.append(f"  Actual: Error ({str(file_err)})")
                        log_lines.append("  Status: MISMATCH")
                        log_lines.append("")
                        mismatches += 1

                log_lines.append("Summary:")
                log_lines.append(f"  Total Transferred: {len(transferred)}")
                log_lines.append(f"  Total Matches: {matches}")
                log_lines.append(f"  Total Mismatches: {mismatches}")
                
                doc_dir = get_document_dir(root_dir)
                log_path = os.path.join(doc_dir, "transfer_log.txt")
                with open(log_path, 'w', encoding='utf-8') as log_f:
                    log_f.write("\n".join(log_lines))
                    
                if transferred:
                    self.transfer_history.append({
                        'action': action,
                        'transfers': transferred
                    })
                    
                res_data = {
                    'success': True,
                    'count': len(transferred),
                    'can_undo': len(self.transfer_history) > 0,
                    'log_path': log_path,
                    'mismatches': mismatches
                }
                self._send_transfer_complete(res_data)
                try:
                    from backends.feature_logger import note_feature
                    note_feature("Media Sorting Transfer", {
                        "action": action,
                        "transferred_count": len(transferred),
                        "mismatches": mismatches
                    }, category="sorting")
                except Exception:
                    pass
            except Exception as e:
                import traceback
                self._send_transfer_complete({'success': False, 'error': str(e) + '\n' + traceback.format_exc()})

        self._transfer_thread = threading.Thread(target=_run_transfer, daemon=True)
        self._transfer_thread.start()
        return {'started': True}

    def undo_transfer(self):
        """
        Reverts the last file transfer operation asynchronously in a background thread.
        Moves files back to their source locations or deletes copied files.
        """
        def _run_undo():
            try:
                if not self.transfer_history:
                    self._send_undo_transfer_complete({'success': False, 'error': 'No transfer history available to undo.'})
                    return
                    
                last_op = self.transfer_history.pop()
                action = last_op['action']
                transfers = last_op['transfers']
                
                undone_count = 0
                errors = []
                total = len(transfers)
                
                for idx, (src_path, dest_path) in enumerate(reversed(transfers)):
                    filename = os.path.basename(dest_path)
                    percent = min(100, int(((idx + 1) / max(1, total)) * 100))
                    
                    self._send_undo_transfer_progress({
                        'type': 'progress',
                        'current_file': filename,
                        'completed_files': idx + 1,
                        'total_files': total,
                        'percent': percent
                    })
                    
                    if not os.path.exists(dest_path):
                        errors.append(f"Destination file not found: {dest_path}")
                        continue
                    
                    try:
                        if action == 'move':
                            os.makedirs(os.path.dirname(src_path), exist_ok=True)
                            shutil.move(dest_path, src_path)
                            undone_count += 1
                        else: # copy
                            os.remove(dest_path)
                            undone_count += 1
                    except Exception as file_err:
                        errors.append(f"Error reverting {dest_path}: {str(file_err)}")
                
                for _, dest_path in transfers:
                    try:
                        dest_dir = os.path.dirname(dest_path)
                        if os.path.exists(dest_dir) and not os.listdir(dest_dir):
                            os.rmdir(dest_dir)
                    except Exception:
                        pass
                        
                res_data = {
                    'success': True,
                    'count': undone_count,
                    'errors': errors,
                    'can_undo': len(self.transfer_history) > 0
                }
                self._send_undo_transfer_complete(res_data)
            except Exception as e:
                import traceback
                self._send_undo_transfer_complete({'success': False, 'error': str(e) + '\n' + traceback.format_exc()})

        self._undo_thread = threading.Thread(target=_run_undo, daemon=True)
        self._undo_thread.start()
        return {'started': True}

def _copy_file_with_chunk_progress(src_path, dest_path, action, on_chunk_bytes=None, chunk_size=4 * 1024 * 1024):
    """
    Copies or moves a file using a chunk buffer (default 4MB) to stream byte progress.
    """
    os.makedirs(os.path.dirname(dest_path), exist_ok=True)
    if action == 'move':
        try:
            os.rename(src_path, dest_path)
            if on_chunk_bytes:
                on_chunk_bytes(os.path.getsize(dest_path))
            return
        except OSError:
            pass
            
    with open(src_path, 'rb') as fsrc:
        with open(dest_path, 'wb') as fdst:
            while True:
                buf = fsrc.read(chunk_size)
                if not buf:
                    break
                fdst.write(buf)
                if on_chunk_bytes:
                    on_chunk_bytes(len(buf))
                    
    shutil.copystat(src_path, dest_path)
    if action == 'move':
        try:
            os.remove(src_path)
        except Exception:
            pass

def main():
    """Fallback WebView application launcher for testing this module standalone."""
    api = SortingApi()
    script_dir = os.path.dirname(os.path.abspath(__file__))
    html_path = os.path.join(script_dir, 'index.html')
    
    window = webview.create_window(
        title='File Sorter', 
        url=html_path, 
        js_api=api,
        width=1200,
        height=800
    )
    api._window = window
    webview.start()

if __name__ == '__main__':
    main()