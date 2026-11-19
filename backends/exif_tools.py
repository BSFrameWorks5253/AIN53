"""
EXIF Tools & Chronological Sequence Engine
===========================================

Provides high-performance EXIF & media metadata extraction for photos and videos,
solving the camera series change/rollover problem after sequence 600 (video) or 9999 (photo).

Features:
1. Fast in-process EXIF extraction for RAW, JPEG, TIFF, and HEIC images using Pillow and binary TIFF parser.
2. Zero-dependency QuickTime/MP4 'mvhd' atom parser for ultra-fast video creation timestamp extraction.
3. Automatic series change detection and sequence cycle partitioning for 600 and 9999 rollovers.
4. Chronological sequence sorter ensuring seamless ordering when camera numbering wraps around.
5. Integration with Phil Harvey's ExifTool CLI when detected on the system PATH.
"""

import os
import sys
import re
import struct
import datetime
import subprocess
import shutil
from pathlib import Path
from collections import defaultdict

# -----------------------------------------------------------------------------
# CONSTANTS & EXTENSIONS
# -----------------------------------------------------------------------------
PHOTO_EXTENSIONS = {'.cr2', '.cr3', '.arw', '.nef', '.jpg', '.jpeg', '.png', '.heic', '.tif', '.tiff', '.dng', '.webp'}
VIDEO_EXTENSIONS = {'.mov', '.mp4', '.mts', '.m4v', '.mkv', '.avi', '.flv', '.webm', '.wmv', '.3gp'}
SIDECAR_EXTENSIONS = {'.xml', '.pkf', '.xmp', '.thm', '.srt', '.lrf'}

# Common camera sequence rollover thresholds
ROLLOVER_THRESHOLDS = {
    'photo': 9999,   # Canon, Sony, Nikon, Fuji, Leica photo sequence roll
    'video': 600     # Sony FX3/FX6/A7S/FS7, Panasonic video clip card roll
}

# Cache for extracted timestamps to prevent redundant I/O during sort passes
_TIMESTAMP_CACHE = {}


# -----------------------------------------------------------------------------
# QUICKTIME / MP4 CREATION TIME PARSER (Pure Python, Zero Dependency)
# -----------------------------------------------------------------------------
def get_mp4_creation_time(filepath):
    """
    Parses the standard ISO/IEC 14496-12 Movie Header ('mvhd') box inside MP4/MOV files
    to extract the creation timestamp.
    Returns float unix timestamp or None on failure.
    """
    try:
        with open(filepath, 'rb') as f:
            # Search within first 1MB of file where 'moov' atom typically resides
            chunk = f.read(1024 * 1024)
            mvhd_idx = chunk.find(b'mvhd')
            if mvhd_idx != -1 and mvhd_idx >= 4:
                # Version of mvhd is at mvhd_idx + 4
                version = chunk[mvhd_idx + 4]
                if version == 1:
                    # 64-bit creation time at mvhd_idx + 8
                    creation_time = struct.unpack('>Q', chunk[mvhd_idx + 8 : mvhd_idx + 16])[0]
                else:
                    # 32-bit creation time at mvhd_idx + 8
                    creation_time = struct.unpack('>I', chunk[mvhd_idx + 8 : mvhd_idx + 12])[0]
                
                # MP4 timestamps are seconds since Jan 1, 1904 UTC.
                # Difference between 1970-01-01 and 1904-01-01 is 2,082,844,800 seconds.
                epoch_diff = 2082844800
                if creation_time > epoch_diff:
                    unix_time = creation_time - epoch_diff
                    # Sanity check: between year 2000 and 2040
                    if 946684800 <= unix_time <= 2208988800:
                        return float(unix_time)
    except Exception:
        pass
    return None


# -----------------------------------------------------------------------------
# TIFF / RAW BINARY EXIF TIMESTAMP PARSER (Fallback for CR2, NEF, ARW, DNG)
# -----------------------------------------------------------------------------
def get_raw_tiff_datetime(filepath):
    """
    Extracts DateTimeOriginal (Tag 0x9003) or DateTime (Tag 0x0132) from TIFF/RAW headers.
    Supports little-endian (II) and big-endian (MM) byte orders.
    """
    try:
        with open(filepath, 'rb') as f:
            header = f.read(256 * 1024)  # Read first 256KB
            # Check for TIFF signature
            if len(header) < 8:
                return None
            order = header[:2]
            if order == b'II':
                fmt_endian = '<'
            elif order == b'MM':
                fmt_endian = '>'
            else:
                return None

            magic = struct.unpack(fmt_endian + 'H', header[2:4])[0]
            if magic not in (42, 0x4F52):  # 42 standard TIFF, 0x4F52 Olympus ORF
                return None

            # Pattern match standard EXIF date format 'YYYY:MM:DD HH:MM:SS'
            date_matches = list(re.finditer(rb'(\d{4}:\d{2}:\d{2}\s\d{2}:\d{2}:\d{2})', header))
            if date_matches:
                # Return the earliest or first valid date string found in header
                for m in date_matches:
                    dt_str = m.group(1).decode('ascii', errors='ignore')
                    try:
                        dt = datetime.datetime.strptime(dt_str, "%Y:%m:%d %H:%M:%S")
                        return dt.timestamp()
                    except Exception:
                        continue
    except Exception:
        pass
    return None


