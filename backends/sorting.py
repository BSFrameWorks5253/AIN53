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
    '.m4v', '.mpg', '.mpeg', '.m2ts', '.mts', '.ts', '.3gp', '.dv'
)

# Metadata files that must remain co-located with their parent media.
# These files are processed but omitted from UI grid renderers.
SIDECAR_EXTENSIONS = (
    '.xml', '.xmp', '.pkf', '.srt', '.thm', '.aae', '.lrv',
    '.json', '.ini', '.log', '.txt'
)


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
            if (extrema[1] - extrema[0]) < std_dev_threshold:
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
                            if (extrema[1] - extrema[0]) < std_dev_threshold:
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
def parse_mapping_file(file_path):
    """
    Parses the template CSV mapping to match event groups with contributor cameras.
    """
    sub_event_contributors = []
    contributor_series = {}
    
    with open(file_path, 'r', encoding='utf-8-sig') as f:
        reader = csv.reader(f)
        # Read the header row to dynamically locate columns
        headers = next(reader)
        headers_lower = [h.strip().lower() for h in headers]
        
        # Locate positions of name and series columns
        name_col = None
        series_col = None
        for i, h in enumerate(headers_lower):
            if "contributor" in h and "name" in h:
                name_col = i
            elif "contributor" in h and "series" in h:
                series_col = i
        
        # Locate contributor columns (Contributors 1, Contributors 2, etc.)
        contrib_cols = []
        for i, h in enumerate(headers_lower):
            if h.startswith("contributors") and "name" not in h and "series" not in h:
                contrib_cols.append(i)
        
        # Fallback to column indices 1 and 2 if headers are missing
        if not contrib_cols:
            contrib_cols = [1, 2]
        
        for row in reader:
            if not row:
                continue
            
            sub_event_str = row[0].strip() if len(row) > 0 else ""
            if not sub_event_str:
                continue
            
            contribs = []
            for ci in contrib_cols:
                if len(row) > ci and row[ci].strip():
                    contribs.append(row[ci].strip())
            
            # Map contributor name to their file prefix series
            if name_col is not None and series_col is not None:
                cont_name = row[name_col].strip() if len(row) > name_col else ""
                cont_series = row[series_col].strip() if len(row) > series_col else ""
                
                if cont_name and cont_series:
                    contributor_series[cont_name] = cont_series
            
            sub_event_contributors.append({
                'sub_event_str': sub_event_str,
                'contribs': contribs
            })
            
    return sub_event_contributors, contributor_series


def map_contributors_to_folders(src_dir, contributor_series):
    """
    Scans the source directory for "Cam XX" sub-directories and maps them
    to contributors based on filename prefixes.
    """
    # Locate all sub-directories starting with "cam"
    cam_folders = []
    if os.path.isdir(src_dir):
        for entry in os.listdir(src_dir):
            full_path = os.path.join(src_dir, entry)
            if os.path.isdir(full_path) and entry.lower().startswith('cam'):
                cam_folders.append(entry)
    cam_folders.sort()
    
    contributor_camera = {}
    if not cam_folders:
        return contributor_camera
        
    # Count matching file prefix occurrences for each camera folder
    cam_match_counts = {}
    for cam in cam_folders:
        cam_dir = os.path.join(src_dir, cam)
        counts = {ser: 0 for ser in contributor_series.values()}
        for root, dirs, files in os.walk(cam_dir):
            for f in files:
                if f.startswith('.') or f.lower() == 'thumbs.db':
                    continue
                for ser in contributor_series.values():
                    if f.startswith(ser):
                        counts[ser] += 1
        cam_match_counts[cam] = counts
        
    unassigned_cams = list(cam_folders)
    
    # Sort contributors by prefix length descending to match specific tags first
    sorted_conts = sorted(contributor_series.keys(), key=lambda c: len(contributor_series[c]), reverse=True)
    
    for cont in sorted_conts:
        ser = contributor_series[cont]
        best_cam = None
        max_count = 0
        for cam in unassigned_cams:
            count = cam_match_counts[cam][ser]
            if count > max_count:
                max_count = count
                best_cam = cam
                
        if best_cam:
            contributor_camera[cont] = best_cam
            unassigned_cams.remove(best_cam)
        else:
            # Fallback: assign the first available camera folder
            if unassigned_cams:
                best_cam = unassigned_cams.pop(0)
                contributor_camera[cont] = best_cam
                
    return contributor_camera


