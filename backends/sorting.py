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

# Photo-only folder suffixes (MQ, H, MF, TQ) that cannot contain video files
PHOTO_ONLY_SUFFIX_REGEX = re.compile(r'(?:^|[\s\-_/])(MQ|H|MF|TQ)(?:[\s\-_/.]|$)', re.IGNORECASE)

def is_photo_only_folder(folder_path):
    if not folder_path:
        return False
    return bool(PHOTO_ONLY_SUFFIX_REGEX.search(folder_path))

def get_target_slot_for_group(idx, assigned_slots, has_video=False):
    if idx >= len(assigned_slots):
        return "Unmapped - Exceeds Limit"
    
    target_slot = assigned_slots[idx]
    if has_video and is_photo_only_folder(target_slot):
        # Search forward for first non-photo-only slot
        found_slot = None
        for s_idx in range(idx, len(assigned_slots)):
            if not is_photo_only_folder(assigned_slots[s_idx]):
                found_slot = assigned_slots[s_idx]
                break
        if found_slot is None:
            # Search backward if no forward slot found
            for s_idx in range(idx - 1, -1, -1):
                if not is_photo_only_folder(assigned_slots[s_idx]):
                    found_slot = assigned_slots[s_idx]
                    break
        if found_slot is not None:
            target_slot = found_slot

    return target_slot


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
                data = f.read(15 * 1024 * 1024)
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


def is_video_marker(file_path, std_dev_threshold=25.0):
    """
    Detects if a video is a separator marker.
    Extracts frame with multi-stage fallback and checks standard deviation.
    """
    try:
        cap = cv2.VideoCapture(file_path)
        if not cap.isOpened():
            return False

        success, frame = cap.read()
        if not success or frame is None or frame.size == 0:
            cap.set(cv2.CAP_PROP_POS_MSEC, 500)
            success, frame = cap.read()

        if not success or frame is None or frame.size == 0:
            cap.set(cv2.CAP_PROP_POS_FRAMES, 5)
            success, frame = cap.read()

        cap.release()

        if not success or frame is None or frame.size == 0:
            return False

        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        if gray.shape[0] > 300 or gray.shape[1] > 300:
            gray = cv2.resize(gray, (150, 150), interpolation=cv2.INTER_NEAREST)
        _, std_dev = cv2.meanStdDev(gray)
        return float(std_dev[0][0]) < std_dev_threshold
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
            if not sub_event_str:
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
                'contribs': contribs
            })
            
    return sub_event_contributors, contributor_series, ordered_contributors


def parse_file_number(filename):
    """
    Extracts numeric value from filename for sequential range comparison.
    E.g. 'C0042.MP4' -> 42, 'DSC_0150.JPG' -> 150.
    """
    stem = os.path.splitext(filename)[0]
    matches = re.findall(r'\d+', stem)
    if matches:
        return int(matches[-1])
    return None


def is_file_in_range(filepath, start_filename, end_filename):
    """
    Checks if a file falls within [start_filename, end_filename] range inclusively.
    """
    if not start_filename or not end_filename:
        return True
    filename = os.path.basename(filepath)
    file_num = parse_file_number(filename)
    start_num = parse_file_number(start_filename)
    end_num = parse_file_number(end_filename)
    
    if file_num is not None and start_num is not None and end_num is not None:
        return start_num <= file_num <= end_num
    else:
        return start_filename.lower() <= filename.lower() <= end_filename.lower()