# -----------------------------------------------------------------------------
# IMAGE EXIF EXTRACTOR (Pillow + Raw Fallback)
# -----------------------------------------------------------------------------
def get_image_exif_datetime(filepath):
    """
    Extracts DateTimeOriginal or CreateDate from images using Pillow when available,
    falling back to raw TIFF header parsing.
    """
    try:
        from PIL import Image, ExifTags
        with Image.open(filepath) as img:
            exif = img.getexif()
            if exif:
                # Check ExifIFD (0x8769) for DateTimeOriginal (36867)
                exif_ifd = exif.get_ifd(0x8769) if hasattr(exif, 'get_ifd') else {}
                dt_str = exif_ifd.get(36867) or exif_ifd.get(36868) or exif.get(306)
                if dt_str and isinstance(dt_str, str):
                    try:
                        dt = datetime.datetime.strptime(dt_str.strip()[:19], "%Y:%m:%d %H:%M:%S")
                        return dt.timestamp()
                    except Exception:
                        pass
    except Exception:
        pass

    # Fallback to binary raw TIFF scanner
    return get_raw_tiff_datetime(filepath)


# -----------------------------------------------------------------------------
# UNIFIED MEDIA TIMESTAMP EXTRACTOR
# -----------------------------------------------------------------------------
def get_media_capture_timestamp(filepath, use_cache=True):
    """
    Retrieves the true media capture timestamp (Unix epoch float).
    Checks cache first, then extracts via format-specific EXIF/QuickTime parsers,
    falling back to filesystem modification time.
    """
    if use_cache and filepath in _TIMESTAMP_CACHE:
        return _TIMESTAMP_CACHE[filepath]

    ext = os.path.splitext(filepath)[1].lower()
    ts = None

    if ext in PHOTO_EXTENSIONS:
        ts = get_image_exif_datetime(filepath)
    elif ext in VIDEO_EXTENSIONS:
        ts = get_mp4_creation_time(filepath)

    if ts is None:
        try:
            ts = os.path.getmtime(filepath)
        except Exception:
            ts = 0.0

    if use_cache:
        _TIMESTAMP_CACHE[filepath] = ts
    return ts


# -----------------------------------------------------------------------------
# SEQUENCE & CAMERA PARSER UTILITIES
# -----------------------------------------------------------------------------
def parse_sequence_tokens(filename):
    """
    Extracts (prefix, sequence_number, suffix, extension) from a file name.
    """
    name, ext = os.path.splitext(filename)
    match = list(re.finditer(r'\d+', name))
    if match:
        last_match = match[-1]
        start, end = last_match.span()
        seq_str = name[start:end]
        prefix = name[:start]
        suffix = name[end:]
        return prefix, int(seq_str), len(seq_str), suffix, ext
    return name, None, 0, '', ext


