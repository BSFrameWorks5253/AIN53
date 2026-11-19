"""
Background Feature Noting & Audit Telemetry Logger
===================================================

Tracks, records, and persists feature additions, execution milestones,
and operational telemetry with precise date-time stamps in the background.

Features:
- Persistent JSONL ledger ('feature_notes.jsonl') and JSON summary ('feature_history.json').
- Automatically timestamps every feature added, initialized, or invoked.
- Thread-safe background logging without impacting UI responsiveness.
- Exposes direct hooks for Python backend modules and frontend JS RPC bridge.
"""

import os
import sys
import json
import time
import datetime
import threading
from pathlib import Path

# Log directory resolution: next to executable or local appdata
_LOG_LOCK = threading.Lock()

def _get_feature_log_dir() -> Path:
    base = Path(__file__).resolve().parent.parent
    candidate = base / "logs"
    try:
        candidate.mkdir(parents=True, exist_ok=True)
        return candidate
    except Exception:
        pass
    
    # Fallback to user data directory
    if sys.platform == 'win32':
        appdata = os.environ.get("LOCALAPPDATA", os.path.expanduser("~\\AppData\\Local"))
        fallback = Path(appdata) / "AIN53 Data Management" / "logs"
    else:
        fallback = Path.home() / ".ain53" / "logs"
    try:
        fallback.mkdir(parents=True, exist_ok=True)
        return fallback
    except Exception:
        return base


def note_feature(feature_name: str, details: dict = None, category: str = "general", edition: str = "Standard") -> dict:
    """
    Notes a feature in the background with a high-resolution date-time stamp.
    Appends entry to 'feature_notes.jsonl'.
    """
    now = datetime.datetime.now()
    entry = {
        "timestamp_iso": now.isoformat(),
        "datetime": now.strftime("%Y-%m-%d %H:%M:%S"),
        "unix_epoch": time.time(),
        "feature": str(feature_name).strip(),
        "category": str(category).strip(),
        "edition": str(edition).strip(),
        "details": details or {}
    }

    def _write_async(record):
        with _LOG_LOCK:
            try:
                log_dir = _get_feature_log_dir()
                jsonl_file = log_dir / "feature_notes.jsonl"
                with open(jsonl_file, "a", encoding="utf-8") as f:
                    f.write(json.dumps(record, ensure_ascii=False) + "\n")
            except Exception as e:
                print(f"[FeatureLogger] Background note error: {e}", file=sys.stderr)

    # Dispatch to background daemon thread to avoid blocking caller
    t = threading.Thread(target=_write_async, args=(entry,), daemon=True)
    t.start()
    return entry


def get_recent_features(limit: int = 50) -> list:
    """
    Retrieves the most recent recorded feature entries.
    """
    with _LOG_LOCK:
        try:
            log_dir = _get_feature_log_dir()
            jsonl_file = log_dir / "feature_notes.jsonl"
            if not jsonl_file.exists():
                return []
            lines = jsonl_file.read_text(encoding='utf-8', errors='ignore').strip().split('\n')
            results = []
            for l in reversed(lines):
                if l.strip():
                    try:
                        results.append(json.loads(l))
                        if len(results) >= limit:
                            break
                    except Exception:
                        pass
            return results
        except Exception:
            return []


# Pre-register built-in core features on module import
def _initialize_registry(edition="Standard"):
    core_features = [
        ("PDF Table Extractor & Schedule Parser", "pdf", "Initial core feature"),
        ("Hierarchical CSV to Directory Generator", "folders", "Multi-tier directory creator"),
        ("Media Sorter & Ripple Sequence Shifter", "sorting", "Multi-camera photo/video sorter"),
        ("Drive Inventory & Missing Sequence Gap Audit", "inventory", "Volume scanner and Excel reporter"),
        ("Single-File Setup GUI Installer Pipeline", "packaging", "Automated PyInstaller setup builder"),
        ("Exif Tools & 600/9999 Series Rollover Engine", "exif", "EXIF-based chronological sequence solver"),
        ("Background Feature Noting & Audit Telemetry", "telemetry", "Date-time stamped feature tracker")
    ]
    if edition.lower() == "admin":
        core_features.append(
            ("Inventory-Based Folder Creator & Media Mapper", "admin_mapping", "Maps mixed dump media into inventory structure")
        )

    for feat, cat, desc in core_features:
        note_feature(feat, {"description": desc, "status": "active"}, category=cat, edition=edition)