def map_files_to_contributors(src_dir, contributor_series, ordered_contributors, camera_ranges=None):
    """
    Scans src_dir (files can be in any subfolder or root).
    Maps files to contributors based on contributor_series prefix.
    If multiple contributors share the same series prefix, detects same-series conflict
    and applies camera_ranges if provided.
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
        filename = os.path.splitext(os.path.basename(filepath))[0]
        ext = os.path.splitext(filepath)[1].lower()
        is_sidecar = 1 if ext in SIDECAR_EXTENSIONS else 0
        match = re.search(r'\d+', filename)
        num = int(match.group()) if match else 0
        return (num, is_sidecar, filename)

    all_files.sort(key=sort_key)

    series_to_conts = {}
    for cont, ser in contributor_series.items():
        ser_clean = ser.strip()
        if ser_clean:
            if ser_clean not in series_to_conts:
                series_to_conts[ser_clean] = []
            series_to_conts[ser_clean].append(cont)

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
            matching_files = [f for f in all_files if os.path.basename(f).lower().startswith(ser.lower())]
            if matching_files:
                cam_list = []
                
                # Check for folder-wise subdirectories matching the series
                sub_matches = []
                for sf_name in sorted(subfolder_files.keys()):
                    s_files = [f for f in subfolder_files[sf_name] if os.path.basename(f).lower().startswith(ser.lower())]
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
                            'file_count': len(s_files)
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
                            'file_count': len(chunk)
                        })

                conflicts.append({
                    'series': ser,
                    'cams': cam_list
                })

    has_conflict = len(conflicts) > 0

    contrib_files_dict = {cont: [] for cont in contributor_series.keys()}
    for cont in ordered_contributors:
        if cont not in contrib_files_dict:
            contrib_files_dict[cont] = []

    unassigned_files = []

    for f in all_files:
        bname = os.path.basename(f)
        assigned = False

        sorted_conts = sorted(contributor_series.keys(), key=lambda c: len(contributor_series[c]), reverse=True)

        for cont in sorted_conts:
            ser = contributor_series[cont]
            if ser and bname.lower().startswith(ser.lower()):
                cam_range = camera_ranges.get(cont)
                if not cam_range:
                    for k, r in camera_ranges.items():
                        if cont in k or k in cont:
                            cam_range = r
                            break
                if cam_range:
                    start_f = cam_range.get('start')
                    end_f = cam_range.get('end')
                    if is_file_in_range(f, start_f, end_f):
                        contrib_files_dict[cont].append(f)
                        assigned = True
                        break
                else:
                    contrib_files_dict[cont].append(f)
                    assigned = True
                    break

        if not assigned:
            rel = os.path.relpath(f, src_dir)
            parts = rel.split(os.sep)
            if len(parts) > 1 and parts[0].lower().startswith('cam'):
                cam_name = parts[0]
                match = re.search(r'\d+', cam_name)
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
    root_basename = os.path.basename(os.path.normpath(root_dir))
    if root_basename == master_folder:
        base = root_dir
    else:
        candidate = os.path.join(root_dir, master_folder)
        if os.path.isdir(candidate):
            base = candidate
        else:
            base = os.path.join(root_dir, master_folder)
            
    if sub_event_folder:
        return os.path.join(base, leaf_folder, sub_event_folder, cont)
    else:
        return os.path.join(base, leaf_folder, cont)


# ==============================================================================
# ASYNCHRONOUS THUMBNAIL DECODING ENGINE
# ==============================================================================
def get_file_thumbnail_base64(file_path):
    """
    Generates downscaled JPEG thumbnails and returns them as Base64 strings.
    Handles standard images, Canon RAW files (CR2/CR3), and video keyframes.
    """
    if not os.path.exists(file_path):
        return None
        
    ext = os.path.splitext(file_path)[1].lower()
    if ext in SIDECAR_EXTENSIONS:
        return None
    
    # 1. Video files: Extract keyframe with fallback seeking.
    video_exts = ('.mp4', '.mov', '.avi', '.mkv', '.m4v', '.mts', '.m2ts', '.wmv', '.webm', '.3gp', '.flv')
    if ext in video_exts:
        try:
            import cv2
            cap = cv2.VideoCapture(file_path)
            success = False
            frame = None
            
            # Stage 1: Try reading frame 0
            if cap.isOpened():
                success, frame = cap.read()
                
            # Stage 2: Fallback seek to 500ms if frame 0 failed or was empty
            if not success or frame is None or frame.size == 0:
                if cap.isOpened():
                    cap.set(cv2.CAP_PROP_POS_MSEC, 500)
                    success, frame = cap.read()
                    
            # Stage 3: Fallback seek to frame index 5/10 if still failing
            if not success or frame is None or frame.size == 0:
                if cap.isOpened():
                    cap.set(cv2.CAP_PROP_POS_FRAMES, 5)
                    success, frame = cap.read()
                    
            cap.release()
            
            if success and frame is not None and frame.size > 0:
                frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                img = Image.fromarray(frame_rgb)
                img.thumbnail((480, 270))
                buffered = io.BytesIO()
                img.save(buffered, format="JPEG")
                return f"data:image/jpeg;base64,{base64.b64encode(buffered.getvalue()).decode('utf-8')}"
        except Exception as e:
            print(f"Error extracting video frame for {file_path}: {e}")
            
    # 2. Canon RAW files (CR2/CR3): Locate embedded preview JPEGs.
    # Scans the file binary for the JPEG Start-Of-Image (SOI) marker \xff\xd8\xff.
    elif ext in ('.cr3', '.cr2'):
        try:
            with open(file_path, 'rb') as f:
                # Read the first 15MB which typically contains the preview payloads.
                data = f.read(15 * 1024 * 1024)
            
            pos = 0
            found_images = []
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
                # Sort previews by resolution and use the largest one.
                found_images.sort(key=lambda img: img.size[0] * img.size[1], reverse=True)
                img = found_images[0]
                img.thumbnail((480, 270))
                buffered = io.BytesIO()
                img.save(buffered, format="JPEG")
                return f"data:image/jpeg;base64,{base64.b64encode(buffered.getvalue()).decode('utf-8')}"
        except Exception as e:
            print(f"Error extracting raw preview: {e}")
            
    # 3. Standard image files: Open directly and downscale.
    try:
        img = Image.open(file_path)
        img.thumbnail((480, 270))
        buffered = io.BytesIO()
        img.save(buffered, format="JPEG")
        return f"data:image/jpeg;base64,{base64.b64encode(buffered.getvalue()).decode('utf-8')}"
    except Exception as e:
        print(f"Error loading standard image: {e}")
        
    return None


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
        if path: 
            if not os.path.isfile(path) or not path.lower().endswith('.csv'):
                if self._window:
                    self._window.evaluate_js("window.showToast('Please select/drop a valid CSV file (.csv).', true)")
                return None
            return path
        result = self._window.create_file_dialog(
            webview.FileDialog.OPEN,
            allow_multiple=False,
            file_types=('CSV Files (*.csv)',)
        )
        return result[0] if result else None
        
    def select_root_dir(self, path=None):
        """Displays folder selection dialog to set the target working directory."""
        if path: 
            if not os.path.isdir(path):
                if self._window:
                    self._window.evaluate_js("window.showToast('Please select/drop a valid folder/directory.', true)")
                return None
            return path
        result = self._window.create_file_dialog(
            webview.FileDialog.FOLDER
        )
        return result[0] if result else None

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
            src_dir = root_dir
            if os.path.isdir(root_dir):
                for entry in os.listdir(root_dir):
                    full_path = os.path.join(root_dir, entry)
                    if os.path.isdir(full_path) and entry.lower() == "contributor":
                        src_dir = full_path
                        break
            if not src_dir:
                src_dir = root_dir

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

            # Check if there is a dedicated "contributor" subdirectory
            src_dir = None
            if os.path.isdir(root_dir):
                for entry in os.listdir(root_dir):
                    full_path = os.path.join(root_dir, entry)
                    if os.path.isdir(full_path) and entry.lower() == "contributor":
                        src_dir = full_path
                        break
            if not src_dir:
                src_dir = root_dir

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
        Phase 2: Full Analysis. Runs covered-lens marker detection in a separate
        background thread to keep the GUI responsive.
        """
        def _run_analysis():
            try:
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
                            if len(parts) >= 2:
                                master_folder = parts[0]
                                leaf_folder = parts[1].rstrip('-').strip()
                                sub_event_folder = parts[2] if (len(parts) > 2 and parts[2].strip() != "") else None
                                target_dir = get_target_dir(root_dir, master_folder, leaf_folder, sub_event_folder, cont)
                                rel_target = os.path.relpath(target_dir, root_dir)
                                if rel_target not in folders_set:
                                    folders_set.append(rel_target)

                self.folders = folders_set

                files_list = []
                file_id_counter = 1
                analysed_count = 0
                photos_analysed = 0
                videos_analysed = 0
                markers_found = 0

                # Count media files that require marker analysis
                total_media = 0
                for cdata in scan['all_contrib_file_lists']:
                    for f in cdata['files']:
                        ext = os.path.splitext(f)[1].lower()
                        if ext in IMAGE_EXTENSIONS or ext in VIDEO_EXTENSIONS:
                            total_media += 1

                for cdata in scan['all_contrib_file_lists']:
                    cont = cdata['contributor']
                    contrib_files = cdata['files']

                    assigned_slots = []
                    for se in sub_events:
                        if cont in se['contribs']:
                            parts = [p.strip() for p in se['sub_event_str'].split(' - ')]
                            if len(parts) >= 2:
                                master_folder = parts[0]
                                leaf_folder = parts[1].rstrip('-').strip()
                                sub_event_folder = parts[2] if (len(parts) > 2 and parts[2].strip() != "") else None
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

                        is_marker = False
                        file_type = 'other'

                        if ext in IMAGE_EXTENSIONS:
                            file_type = 'photo'
                            is_marker = is_image_marker(f, std_dev_threshold=25.0)
                            photos_analysed += 1
                            analysed_count += 1
                        elif ext in VIDEO_EXTENSIONS:
                            file_type = 'video'
                            is_marker = is_video_marker(f, std_dev_threshold=25.0)
                            videos_analysed += 1
                            analysed_count += 1

                        if is_marker:
                            markers_found += 1

                        # Send progress updates back to the UI.
                        # Throttle updates to prevent UI lags.
                        if analysed_count % 5 == 0 or analysed_count == total_media or is_marker:
                            self._send_progress({
                                'type': 'progress',
                                'current': analysed_count,
                                'total': total_media,
                                'photos_analysed': photos_analysed,
                                'videos_analysed': videos_analysed,
                                'markers_found': markers_found,
                                'current_file': os.path.basename(f),
                                'current_contributor': cont,
                                'file_type': file_type,
                                'is_marker': is_marker
                            })

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
                        has_vid = any(os.path.splitext(f)[1].lower() in VIDEO_EXTENSIONS for f in gp)
                        target_folder_path = get_target_slot_for_group(idx, assigned_slots, has_video=has_vid)

                        if target_folder_path not in self.folders:
                            self.folders.append(target_folder_path)

                        folder_index = self.folders.index(target_folder_path)

                        for f in gp:
                            f_ext = os.path.splitext(f)[1].lower()
                            is_vid = f_ext in VIDEO_EXTENSIONS
                            is_img = f_ext in IMAGE_EXTENSIONS
                            f_type = 'video' if is_vid else ('photo' if is_img else 'other')
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

                # Send final results and completion status to the frontend
                result = {
                    'files': files_list,
                    'folders': self.folders,
                    'contributors': contributors_summary
                }
                result_payload = json.dumps(json.dumps(result))
                self._window.evaluate_js(f"onAnalysisComplete({result_payload})")

            except Exception as e:
                import traceback
                err = str(e) + '\n' + traceback.format_exc()
                err_payload = json.dumps(json.dumps({'error': err}))
                self._window.evaluate_js(f"onAnalysisComplete({err_payload})")

        # Launch background thread
        self._analysis_thread = threading.Thread(target=_run_analysis, daemon=True)
        self._analysis_thread.start()
        return {'started': True}

    def load_data(self, mapping_path, root_dir):
        """Synchronous load helper (fallback for simple/legacy CLI triggers)."""
        try:
            self.mapping_path = mapping_path
            self.root_dir = root_dir
            
            sub_events, contributor_series, ordered_contributors = parse_mapping_file(mapping_path)
            self.sub_events = sub_events
            self.contributor_series = contributor_series
            self.ordered_contributors = ordered_contributors
            
            src_dir = None
            if os.path.isdir(root_dir):
                for entry in os.listdir(root_dir):
                    full_path = os.path.join(root_dir, entry)
                    if os.path.isdir(full_path) and entry.lower() == "contributor":
                        src_dir = full_path
                        break
            if not src_dir:
                src_dir = root_dir
                
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
                        if len(parts) >= 2:
                            master_folder = parts[0]
                            leaf_folder = parts[1].rstrip('-').strip()
                            sub_event_folder = parts[2] if (len(parts) > 2 and parts[2].strip() != "") else None
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
                        if len(parts) >= 2:
                            master_folder = parts[0]
                            leaf_folder = parts[1].rstrip('-').strip()
                            sub_event_folder = parts[2] if (len(parts) > 2 and parts[2].strip() != "") else None
                            target_dir = get_target_dir(root_dir, master_folder, leaf_folder, sub_event_folder, cont)
                            assigned_slots.append(os.path.relpath(target_dir, root_dir))
                
                groups = group_files_by_indicator(flist)
                
                for idx, gp in enumerate(groups):
                    has_vid = any(os.path.splitext(f)[1].lower() in VIDEO_EXTENSIONS for f in gp)
                    target_folder_path = get_target_slot_for_group(idx, assigned_slots, has_video=has_vid)
                        
                    if target_folder_path not in self.folders:
                        self.folders.append(target_folder_path)
                        
                    folder_index = self.folders.index(target_folder_path)
                    
                    for f in gp:
                        f_ext = os.path.splitext(f)[1].lower()
                        files_list.append({
                            'id': file_id_counter,
                            'filename': os.path.basename(f),
                            'path': f,
                            'contributor': cont,
                            'folder_index': folder_index,
                            'dont_copy': False,
                            'selected': False,
                            'is_new': False,
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
        Executes physical file transfers (copy or move) asynchronously in a background thread.
        Streams live byte-level and file-level progress to the frontend UI.
        """
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
                    target_dir = os.path.join(root_dir, target_folder_rel)
                    src_path = f.get('path', '')
                    filename = f.get('filename', os.path.basename(src_path))
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
                
                log_path = os.path.join(root_dir, "transfer_log.txt")
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