# ==============================================================================
# FILE DISCOVERY & SORT KEY BUILDERS
# ==============================================================================
def get_contributor_files_from_folder(src_dir, cam_folder):
    """
    Crawls a contributor camera folder and returns its files sorted numerically.
    """
    contrib_files = []
    cam_dir = os.path.join(src_dir, cam_folder)
    if os.path.isdir(cam_dir):
        for root, dirs, files in os.walk(cam_dir):
            for f in files:
                if f.startswith('.') or f.lower() == 'thumbs.db':
                    continue
                contrib_files.append(os.path.join(root, f))
                
    def sort_key(filepath):
        filename = os.path.splitext(os.path.basename(filepath))[0]
        ext = os.path.splitext(filepath)[1].lower()
        is_sidecar = 1 if ext in SIDECAR_EXTENSIONS else 0
        match = re.search(r'\d+', filename)
        num = int(match.group()) if match else 0
        return (num, is_sidecar, filename)

    contrib_files.sort(key=sort_key)
    return contrib_files


def get_contributor_files_by_prefix(src_dir, series_prefix):
    """
    Alternative loader: Walks source folder to find files matching a name prefix.
    """
    contrib_files = []
    for root, dirs, files in os.walk(src_dir):
        for f in files:
            if f.startswith('.') or f.lower() == 'thumbs.db':
                continue
            if f.startswith(series_prefix):
                contrib_files.append(os.path.join(root, f))
                
    def sort_key(filepath):
        filename = os.path.splitext(os.path.basename(filepath))[0]
        ext = os.path.splitext(filepath)[1].lower()
        is_sidecar = 1 if ext in SIDECAR_EXTENSIONS else 0
        match = re.search(r'\d+', filename)
        num = int(match.group()) if match else 0
        return (num, is_sidecar, filename)

    contrib_files.sort(key=sort_key)
    return contrib_files


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

    def scan_files(self, mapping_path, root_dir):
        """
        Phase 1: Quick Scan. Parses the CSV and counts total files per contributor
        to display on the loading screen before running heavy analysis.
        """
        try:
            self.mapping_path = mapping_path
            self.root_dir = root_dir

            sub_events, contributor_series = parse_mapping_file(mapping_path)
            self.sub_events = sub_events
            self.contributor_series = contributor_series

            # Check if there is a dedicated "contributor" subdirectory
            src_dir = None
            for entry in os.listdir(root_dir):
                full_path = os.path.join(root_dir, entry)
                if os.path.isdir(full_path) and entry.lower() == "contributor":
                    src_dir = full_path
                    break
            if not src_dir:
                src_dir = root_dir

            contributor_camera = map_contributors_to_folders(src_dir, contributor_series)

            # Sum total counts of media files
            total_photos = 0
            total_videos = 0
            total_other = 0
            all_contrib_file_lists = []

            for cont, ser in contributor_series.items():
                if cont in contributor_camera:
                    contrib_files = get_contributor_files_from_folder(src_dir, contributor_camera[cont])
                else:
                    contrib_files = get_contributor_files_by_prefix(src_dir, ser)

                for f in contrib_files:
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
                    'files': contrib_files
                })

            # Cache the files list for Phase 2 (start_analysis)
            self._cached_scan = {
                'src_dir': src_dir,
                'contributor_camera': contributor_camera,
                'all_contrib_file_lists': all_contrib_file_lists
            }

            return {
                'total_files': total_photos + total_videos + total_other,
                'total_photos': total_photos,
                'total_videos': total_videos,
                'total_other': total_other,
                'contributors': list(contributor_series.keys())
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
                        if idx < len(assigned_slots):
                            target_folder_path = assigned_slots[idx]
                        else:
                            target_folder_path = "Unmapped - Exceeds Limit"

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
            
            sub_events, contributor_series = parse_mapping_file(mapping_path)
            self.sub_events = sub_events
            self.contributor_series = contributor_series
            
            src_dir = None
            for entry in os.listdir(root_dir):
                full_path = os.path.join(root_dir, entry)
                if os.path.isdir(full_path) and entry.lower() == "contributor":
                    src_dir = full_path
                    break
            if not src_dir:
                src_dir = root_dir
                
            contributor_camera = map_contributors_to_folders(src_dir, contributor_series)
            
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
            for cont, ser in contributor_series.items():
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
                
                if cont in contributor_camera:
                    contrib_files = get_contributor_files_from_folder(src_dir, contributor_camera[cont])
                else:
                    contrib_files = get_contributor_files_by_prefix(src_dir, ser)
                groups = group_files_by_indicator(contrib_files)
                
                for idx, gp in enumerate(groups):
                    if idx < len(assigned_slots):
                        target_folder_path = assigned_slots[idx]
                    else:
                        target_folder_path = "Unmapped - Exceeds Limit"
                        
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

    def execute_transfer(self, action, files, folders):
        """
        Executes physical file transfers (copy or move) based on mapping results.
        Creates a detailed transfer log file 'transfer_log.txt' in the root directory.
        Allows undoing operations.
        """
        try:
            log_lines = []
            log_lines.append("=== FILE TRANSFER LOG ===")
            log_lines.append(f"Action: {action.upper()}")
            log_lines.append("")
            
            transferred = []
            mismatches = 0
            matches = 0
            
            for f in files:
                folder_idx = f.get('folder_index', -1)
                if folder_idx >= 0 and folder_idx < len(folders):
                    intended_folder = folders[folder_idx]
                else:
                    intended_folder = "Unmapped / Excluded"
                
                # Skip files marked as excluded in the UI
                if f.get('dont_copy', False):
                    log_lines.append(f"File: {f['filename']}")
                    log_lines.append(f"  Intended: {intended_folder} (Excluded)")
                    log_lines.append(f"  Actual: Not Transferred (Excluded)")
                    log_lines.append("  Status: MATCH")
                    log_lines.append("")
                    matches += 1
                    continue
                
                # Skip invalid mapping slots
                if folder_idx < 0 or folder_idx >= len(folders):
                    log_lines.append(f"File: {f['filename']}")
                    log_lines.append(f"  Intended: {intended_folder}")
                    log_lines.append(f"  Actual: Not Transferred (Invalid Folder Index)")
                    log_lines.append("  Status: MATCH")
                    log_lines.append("")
                    matches += 1
                    continue
                
                target_folder_rel = folders[folder_idx]
                target_dir = os.path.join(self.root_dir, target_folder_rel)
                
                src_path = f['path']
                dest_path = os.path.join(target_dir, f['filename'])
                
                actual_folder_rel = os.path.relpath(target_dir, self.root_dir)
                
                if not os.path.exists(src_path):
                    log_lines.append(f"File: {f['filename']}")
                    log_lines.append(f"  Intended: {intended_folder}")
                    log_lines.append(f"  Actual: Not Transferred (Source File Not Found)")
                    log_lines.append("  Status: MISMATCH")
                    log_lines.append("")
                    mismatches += 1
                    continue
                
                # Check for discrepancy warnings
                status = "MATCH" if intended_folder == actual_folder_rel else "MISMATCH"
                if status == "MATCH":
                    matches += 1
                else:
                    mismatches += 1
                
                try:
                    os.makedirs(target_dir, exist_ok=True)
                    if action == 'move':
                        shutil.move(src_path, dest_path)
                    else: # copy
                        shutil.copy2(src_path, dest_path)
                    # Add to transaction history
                    transferred.append((src_path, dest_path))
                    
                    log_lines.append(f"File: {f['filename']}")
                    log_lines.append(f"  Intended: {intended_folder}")
                    log_lines.append(f"  Actual: {actual_folder_rel}")
                    log_lines.append(f"  Status: {status}")
                    log_lines.append("")
                except Exception as file_err:
                    log_lines.append(f"File: {f['filename']}")
                    log_lines.append(f"  Intended: {intended_folder}")
                    log_lines.append(f"  Actual: Error ({str(file_err)})")
                    log_lines.append("  Status: MISMATCH")
                    log_lines.append("")
                    mismatches += 1
            
            log_lines.append(f"Summary:")
            log_lines.append(f"  Total Transferred: {len(transferred)}")
            log_lines.append(f"  Total Matches: {matches}")
            log_lines.append(f"  Total Mismatches: {mismatches}")
            
            # Save the execution log in the root directory
            log_path = os.path.join(self.root_dir, "transfer_log.txt")
            with open(log_path, 'w', encoding='utf-8') as log_f:
                log_f.write("\n".join(log_lines))
                
            if transferred:
                self.transfer_history.append({
                    'action': action,
                    'transfers': transferred
                })
                
            return {
                'success': True,
                'count': len(transferred),
                'can_undo': len(self.transfer_history) > 0,
                'log_path': log_path,
                'mismatches': mismatches
            }
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def undo_transfer(self):
        """
        Reverts the last file transfer operation using the transfer history log.
        Moves files back to their source locations or deletes copied files,
        and cleans up any empty directories.
        """
        try:
            if not self.transfer_history:
                return {'success': False, 'error': 'No transfer history available to undo.'}
                
            last_op = self.transfer_history.pop()
            action = last_op['action']
            transfers = last_op['transfers']
            
            undone_count = 0
            errors = []
            
            # Revert operations in reverse chronological order
            for src_path, dest_path in reversed(transfers):
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
                    
            # Clean up target directories if they were left empty
            for _, dest_path in transfers:
                try:
                    dest_dir = os.path.dirname(dest_path)
                    if os.path.exists(dest_dir) and not os.listdir(dest_dir):
                        os.rmdir(dest_dir)
                except Exception:
                    pass
                    
            return {
                'success': True,
                'count': undone_count,
                'errors': errors,
                'can_undo': len(self.transfer_history) > 0
            }
        except Exception as e:
            return {'success': False, 'error': str(e)}

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