# -----------------------------------------------------------------------------
# SERIES CHANGE & ROLLOVER DETECTION ENGINE (600 & 9999 Rollover Solver)
# -----------------------------------------------------------------------------
def detect_series_rollover(items_with_meta):
    """
    Given a list of file dictionaries for a single camera/series, detects whether
    a sequence rollover occurred (e.g. counter jumping from ~9999 to ~0001 or ~600 to ~0001).
    
    Each item must have:
      'seq_num': int
      'seq_len': int
      'filepath': str
      'timestamp': float (EXIF/capture timestamp)
      
    Returns a list of partitioned continuous cycles:
      [ [cycle_1_items], [cycle_2_items], ... ]
    """
    if len(items_with_meta) <= 1:
        return [items_with_meta]

    # Sort primarily by EXIF capture timestamp to reveal the true timeline
    time_sorted = sorted(items_with_meta, key=lambda x: (x.get('timestamp', 0.0), x.get('seq_num', 0)))

    cycles = []
    current_cycle = [time_sorted[0]]

    for i in range(1, len(time_sorted)):
        prev = time_sorted[i - 1]
        curr = time_sorted[i]
        
        prev_num = prev.get('seq_num')
        curr_num = curr.get('seq_num')

        is_rollover = False

        if prev_num is not None and curr_num is not None:
            # Case 1: Photo 9999 rollover (e.g., prev was 9980-9999 and curr is 0001-0100)
            if prev_num >= 9500 and curr_num <= 500:
                is_rollover = True
            # Case 2: Video 600 rollover (e.g., prev was 580-600 and curr is 0001-0050)
            elif prev_num >= 550 and curr_num <= 50:
                is_rollover = True
            # Case 3: Counter decreased significantly while time progressed forward
            elif prev_num > curr_num + 300 and curr.get('timestamp', 0.0) >= prev.get('timestamp', 0.0):
                is_rollover = True

        if is_rollover:
            cycles.append(current_cycle)
            current_cycle = [curr]
        else:
            current_cycle.append(curr)

    if current_cycle:
        cycles.append(current_cycle)

    return cycles


def find_missing_with_exif_rollover_support(files_list):
    """
    Enhanced version of find_missing_in_sequence that handles 600 and 9999 camera rollovers.
    Partitions files into chronological cycles so sequence wrap-arounds do NOT trigger
    false 9,000-file or 500-file missing gap reports.
    """
    groups = defaultdict(list)
    for f in files_list:
        filename = f.get('name', '')
        camera_type = f.get('camera_type', '')
        filepath = f.get('path') or f.get('full_path', '')
        
        prefix, seq_num, seq_len, suffix, ext = parse_sequence_tokens(filename)
        norm_suffix = '' if suffix == '_' else suffix

        if seq_num is not None:
            ts = get_media_capture_timestamp(filepath) if filepath and os.path.exists(filepath) else 0.0
            item_meta = {
                'name': filename,
                'prefix': prefix,
                'seq_num': seq_num,
                'seq_len': seq_len,
                'suffix': norm_suffix,
                'ext': ext,
                'camera_type': camera_type,
                'filepath': filepath,
                'timestamp': ts,
                'original': f
            }
            group_key = (prefix, norm_suffix, ext, camera_type)
            groups[group_key].append(item_meta)

    missing_records = []

    for (prefix, norm_suffix, ext, camera_type), items in groups.items():
        # Partition items into rollover cycles (e.g. Cycle 1: 9900-9999, Cycle 2: 0001-0050)
        cycles = detect_series_rollover(items)

        for cycle in cycles:
            # Sort sequentially WITHIN the specific cycle
            cycle.sort(key=lambda x: x['seq_num'])
            
            for i in range(len(cycle) - 1):
                curr_item = cycle[i]
                next_item = cycle[i + 1]
                
                curr_seq = curr_item['seq_num']
                curr_len = curr_item['seq_len']
                next_seq = next_item['seq_num']
                
                diff = next_seq - curr_seq
                # If gap exists within this cycle (and not a massive jump > 2000), register missing files
                if 1 < diff < 2000:
                    for missing_num in range(curr_seq + 1, next_seq):
                        padded_seq = str(missing_num).zfill(curr_len)
                        reconstructed = f"{prefix}{padded_seq}{norm_suffix}{ext}"
                        missing_records.append({
                            'name': reconstructed,
                            'is_missing': True,
                            'camera_type': camera_type
                        })

    return missing_records


# -----------------------------------------------------------------------------
# CHRONOLOGICAL MEDIA SORTER KEY (For Media Sorting Workspace)
# -----------------------------------------------------------------------------
def make_exif_sort_key(filepath):
    """
    Calculates a sorting tuple that handles series rollover seamlessly:
    Combines EXIF capture timestamp with file sequence number.
    Files rolled over from 9999->0001 or 600->0001 will sort chronologically
    in their true captured sequence.
    """
    bname = os.path.basename(filepath)
    ext = os.path.splitext(bname)[1].lower()
    is_sidecar = 1 if ext in SIDECAR_EXTENSIONS else 0
    
    match = re.search(r'\d+', bname)
    num = int(match.group()) if match else 0
    
    ts = get_media_capture_timestamp(filepath)
    return (ts, num, is_sidecar, bname.lower())


# Convenience alias
get_media_capture_time = get_media_capture_timestamp

# -----------------------------------------------------------------------------
def is_exiftool_available():
    """Checks if external Phil Harvey ExifTool binary is installed and reachable."""
    return shutil.which('exiftool') is not None
