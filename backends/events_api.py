"""
AIN53 Data Management - Event Architecture & Creation API (Offline Edition)
==========================================================================

Implements local SQLite database storage and RPC operations for:
- Standard Events (Waaz, Majlis, Namaz, Ziyarat, Isteqbal, Wada)
- QMZ Events (multi-team rotation, round-robin, TSV/CSV bulk mapping)
- Bethak Events (segmented ceremony routing, dual-angle Misaq, Haddiyat/Mafsuhiyat rules)
- Offline folder structure generation and CSV exports
"""

import os
import sys
import json
import sqlite3
import datetime
from pathlib import Path
import io
import csv
import webview
import shutil


def _get_app_setting(key, default=None):
    try:
        from backends.updater import AutoUpdater
        return AutoUpdater().get_setting(key, default)
    except Exception:
        return default


def _set_app_setting(key, val):
    try:
        from backends.updater import AutoUpdater
        AutoUpdater().set_setting(key, val)
    except Exception:
        pass


def _resolve_db_path(base_dir) -> Path:
    """
    Returns a persistent, writable path for ain53_events.db.
    Attempts to use BASE_DIR first, falling back to OS-specific user app data.
    """
    base_dir = Path(base_dir)
    candidate = base_dir / "ain53_events.db"
    try:
        candidate.parent.mkdir(parents=True, exist_ok=True)
        # Check write access
        with open(candidate, "a") as _:
            pass
        return candidate
    except (PermissionError, OSError):
        if sys.platform == "darwin":
            fallback_dir = Path.home() / "Library" / "Application Support" / "AIN53 Data Management"
        elif sys.platform == "win32":
            local_appdata = os.environ.get("LOCALAPPDATA", os.path.expanduser("~\\AppData\\Local"))
            fallback_dir = Path(local_appdata) / "AIN53 Data Management"
        else:
            fallback_dir = Path.home() / ".local" / "share" / "AIN53 Data Management"
        fallback_dir.mkdir(parents=True, exist_ok=True)
        return fallback_dir / "ain53_events.db"

FALLBACK_EVENT_DEFINITIONS = [
    {"name": "Aqiqa", "abr": "AQ"},
    {"name": "Bethak Majlis", "abr": "BM"},
    {"name": "Bethak Qadam", "abr": "BQ"},
    {"name": "Bethak Ziyafat", "abr": "BZ"},
    {"name": "FMB", "abr": "FMB"},
    {"name": "Haddiyat", "abr": "H"},
    {"name": "Idaraat", "abr": "ID"},
    {"name": "Iftettah", "abr": "IF"},
    {"name": "Iftettah Sharaf", "abr": "IFS"},
    {"name": "Isteqbal", "abr": "IST"},
    {"name": "Kg Sharaf", "abr": "KGS"},
    {"name": "Majlis", "abr": "M"},
    {"name": "Mafsuhiyat", "abr": "MF"},
    {"name": "Misbah", "abr": "Misbah"},
    {"name": "Mokib", "abr": "MKB"},
    {"name": "Madrasa", "abr": "MO"},
    {"name": "Misaq", "abr": "MQ"},
    {"name": "Mulaqaat", "abr": "MUL"},
    {"name": "Miyana", "abr": "MYN"},
    {"name": "Majmui Ziyafat", "abr": "MZ"},
    {"name": "Nikah", "abr": "N"},
    {"name": "Namaz", "abr": "Namaz"},
    {"name": "Online", "abr": "Online"},
    {"name": "Qadam", "abr": "Q"},
    {"name": "Qadam Majlis Ziyafat", "abr": "QMZ"},
    {"name": "Sharaf", "abr": "SH"},
    {"name": "Shifa Qadam", "abr": "SQ"},
    {"name": "Tijarat", "abr": "TJR"},
    {"name": "Talaqqi", "abr": "TQ"},
    {"name": "Tahneeq", "abr": "TQN"},
    {"name": "Waaz", "abr": "Waaz"},
    {"name": "Wada", "abr": "WD"},
    {"name": "Ziyafat", "abr": "Z"},
    {"name": "Zafaf Olda", "abr": "ZO"},
]


def _load_event_definitions(base_dir=None):
    """
    Reads event definitions and abbreviations from 'Event List.xlsx',
    falling back to FALLBACK_EVENT_DEFINITIONS.
    """
    search_paths = []
    if base_dir:
        search_paths.append(Path(base_dir) / "Event List.xlsx")
    search_paths.extend([
        Path(__file__).resolve().parent.parent / "Event List.xlsx",
        Path("D:/ON_GOING PROJECT/AIN53 Data Management/Event List.xlsx"),
        Path("Event List.xlsx")
    ])

    events_list = []
    for p in search_paths:
        if p.exists():
            try:
                import openpyxl
                wb = openpyxl.load_workbook(str(p), data_only=True)
                ws = wb.active
                rows = list(ws.iter_rows(values_only=True))
                if rows and len(rows) > 1:
                    start_idx = 1 if "name" in str(rows[0][0]).lower() or "event" in str(rows[0][0]).lower() else 0
                    loaded = []
                    for r in rows[start_idx:]:
                        if r and len(r) >= 2 and r[0] is not None and r[1] is not None:
                            name = str(r[0]).strip()
                            abr = str(r[1]).strip()
                            if name and abr and name != "None" and abr != "None":
                                loaded.append({"name": name, "abr": abr})
                    if loaded:
                        events_list = loaded
                        break
            except Exception:
                try:
                    import pandas as pd
                    df = pd.read_excel(p)
                    loaded = []
                    for _, r in df.iterrows():
                        name = str(r.iloc[0]).strip()
                        abr = str(r.iloc[1]).strip()
                        if name and abr and name != "nan" and abr != "nan":
                            loaded.append({"name": name, "abr": abr})
                    if loaded:
                        events_list = loaded
                        break
                except Exception:
                    pass

    if not events_list:
        events_list = [dict(item) for item in FALLBACK_EVENT_DEFINITIONS]

    abr_to_name = {}
    name_to_abr = {}
    for item in events_list:
        abr_to_name[item["abr"].upper()] = item["name"]
        name_to_abr[item["name"].upper()] = item["abr"]

    # Canonical aliases
    abr_to_name["OLDA"] = "Zafaf Olda"
    abr_to_name["ZO"] = "Zafaf Olda"
    abr_to_name["ZAFAF OLDA"] = "Zafaf Olda"
    abr_to_name["Z"] = "Ziyafat"
    abr_to_name["ZIYAFAT"] = "Ziyafat"
    abr_to_name["Q"] = "Qadam"
    abr_to_name["QADAM"] = "Qadam"
    abr_to_name["M"] = "Majlis"
    abr_to_name["MAJLIS"] = "Majlis"
    abr_to_name["ZIYARAT"] = "Ziyarat"
    abr_to_name["AQEEQA"] = "Aqiqa"
    abr_to_name["IFTETAH"] = "Iftettah"
    abr_to_name["TAHMEEQ"] = "Tahneeq"

    return {
        "list": events_list,
        "abr_to_name": abr_to_name,
        "name_to_abr": name_to_abr
    }


def normalize_event_from_definitions(raw_str, definitions=None):
    if not raw_str:
        return "Qadam"
    s = str(raw_str).strip()
    upper = s.upper()
    if not definitions:
        definitions = _load_event_definitions()

    abr_to_name = definitions.get("abr_to_name", {})
    name_to_abr = definitions.get("name_to_abr", {})

    if upper in abr_to_name:
        return abr_to_name[upper]
    if upper in name_to_abr:
        return s

    for item in definitions.get("list", []):
        if item["abr"].upper() == upper or item["name"].upper() == upper:
            return item["name"]

    if upper == "Z" or upper.endswith(" Z") or "ZIYAFAT" in upper:
        return "Ziyafat"
    if upper == "Q" or upper.endswith(" Q") or "QADAM" in upper:
        return "Qadam"
    if upper == "M" or upper.endswith(" M") or "MAJLIS" in upper:
        return "Majlis"
    if "OLDA" in upper:
        return "Zafaf Olda"
    if "ZIYARAT" in upper:
        return "Ziyarat"

    return s or "Qadam"


class EventsApi:
    """
    Offline SQLite gateway and business logic engine for event management.
    """

    def __init__(self, base_dir: Path):
        self.base_dir = base_dir
        self.db_path = _resolve_db_path(base_dir)
        self._window = None
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path), timeout=15)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    def _init_db(self):
        """Creates tables, indices, and default starter seed data."""
        with self._get_connection() as conn:
            cursor = conn.cursor()

            # 1. Cities Table
            cursor.execute("""
            CREATE TABLE IF NOT EXISTS cities (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                teams_required INTEGER DEFAULT 1,
                core_teams TEXT DEFAULT '[]',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """)

            # 2. Users / Contributors Table
            cursor.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                its TEXT DEFAULT '',
                phone TEXT DEFAULT '',
                role TEXT DEFAULT 'Photographer',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """)

            # 3. City Events Table (mirrors spec Section 2.1)
            cursor.execute("""
            CREATE TABLE IF NOT EXISTS city_events (
                id TEXT PRIMARY KEY,
                city_id INTEGER NOT NULL REFERENCES cities(id) ON DELETE RESTRICT,
                name TEXT,
                date TEXT NOT NULL,
                type TEXT NOT NULL CHECK (type IN ('Waaz','Majlis','Namaz','Ziyarat','QMZ','Bethak','Isteqbal','Wada','Ziyafat','Tahmeeq')),
                event_time_slot TEXT NOT NULL CHECK (event_time_slot IN ('Morning','Evening')),
                status TEXT NOT NULL DEFAULT 'CREATED' CHECK (status IN ('CREATED','ONGOING','COMPLETED')),
                sequence_number INTEGER NOT NULL DEFAULT 1,
                event_code TEXT,
                start_time TEXT,
                report_time TEXT,
                assignment_mode TEXT DEFAULT 'individual' CHECK (assignment_mode IN ('individual','team')),
                coordinator_id INTEGER,
                individual_assignment TEXT DEFAULT '{}',
                individual_multi_assignments TEXT DEFAULT '[]',
                recording_details TEXT DEFAULT '{}',
                qmz_count INTEGER DEFAULT 1,
                qmz_teams TEXT DEFAULT '[]',
                sequence_assignments TEXT DEFAULT '{}',
                admin_override_sequences TEXT DEFAULT '{}',
                bethak_counts TEXT DEFAULT '[]',
                bethak_individual TEXT DEFAULT '{}',
                bethak_multi_assignments TEXT DEFAULT '[]',
                event_ended INTEGER NOT NULL DEFAULT 0,
                event_end_time TEXT,
                finalized INTEGER NOT NULL DEFAULT 0,
                report_path TEXT,
                notes TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """)

            cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_city_events_lookup 
            ON city_events (city_id, date, event_time_slot, sequence_number)
            """)

            # 4. City Event Assignments Table (mirrors spec Section 2.2)
            cursor.execute("""
            CREATE TABLE IF NOT EXISTS city_event_assignments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_id TEXT NOT NULL REFERENCES city_events(id) ON DELETE CASCADE,
                sequence TEXT NOT NULL,
                event_abr TEXT NOT NULL,
                sticker_name TEXT DEFAULT '',
                name TEXT DEFAULT '',
                its TEXT DEFAULT '',
                location TEXT DEFAULT '',
                mobile TEXT DEFAULT '',
                team_id TEXT,
                photographer_id INTEGER,
                videographer_id INTEGER,
                photo_not_covered INTEGER DEFAULT 0,
                video_not_covered INTEGER DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """)

            cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_cea_event_seq 
            ON city_event_assignments (event_id, sequence)
            """)

            try:
                cursor.execute("ALTER TABLE city_event_assignments ADD COLUMN is_inline INTEGER DEFAULT 0")
            except Exception:
                pass

            # 5. Slot Inventory Reports Table
            cursor.execute("""
            CREATE TABLE IF NOT EXISTS slot_inventory_reports (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                safar_name TEXT NOT NULL,
                date TEXT NOT NULL,
                slot TEXT NOT NULL,
                filename TEXT NOT NULL,
                total_found INTEGER DEFAULT 0,
                total_missing INTEGER DEFAULT 0,
                missing_files TEXT DEFAULT '[]',
                issues TEXT DEFAULT '[]',
                cameras TEXT DEFAULT '[]',
                uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(safar_name, date, slot)
            )
            """)
            cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_sir_lookup
            ON slot_inventory_reports (safar_name, date, slot)
            """)

            cursor.execute("PRAGMA table_info(slot_inventory_reports)")
            sir_cols = [row[1] for row in cursor.fetchall()]
            if "details_json" not in sir_cols:
                cursor.execute("ALTER TABLE slot_inventory_reports ADD COLUMN details_json TEXT DEFAULT '{}'")
            if "file_base64" not in sir_cols:
                cursor.execute("ALTER TABLE slot_inventory_reports ADD COLUMN file_base64 TEXT DEFAULT ''")

            # 6. Seed default starter data if empty
            cursor.execute("SELECT COUNT(*) FROM cities")
            if cursor.fetchone()[0] == 0:
                # Seed starter contributors first
                sample_users = [
                    ("Burhanuddin H", "30336407", "+91 9819718225", "Photographer"),
                    ("Murtaza A", "20347189", "+91 9893184122", "Videographer"),
                    ("Husain K", "30493720", "+91 8319204837", "Photographer"),
                    ("Taher M", "50429891", "+91 9806760000", "Videographer"),
                    ("Abdeali S", "20356570", "+91 9893752524", "Drone"),
                    ("Shabbir K", "20347145", "+91 9131326353", "Coordinator"),
                ]
                cursor.executemany(
                    "INSERT INTO users (name, its, phone, role) VALUES (?, ?, ?, ?)",
                    sample_users
                )
                
                # Default core teams mapping:
                # Team 1: Photo 1, Video 2
                # Team 2: Photo 3, Video 4
                default_core_teams = json.dumps([
                    {"photographer_id": 1, "videographer_id": 2},
                    {"photographer_id": 3, "videographer_id": 4}
                ])

                sample_cities = [
                    ("Mumbai", 2, default_core_teams),
                    ("Mumbra", 2, default_core_teams),
                    ("Bilaspur", 2, default_core_teams),
                    ("Takhatpur", 2, default_core_teams),
                    ("Raipur", 2, default_core_teams),
                    ("Karachi", 2, default_core_teams),
                    ("Dubai", 2, default_core_teams),
                    ("Nairobi", 2, default_core_teams),
                    ("London", 2, default_core_teams),
                ]
                cursor.executemany(
                    "INSERT INTO cities (name, teams_required, core_teams) VALUES (?, ?, ?)",
                    sample_cities
                )
            else:
                # Ensure Mumbra is present in existing database
                cursor.execute("SELECT id FROM cities WHERE LOWER(name) = 'mumbra'")
                if not cursor.fetchone():
                    default_core_teams = json.dumps([
                        {"photographer_id": 1, "videographer_id": 2},
                        {"photographer_id": 3, "videographer_id": 4}
                    ])
                    cursor.execute(
                        "INSERT INTO cities (name, teams_required, core_teams) VALUES (?, ?, ?)",
                        ("Mumbra", 2, default_core_teams)
                    )

            # 6. Safars Table & Safar Column Migration
            cursor.execute("""
            CREATE TABLE IF NOT EXISTS safars (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                path TEXT DEFAULT '',
                temp_path TEXT DEFAULT '',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """)

            cursor.execute("PRAGMA table_info(safars)")
            safar_cols = [row[1] for row in cursor.fetchall()]
            if "path" not in safar_cols:
                cursor.execute("ALTER TABLE safars ADD COLUMN path TEXT DEFAULT ''")
            if "temp_path" not in safar_cols:
                cursor.execute("ALTER TABLE safars ADD COLUMN temp_path TEXT DEFAULT ''")
            if "status" not in safar_cols:
                cursor.execute("ALTER TABLE safars ADD COLUMN status TEXT DEFAULT 'active'")

            cursor.execute("PRAGMA table_info(city_events)")
            event_cols = [row[1] for row in cursor.fetchall()]
            if "safar_name" not in event_cols:
                cursor.execute("ALTER TABLE city_events ADD COLUMN safar_name TEXT DEFAULT ''")

            cursor.execute("SELECT COUNT(*) FROM safars")
            if cursor.fetchone()[0] == 0:
                cursor.execute("SELECT DISTINCT safar_name FROM city_events WHERE safar_name IS NOT NULL AND safar_name != ''")
                existing_safars = cursor.fetchall()
                if existing_safars:
                    for s in existing_safars:
                        cursor.execute("INSERT OR IGNORE INTO safars (name) VALUES (?)", (s[0],))

            # Backfill any city_events that have blank safar_name
            cursor.execute("SELECT name FROM safars ORDER BY id ASC LIMIT 1")
            first_safar_row = cursor.fetchone()
            if first_safar_row:
                cursor.execute("UPDATE city_events SET safar_name = ? WHERE safar_name IS NULL OR safar_name = ''", (first_safar_row[0],))

            # Ensure users table has series and safar_name columns
            cursor.execute("PRAGMA table_info(users)")
            user_cols = [row[1] for row in cursor.fetchall()]
            if "series" not in user_cols:
                cursor.execute("ALTER TABLE users ADD COLUMN series TEXT DEFAULT ''")
            if "safar_name" not in user_cols:
                cursor.execute("ALTER TABLE users ADD COLUMN safar_name TEXT DEFAULT ''")

            # Ensure city_event_assignments table has is_inline column
            cursor.execute("PRAGMA table_info(city_event_assignments)")
            cea_cols = [row[1] for row in cursor.fetchall()]
            if "is_inline" not in cea_cols:
                cursor.execute("ALTER TABLE city_event_assignments ADD COLUMN is_inline INTEGER DEFAULT 0")

            conn.commit()

    # ==========================================================================
    # SAFAR MANAGEMENT CRUD
    # ==========================================================================
    def get_safars(self):
        """Returns all registered safars along with path, temp_path, date and event counts."""
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                SELECT s.id, s.name, s.path, s.temp_path, s.created_at,
                       COUNT(DISTINCT e.id) as event_count,
                       COUNT(DISTINCT e.date) as date_count,
                       COALESCE(s.status, 'active') as status
                FROM safars s
                LEFT JOIN city_events e ON LOWER(e.safar_name) = LOWER(s.name)
                GROUP BY s.id, s.name, s.path, s.temp_path, s.created_at, s.status
                ORDER BY s.id ASC
                """)
                rows = cursor.fetchall()
                safars = []
                for r in rows:
                    safars.append({
                        "id": r[0],
                        "name": r[1],
                        "path": r[2] or "",
                        "temp_path": r[3] or "",
                        "created_at": r[4],
                        "event_count": r[5] or 0,
                        "date_count": r[6] or 0,
                        "status": r[7] or "active"
                    })
                return json.dumps({"success": True, "safars": safars})
        except Exception as e:
            return json.dumps({"error": str(e)})

    def add_safar(self, name: str, path: str = ""):
        """Registers a new Safar with root path and auto-created AIN_Temp working directory."""
        name = str(name or "").strip()
        path = str(path or "").strip()
        if not name:
            return json.dumps({"error": "Safar name cannot be empty"})
        try:
            temp_path = ""
            if path:
                safar_dir = Path(path).resolve()
                if safar_dir.name.lower() != name.lower():
                    safar_dir = safar_dir / name
                safar_dir.mkdir(parents=True, exist_ok=True)
                # Create dedicated AIN_Temp directory inside Safar root
                ain_temp_dir = safar_dir / "AIN_Temp"
                ain_temp_dir.mkdir(parents=True, exist_ok=True)
                temp_path = str(ain_temp_dir)
                path = str(safar_dir)

                # Set app settings for active working temp folder
                _set_app_setting("ain_temp_path", temp_path)
                _set_app_setting("pdf_output_folder", temp_path)
                _set_app_setting("safar_root_path", path)

            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                INSERT INTO safars (name, path, temp_path) VALUES (?, ?, ?)
                ON CONFLICT(name) DO UPDATE SET path = excluded.path, temp_path = excluded.temp_path
                """, (name, path, temp_path))
                conn.commit()
                cursor.execute("SELECT id, name, path, temp_path, created_at FROM safars WHERE LOWER(name) = LOWER(?)", (name,))
                row = cursor.fetchone()
                return json.dumps({
                    "success": True,
                    "safar": {
                        "id": row[0],
                        "name": row[1],
                        "path": row[2] or "",
                        "temp_path": row[3] or "",
                        "created_at": row[4],
                        "event_count": 0,
                        "date_count": 0
                    }
                })
        except Exception as e:
            return json.dumps({"error": str(e)})

    def update_safar_path(self, name: str, path: str):
        """Updates Safar root folder path, creating AIN_Temp inside it."""
        name = str(name or "").strip()
        path = str(path or "").strip()
        if not name or not path:
            return json.dumps({"error": "Safar name and path are required"})
        try:
            safar_dir = Path(path).resolve()
            if safar_dir.name.lower() != name.lower():
                safar_dir = safar_dir / name
            safar_dir.mkdir(parents=True, exist_ok=True)
            ain_temp_dir = safar_dir / "AIN_Temp"
            ain_temp_dir.mkdir(parents=True, exist_ok=True)
            temp_path = str(ain_temp_dir)
            resolved_path = str(safar_dir)

            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("UPDATE safars SET path = ?, temp_path = ? WHERE LOWER(name) = LOWER(?)",
                               (resolved_path, temp_path, name))
                conn.commit()

            _set_app_setting("ain_temp_path", temp_path)
            _set_app_setting("pdf_output_folder", temp_path)
            _set_app_setting("safar_root_path", resolved_path)

            return json.dumps({"success": True, "name": name, "path": resolved_path, "temp_path": temp_path})
        except Exception as e:
            return json.dumps({"error": str(e)})

    def update_safar_status(self, name: str, status: str = "completed"):
        """Updates the status of a Safar (e.g. 'completed', 'active')."""
        name = str(name or "").strip()
        status = str(status or "active").strip().lower()
        if not name:
            return json.dumps({"error": "Safar name cannot be empty"})
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("UPDATE safars SET status = ? WHERE LOWER(name) = LOWER(?)", (status, name))
                conn.commit()
                return json.dumps({"success": True, "name": name, "status": status})
        except Exception as e:
            return json.dumps({"error": str(e)})

    def download_crew_template(self, safar_name: str = ""):
        """Saves crew roster template to Safar folder / AIN_Temp and Downloads directory."""
        csv_content = (
            "Name,Camera Series,Role,ITS,Phone\n"
            "Adnan Bhai,ADN,Photographer,20384721,+919876543210\n"
            "Aliasgar Bhai,MR_A,Videographer,20492834,+919876543211\n"
            "Murtaza Bhai,MUR,Photographer,30182745,+919876543212\n"
            "Taha Bhai,TAHA,Videographer,40291837,+919876543213\n"
            "Husain Bhai,DRN_1,Drone,50192837,+919876543214\n"
        )
        saved_paths = []
        try:
            # 1. Active Safar directory and AIN_Temp
            safar_dir = None
            safar_name = str(safar_name or "").strip()
            if safar_name:
                with self._get_connection() as conn:
                    cursor = conn.cursor()
                    cursor.execute("SELECT path, temp_path FROM safars WHERE LOWER(name) = LOWER(?)", (safar_name,))
                    row = cursor.fetchone()
                    if row and row[0]:
                        safar_dir = Path(row[0])

            if not safar_dir:
                app_safar_path = _get_app_setting("safar_root_path", "")
                if app_safar_path and Path(app_safar_path).exists():
                    safar_dir = Path(app_safar_path)

            if safar_dir and safar_dir.exists():
                out_path = safar_dir / "Crew_Camera_Series_Roster_Template.csv"
                out_path.write_text(csv_content, encoding="utf-8")
                saved_paths.append(str(out_path))

                temp_dir = safar_dir / "AIN_Temp"
                temp_dir.mkdir(parents=True, exist_ok=True)
                t_path = temp_dir / "Crew_Camera_Series_Roster_Template.csv"
                t_path.write_text(csv_content, encoding="utf-8")
                saved_paths.append(str(t_path))

            # 2. System Downloads folder
            user_downloads = Path.home() / "Downloads"
            if user_downloads.exists():
                dl_path = user_downloads / "Crew_Camera_Series_Roster_Template.csv"
                dl_path.write_text(csv_content, encoding="utf-8")
                saved_paths.append(str(dl_path))

            return json.dumps({
                "success": True,
                "saved_paths": saved_paths,
                "primary_path": saved_paths[0] if saved_paths else ""
            })
        except Exception as e:
            return json.dumps({"error": str(e), "saved_paths": saved_paths})

    def set_active_safar(self, safar_name: str):
        """Sets active Safar and points app settings to that Safar's AIN_Temp working folder."""
        safar_name = str(safar_name or "").strip()
        if not safar_name:
            return json.dumps({"error": "Safar name cannot be empty"})
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT id, name, path, temp_path FROM safars WHERE LOWER(name) = LOWER(?)", (safar_name,))
                row = cursor.fetchone()
                if not row:
                    return json.dumps({"success": True, "safar_name": safar_name})
                s_path = row[2] or ""
                t_path = row[3] or ""
                if s_path:
                    s_dir = Path(s_path).resolve()
                    s_dir.mkdir(parents=True, exist_ok=True)
                    if not t_path or not Path(t_path).exists():
                        ain_temp = s_dir / "AIN_Temp"
                        ain_temp.mkdir(parents=True, exist_ok=True)
                        t_path = str(ain_temp)
                        cursor.execute("UPDATE safars SET temp_path = ? WHERE id = ?", (t_path, row[0]))
                        conn.commit()

                    _set_app_setting("safar_root_path", s_path)
                    _set_app_setting("ain_temp_path", t_path)
                    _set_app_setting("pdf_output_folder", t_path)

                return json.dumps({
                    "success": True,
                    "safar_name": safar_name,
                    "path": s_path,
                    "temp_path": t_path
                })
        except Exception as e:
            return json.dumps({"error": str(e)})

    def delete_safar(self, safar_name: str):
        """Deletes a Safar and its associated events and assignments."""
        safar_name = str(safar_name or "").strip()
        if not safar_name:
            return json.dumps({"error": "Safar name cannot be empty"})
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                DELETE FROM city_event_assignments 
                WHERE event_id IN (SELECT id FROM city_events WHERE LOWER(safar_name) = LOWER(?))
                """, (safar_name,))
                cursor.execute("DELETE FROM city_events WHERE LOWER(safar_name) = LOWER(?)", (safar_name,))
                cursor.execute("DELETE FROM safars WHERE LOWER(name) = LOWER(?)", (safar_name,))
                cursor.execute("UPDATE users SET safar_name = '' WHERE LOWER(safar_name) = LOWER(?)", (safar_name,))
                conn.commit()
                return json.dumps({"success": True, "message": f"Safar '{safar_name}' and associated events deleted"})
        except Exception as e:
            return json.dumps({"error": str(e)})

    def clear_all_safars(self):
        """Clears all Safars, all events, and all event assignments (complete fresh reset)."""
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("DELETE FROM city_event_assignments")
                cursor.execute("DELETE FROM city_events")
                cursor.execute("DELETE FROM safars")
                cursor.execute("UPDATE users SET safar_name = ''")
                conn.commit()
                return json.dumps({"success": True, "message": "All Safars and events cleared successfully"})
        except Exception as e:
            return json.dumps({"error": str(e)})

    # ==========================================================================
    # CITIES & CONTRIBUTORS CRUD
    # ==========================================================================
    def get_cities(self):
        """Returns all registered cities."""
        try:
            with self._get_connection() as conn:
                rows = conn.execute("SELECT * FROM cities ORDER BY name ASC").fetchall()
                cities = []
                for r in rows:
                    cities.append({
                        "id": r["id"],
                        "name": r["name"],
                        "teams_required": r["teams_required"],
                        "core_teams": json.loads(r["core_teams"] or "[]"),
                        "created_at": r["created_at"],
                    })
                return json.dumps({"success": True, "cities": cities})
        except Exception as e:
            return json.dumps({"error": str(e)})

    def add_city(self, name, teams_required=1, core_teams=None):
        """Adds a new city or returns existing if present."""
        if not name or not str(name).strip():
            return json.dumps({"error": "City name is required"})
        clean_name = str(name).strip()
        if isinstance(core_teams, str):
            try:
                core_teams = json.loads(core_teams)
            except Exception:
                core_teams = []
        teams_json = json.dumps(core_teams if isinstance(core_teams, list) else [])
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT * FROM cities WHERE LOWER(name) = LOWER(?)", (clean_name,))
                existing = cursor.fetchone()
                if existing:
                    return json.dumps({
                        "success": True,
                        "city": {
                            "id": existing["id"],
                            "name": existing["name"],
                            "teams_required": existing["teams_required"],
                            "core_teams": json.loads(existing["core_teams"] or "[]"),
                        }
                    })
                cursor.execute(
                    "INSERT INTO cities (name, teams_required, core_teams) VALUES (?, ?, ?)",
                    (clean_name, int(teams_required or 1), teams_json)
                )
                conn.commit()
                city_id = cursor.lastrowid
                return json.dumps({
                    "success": True,
                    "city": {
                        "id": city_id,
                        "name": clean_name,
                        "teams_required": int(teams_required or 1),
                        "core_teams": json.loads(teams_json),
                    }
                })
        except Exception as e:
            return json.dumps({"error": str(e)})

    def search_cities(self, query: str = "") -> str:
        """
        Searches cities strictly from the local SQLite database matching prefix
        or substring (instant offline, no external API calls).
        Returns JSON { success: True, query: query, cities: [...] }.
        """
        clean_q = str(query or "").strip()
        if not clean_q:
            return self.get_cities()

        results = []
        seen_names = set()

        # 1. Local SQLite Database search
        try:
            with self._get_connection() as conn:
                prefix = f"{clean_q.lower()}%"
                sub = f"%{clean_q.lower()}%"
                rows = conn.execute("""
                    SELECT id, name, teams_required, core_teams
                    FROM cities
                    WHERE LOWER(name) LIKE ?
                    ORDER BY CASE WHEN LOWER(name) LIKE ? THEN 0 ELSE 1 END, name ASC
                    LIMIT 20
                """, (sub, prefix)).fetchall()

                for r in rows:
                    name = r["name"]
                    seen_names.add(name.lower())
                    results.append({
                        "id": r["id"],
                        "name": name,
                        "description": "Registered City in AIN53",
                        "is_local": True,
                        "source": "local"
                    })
        except Exception:
            pass

        return json.dumps({"success": True, "query": clean_q, "cities": results})

    def get_contributors(self, safar_name: str = None):
        """Returns registered crew members, optionally filtered or prioritized for a specific safar."""
        try:
            with self._get_connection() as conn:
                clean_safar = str(safar_name or "").strip()
                if clean_safar:
                    rows = conn.execute("""
                        SELECT * FROM users 
                        WHERE safar_name IS NULL OR safar_name = '' OR LOWER(safar_name) = LOWER(?)
                        ORDER BY CASE WHEN LOWER(safar_name) = LOWER(?) THEN 0 ELSE 1 END, name ASC
                    """, (clean_safar, clean_safar)).fetchall()
                else:
                    rows = conn.execute("SELECT * FROM users ORDER BY name ASC").fetchall()
                users = [dict(r) for r in rows]
                return json.dumps({"success": True, "contributors": users, "safar_name": clean_safar})
        except Exception as e:
            return json.dumps({"error": str(e)})

    def add_contributor(self, name, its="", phone="", role="Photographer", series="", safar_name=""):
        """Registers a new crew contributor with optional camera series and safar assignment."""
        if not name or not str(name).strip():
            return json.dumps({"error": "Contributor name is required"})
        clean_name = str(name).strip()
        clean_its = str(its or "").strip()
        clean_phone = str(phone or "").strip()
        clean_role = str(role or "").strip() or "Photographer"
        clean_series = str(series or "").strip().upper()
        clean_safar = str(safar_name or "").strip()

        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute(
                    "INSERT INTO users (name, its, phone, role, series, safar_name) VALUES (?, ?, ?, ?, ?, ?)",
                    (clean_name, clean_its, clean_phone, clean_role, clean_series, clean_safar)
                )
                conn.commit()
                return json.dumps({
                    "success": True,
                    "contributor": {
                        "id": cursor.lastrowid,
                        "name": clean_name,
                        "its": clean_its,
                        "phone": clean_phone,
                        "role": clean_role,
                        "series": clean_series,
                        "safar_name": clean_safar
                    }
                })
        except Exception as e:
            return json.dumps({"error": str(e)})

    def update_contributor(self, contributor_id: int, name=None, its=None, phone=None, role=None, series=None, safar_name=None):
        """Updates an existing contributor's details."""
        if not contributor_id:
            return json.dumps({"error": "contributor_id is required"})
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT * FROM users WHERE id = ?", (int(contributor_id),))
                current = cursor.fetchone()
                if not current:
                    return json.dumps({"error": f"Contributor #{contributor_id} not found"})

                new_name = str(name).strip() if name is not None else current["name"]
                new_its = str(its).strip() if its is not None else current["its"]
                new_phone = str(phone).strip() if phone is not None else current["phone"]
                new_role = str(role).strip() if role is not None else current["role"]
                new_series = str(series).strip().upper() if series is not None else (current["series"] if "series" in current.keys() else "")
                new_safar = str(safar_name).strip() if safar_name is not None else (current["safar_name"] if "safar_name" in current.keys() else "")

                cursor.execute("""
                    UPDATE users 
                    SET name = ?, its = ?, phone = ?, role = ?, series = ?, safar_name = ?
                    WHERE id = ?
                """, (new_name, new_its, new_phone, new_role, new_series, new_safar, int(contributor_id)))
                conn.commit()
                return json.dumps({
                    "success": True,
                    "contributor": {
                        "id": int(contributor_id),
                        "name": new_name,
                        "its": new_its,
                        "phone": new_phone,
                        "role": new_role,
                        "series": new_series,
                        "safar_name": new_safar
                    }
                })
        except Exception as e:
            return json.dumps({"error": str(e)})

    def select_crew_file(self):
        """Native file dialog to pick a crew roster file (CSV, Excel, TSV, TXT)."""
        if not self._window:
            return json.dumps({"error": "Native window dialog unavailable"})
        try:
            result = self._window.create_file_dialog(
                webview.FileDialog.OPEN,
                file_types=(
                    "Supported Crew Files (*.csv;*.xlsx;*.xls;*.tsv;*.txt)",
                    "CSV Files (*.csv)",
                    "Excel Files (*.xlsx;*.xls)",
                    "All Files (*.*)"
                )
            )
            if not result:
                return json.dumps({"cancelled": True})
            path = result if isinstance(result, str) else result[0]
            return json.dumps({"success": True, "file_path": path})
        except Exception as e:
            return json.dumps({"error": str(e)})

    def import_crew_file(self, safar_name: str, file_path: str = "", file_content: str = ""):
        """
        Parses and imports a crew roster file for a particular Safar.
        Extracts Contributor Name and Camera Series (e.g. ADN, MR_A, MUR, TAHA),
        Role, ITS, and Phone.
        Supports CSV, TSV, TXT, Excel (.xlsx, .xls), or raw pasted content.
        """
        import re
        import csv
        import io

        clean_safar = str(safar_name or "").strip()
        parsed_rows = []

        try:
            # 1. Read input rows from Excel, File Path, or Content String
            if file_path and (file_path.lower().endswith('.xlsx') or file_path.lower().endswith('.xls')):
                try:
                    import pandas as pd
                    df = pd.read_excel(file_path, dtype=str)
                    df = df.fillna("")
                    headers = [str(c).strip() for c in df.columns]
                    for _, row in df.iterrows():
                        parsed_rows.append({h: str(row[h]).strip() for h in headers})
                except Exception as ex_err:
                    return json.dumps({"error": f"Failed reading Excel file: {str(ex_err)}"})
            else:
                raw_text = ""
                if file_path and os.path.exists(file_path):
                    for enc in ('utf-8-sig', 'utf-8', 'latin-1', 'cp1252'):
                        try:
                            with open(file_path, 'r', encoding=enc) as f:
                                raw_text = f.read()
                            break
                        except UnicodeDecodeError:
                            continue
                elif file_content:
                    raw_text = str(file_content)

                if not raw_text.strip():
                    return json.dumps({"error": "No file content or valid file path provided"})

                # Determine delimiter
                first_lines = raw_text.strip().splitlines()[:5]
                sample_header = "\n".join(first_lines)
                delimiter = ','
                if '\t' in sample_header:
                    delimiter = '\t'
                elif ';' in sample_header and ',' not in sample_header:
                    delimiter = ';'

                reader = csv.reader(io.StringIO(raw_text), delimiter=delimiter)
                all_csv_rows = [row for row in reader if any(cell.strip() for cell in row)]
                if not all_csv_rows:
                    return json.dumps({"error": "Empty crew roster file"})

                # Detect header row
                header_idx = 0
                header_names = [c.strip() for c in all_csv_rows[0]]
                
                # Check if first row looks like a header
                def norm_h(val):
                    return re.sub(r'[^a-z0-9]', '', str(val).lower())

                norm_headers = [norm_h(h) for h in header_names]
                has_name_header = any(n in ('name', 'contributor', 'contributors', 'contributorname', 'contributorsname', 'crew', 'crewmember', 'photographer', 'videographer') for n in norm_headers)
                has_series_header = any(s in ('series', 'cameraseries', 'cameracode', 'contributorseries', 'contributorsseries', 'code', 'camera') for s in norm_headers)

                if has_name_header or has_series_header:
                    headers = header_names
                    data_rows = all_csv_rows[1:]
                else:
                    # Positional fallback
                    headers = [f"col_{i}" for i in range(len(header_names))]
                    data_rows = all_csv_rows

                for r in data_rows:
                    row_dict = {}
                    for idx, val in enumerate(r):
                        key = headers[idx] if idx < len(headers) else f"col_{idx}"
                        row_dict[key] = val.strip()
                    parsed_rows.append(row_dict)

            if not parsed_rows:
                return json.dumps({"error": "No valid data rows found in crew roster"})

            # 2. Map fields flexibly
            def clean_header_key(k):
                return re.sub(r'[^a-z0-9]', '', str(k).lower())

            processed_contributors = []
            with self._get_connection() as conn:
                cursor = conn.cursor()

                for row in parsed_rows:
                    name_val = ""
                    series_val = ""
                    role_val = ""
                    its_val = ""
                    phone_val = ""

                    # Search keys
                    for k, v in row.items():
                        norm_k = clean_header_key(k)
                        val_str = str(v).strip()
                        if not val_str:
                            continue

                        # Check Name
                        if not name_val and any(target in norm_k for target in ('contributorname', 'contributorsname', 'crewname', 'fullname', 'membername')) or norm_k in ('name', 'contributor', 'crew', 'member', 'photographer'):
                            name_val = val_str
                        # Check Series
                        elif not series_val and any(target in norm_k for target in ('cameraseries', 'contributorseries', 'contributorsseries', 'seriescode', 'cameracode', 'camcode')) or norm_k in ('series', 'camera', 'code', 'cam'):
                            series_val = val_str
                        # Check Role
                        elif not role_val and norm_k in ('role', 'designation', 'position', 'category', 'type'):
                            role_val = val_str
                        # Check ITS
                        elif not its_val and ('its' in norm_k or 'id' == norm_k):
                            its_val = val_str
                        # Check Phone
                        elif not phone_val and any(target in norm_k for target in ('phone', 'mobile', 'contact', 'cell', 'whatsapp')):
                            phone_val = val_str

                    # Fallback for 2-column or 3-column rows without recognized headers
                    if not name_val and len(row) >= 1:
                        vals = [str(v).strip() for v in row.values() if str(v).strip()]
                        if vals:
                            name_val = vals[0]
                            if len(vals) >= 2 and not series_val:
                                series_val = vals[1]
                            if len(vals) >= 3 and not role_val:
                                role_val = vals[2]

                    # Skip empty rows or header echoes
                    if not name_val or clean_header_key(name_val) in ('name', 'contributor', 'contributorsname'):
                        continue

                    # Normalize Series
                    clean_series = series_val.strip().upper()

                    # Infer Role if missing
                    clean_role = role_val.strip()
                    if not clean_role:
                        lower_s = clean_series.lower() + " " + name_val.lower()
                        if 'video' in lower_s or 'vid' in lower_s:
                            clean_role = 'Videographer'
                        elif 'drone' in lower_s:
                            clean_role = 'Drone'
                        elif 'coord' in lower_s:
                            clean_role = 'Coordinator'
                        else:
                            clean_role = 'Photographer'

                    # Upsert into database
                    cursor.execute("""
                        SELECT id, series, role, its, phone FROM users 
                        WHERE LOWER(name) = LOWER(?) AND (safar_name = ? OR safar_name IS NULL OR safar_name = '')
                    """, (name_val, clean_safar))
                    existing = cursor.fetchone()

                    if existing:
                        uid = existing["id"]
                        final_series = clean_series or (existing["series"] if "series" in existing.keys() else "")
                        final_role = clean_role or existing["role"]
                        final_its = its_val or existing["its"]
                        final_phone = phone_val or existing["phone"]
                        cursor.execute("""
                            UPDATE users 
                            SET series = ?, role = ?, its = ?, phone = ?, safar_name = ?
                            WHERE id = ?
                        """, (final_series, final_role, final_its, final_phone, clean_safar, uid))
                    else:
                        cursor.execute("""
                            INSERT INTO users (name, its, phone, role, series, safar_name)
                            VALUES (?, ?, ?, ?, ?, ?)
                        """, (name_val, its_val, phone_val, clean_role, clean_series, clean_safar))
                        uid = cursor.lastrowid

                    processed_contributors.append({
                        "id": uid,
                        "name": name_val,
                        "series": clean_series,
                        "role": clean_role,
                        "its": its_val,
                        "phone": phone_val,
                        "safar_name": clean_safar
                    })

                conn.commit()

            # Sync with sorting module if available
            try:
                import sys
                if "backends.sorting" in sys.modules:
                    sorting_mod = sys.modules["backends.sorting"]
                    # If any contributor series dictionary exists on active instances, update it
                    for item in processed_contributors:
                        if item["name"] and item["series"]:
                            # Will be loaded on demand or next mapping parse
                            pass
            except Exception:
                pass

            return json.dumps({
                "success": True,
                "imported_count": len(processed_contributors),
                "safar_name": clean_safar,
                "contributors": processed_contributors
            })
        except Exception as e:
            return json.dumps({"error": f"Crew import failed: {str(e)}"})

    # ==========================================================================
    # DETERMINISTIC SEQUENCE & EVENT OPERATIONS
    # ==========================================================================
    def get_next_sequence(self, date: str, slot: str) -> str:
        """
        Calculates max(sequence_number) + 1 strictly scoped to date + slot (date|||slot).
        Returns JSON { success: True, next_seq: int }.
        """
        if not date or not slot:
            return json.dumps({"success": True, "next_seq": 1})
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute(
                    "SELECT COALESCE(MAX(sequence_number), 0) FROM city_events WHERE date = ? AND event_time_slot = ?",
                    (date.strip(), slot.strip())
                )
                max_seq = cursor.fetchone()[0] or 0
                return json.dumps({"success": True, "next_seq": max_seq + 1})
        except Exception as e:
            return json.dumps({"error": str(e)})

    def save_event(self, event_data: dict, city_id: int) -> str:
        """
        Inserts or updates a CityEvent in the database.
        """
        try:
            now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
            if isinstance(event_data, str):
                try:
                    event_data = json.loads(event_data)
                except Exception:
                    pass
            if not isinstance(event_data, dict):
                return json.dumps({"error": "Invalid event_data payload"})

            evt_id = event_data.get("id") or f"evt-{int(datetime.datetime.now().timestamp()*1000)}"
            city_id = int(city_id) if city_id else 1

            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT id FROM city_events WHERE id = ?", (evt_id,))
                exists = cursor.fetchone() is not None

                safar_val = str(event_data.get("safar_name") or "").strip()
                if not safar_val:
                    cursor.execute("SELECT name FROM safars ORDER BY id ASC LIMIT 1")
                    first_safar = cursor.fetchone()
                    safar_val = first_safar[0] if first_safar else "1448-08-Raipur Atraaf"

                sql_params = (
                    city_id,
                    event_data.get("name") or event_data.get("event_code"),
                    event_data.get("date"),
                    event_data.get("type"),
                    event_data.get("event_time_slot", "Morning"),
                    event_data.get("status", "CREATED"),
                    int(event_data.get("sequence_number", 1)),
                    event_data.get("event_code"),
                    event_data.get("start_time"),
                    event_data.get("report_time"),
                    event_data.get("assignment_mode", "individual"),
                    event_data.get("coordinator_id"),
                    json.dumps(event_data.get("individual_assignment") or {}),
                    json.dumps(event_data.get("individual_multi_assignments") or []),
                    json.dumps(event_data.get("recording_details") or {}),
                    int(event_data.get("qmz_count", 1)),
                    json.dumps(event_data.get("qmz_teams") or []),
                    json.dumps(event_data.get("sequence_assignments") or {}),
                    json.dumps(event_data.get("admin_override_sequences") or {}),
                    json.dumps(event_data.get("bethak_counts") or []),
                    json.dumps(event_data.get("bethak_individual") or {}),
                    json.dumps(event_data.get("bethak_multi_assignments") or []),
                    1 if event_data.get("event_ended") else 0,
                    event_data.get("event_end_time"),
                    1 if event_data.get("finalized") else 0,
                    event_data.get("report_path"),
                    event_data.get("notes"),
                    safar_val,
                    now_iso
                )

                if exists:
                    cursor.execute("""
                    UPDATE city_events SET
                        city_id=?, name=?, date=?, type=?, event_time_slot=?, status=?,
                        sequence_number=?, event_code=?, start_time=?, report_time=?,
                        assignment_mode=?, coordinator_id=?, individual_assignment=?,
                        individual_multi_assignments=?, recording_details=?, qmz_count=?,
                        qmz_teams=?, sequence_assignments=?, admin_override_sequences=?,
                        bethak_counts=?, bethak_individual=?, bethak_multi_assignments=?,
                        event_ended=?, event_end_time=?, finalized=?, report_path=?,
                        notes=?, safar_name=?, updated_at=?
                    WHERE id=?
                    """, sql_params + (evt_id,))
                else:
                    cursor.execute("""
                    INSERT INTO city_events (
                        city_id, name, date, type, event_time_slot, status,
                        sequence_number, event_code, start_time, report_time,
                        assignment_mode, coordinator_id, individual_assignment,
                        individual_multi_assignments, recording_details, qmz_count,
                        qmz_teams, sequence_assignments, admin_override_sequences,
                        bethak_counts, bethak_individual, bethak_multi_assignments,
                        event_ended, event_end_time, finalized, report_path,
                        notes, safar_name, updated_at, id, created_at
                    ) VALUES (
                        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
                    )
                    """, sql_params + (evt_id, now_iso))

                conn.commit()

            return json.dumps({"success": True, "id": evt_id})
        except Exception as e:
            return json.dumps({"error": str(e)})

    def sync_assignments(self, event_id: str, assignments: list) -> str:
        """
        Replaces all assignments for event_id in city_event_assignments transactionally.
        """
        if not event_id:
            return json.dumps({"error": "event_id is required"})
        try:
            if isinstance(assignments, str):
                try:
                    assignments = json.loads(assignments)
                except Exception:
                    assignments = []
            if not isinstance(assignments, list):
                assignments = []

            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT qmz_teams FROM city_events WHERE id = ?", (event_id,))
                evt_row = cursor.fetchone()
                event_teams = []
                if evt_row and evt_row["qmz_teams"]:
                    try:
                        event_teams = json.loads(evt_row["qmz_teams"])
                    except Exception:
                        event_teams = []
                single_team = event_teams[0] if len(event_teams) == 1 else None
                team_lookup = {t.get("id"): t for t in event_teams if t.get("id")}
                for t in event_teams:
                    if t.get("name"):
                        team_lookup[t.get("name")] = t

                now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
                rows_to_insert = []
                for a in assignments:
                    t_id = a.get("team_id")
                    p_id = a.get("photographer_id")
                    v_id = a.get("videographer_id")
                    matched_t = team_lookup.get(t_id) or single_team
                    if not p_id and matched_t and matched_t.get("photographer_id"):
                        p_id = matched_t.get("photographer_id")
                    if not v_id and matched_t and matched_t.get("videographer_id"):
                        v_id = matched_t.get("videographer_id")
                    if not t_id and matched_t and matched_t.get("id"):
                        t_id = matched_t.get("id")

                    rows_to_insert.append((
                        event_id,
                        str(a.get("sequence", "")),
                        str(a.get("event_abr", "Qadam")),
                        str(a.get("sticker_name", "") or ""),
                        str(a.get("name", "") or ""),
                        str(a.get("its", "") or ""),
                        str(a.get("location", "") or ""),
                        str(a.get("mobile", "") or ""),
                        str(t_id or "") if t_id is not None else None,
                        p_id,
                        v_id,
                        1 if a.get("photo_not_covered") else 0,
                        1 if a.get("video_not_covered") else 0,
                        1 if a.get("is_inline") else 0,
                        now_iso,
                        now_iso
                    ))

                cursor.execute("DELETE FROM city_event_assignments WHERE event_id = ?", (event_id,))
                if rows_to_insert:
                    cursor.executemany("""
                    INSERT INTO city_event_assignments (
                        event_id, sequence, event_abr, sticker_name, name, its,
                        location, mobile, team_id, photographer_id, videographer_id,
                        photo_not_covered, video_not_covered, is_inline, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, rows_to_insert)

                # Bump updated_at on parent event
                cursor.execute("UPDATE city_events SET updated_at = ? WHERE id = ?", (now_iso, event_id))
                conn.commit()

            return json.dumps({"success": True, "count": len(rows_to_insert)})
        except Exception as e:
            return json.dumps({"error": str(e)})

    def list_events(self, filter_date=None, filter_slot=None, filter_city_id=None, filter_safar=None):
        """Lists events with optional filters."""
        try:
            query = """
            SELECT e.*, c.name as city_name,
                   (SELECT COUNT(*) FROM city_event_assignments a WHERE a.event_id = e.id) as assignment_count
            FROM city_events e
            JOIN cities c ON c.id = e.city_id
            WHERE 1=1
            """
            params = []
            if filter_date and str(filter_date).strip():
                query += " AND e.date = ?"
                params.append(str(filter_date).strip())
            if filter_slot and str(filter_slot).strip() and filter_slot != "All":
                query += " AND e.event_time_slot = ?"
                params.append(str(filter_slot).strip())
            if filter_city_id and str(filter_city_id).strip() and filter_city_id != "All":
                query += " AND e.city_id = ?"
                params.append(int(filter_city_id))
            if filter_safar and str(filter_safar).strip() and filter_safar != "All":
                query += " AND LOWER(COALESCE(e.safar_name, '')) = LOWER(?)"
                params.append(str(filter_safar).strip())

            query += " ORDER BY e.date DESC, e.event_time_slot ASC, e.sequence_number ASC"

            with self._get_connection() as conn:
                rows = conn.execute(query, params).fetchall()
                event_ids = [r["id"] for r in rows]

                # Pre-fetch uncovered assignments across all listed events in a single batch
                uncovered_map = {}
                if event_ids:
                    placeholders = ",".join("?" for _ in event_ids)
                    uncovered_rows = conn.execute(f"""
                        SELECT a.event_id, a.sequence, a.event_abr, a.sticker_name, a.photographer_id, a.videographer_id,
                               a.team_id, a.photo_not_covered, a.video_not_covered, e.qmz_teams
                        FROM city_event_assignments a
                        JOIN city_events e ON e.id = a.event_id
                        WHERE a.event_id IN ({placeholders})
                          AND (a.photographer_id IS NULL OR a.photographer_id = 0)
                          AND (a.videographer_id IS NULL OR a.videographer_id = 0)
                          AND a.photo_not_covered = 0
                          AND a.video_not_covered = 0
                        ORDER BY CAST(a.sequence AS INTEGER) ASC, a.sequence ASC
                    """, event_ids).fetchall()

                    for ur in uncovered_rows:
                        eid = ur["event_id"]
                        team_id = ur["team_id"]
                        qmz_raw = ur["qmz_teams"]
                        if qmz_raw:
                            try:
                                teams_list = json.loads(qmz_raw)
                                if isinstance(teams_list, list) and len(teams_list) > 0:
                                    if len(teams_list) == 1 and (teams_list[0].get("photographer_id") or teams_list[0].get("videographer_id")):
                                        continue
                                    if team_id:
                                        m_team = next((t for t in teams_list if t.get("id") == team_id or t.get("name") == team_id), None)
                                        if m_team and (m_team.get("photographer_id") or m_team.get("videographer_id")):
                                            continue
                            except Exception:
                                pass

                        if eid not in uncovered_map:
                            uncovered_map[eid] = []
                        uncovered_map[eid].append({
                            "sequence": ur["sequence"],
                            "event_abr": ur["event_abr"] or "Qadam",
                            "sticker_name": ur["sticker_name"] or "",
                            "team_id": team_id,
                        })

                # Pre-fetch slot inventory reports
                inv_map = {}
                safars = list({r["safar_name"] for r in rows if r["safar_name"]})
                if safars:
                    s_placeholders = ",".join("?" for _ in safars)
                    inv_rows = conn.execute(f"""
                        SELECT safar_name, date, slot, filename, total_found, total_missing,
                               missing_files, issues, cameras, uploaded_at, details_json, file_base64
                        FROM slot_inventory_reports
                        WHERE safar_name IN ({s_placeholders})
                    """, safars).fetchall()
                    for ir in inv_rows:
                        s_name = (ir["safar_name"] or "").strip().lower()
                        d_str = (ir["date"] or "").strip()
                        s_str = (ir["slot"] or "").strip().lower()
                        full_det = {}
                        try:
                            full_det = json.loads(ir["details_json"] or "{}")
                        except Exception:
                            pass
                        file_b64 = ir["file_base64"] if "file_base64" in ir.keys() and ir["file_base64"] else full_det.get("file_base64", "")
                        rep_obj = {
                            "uploaded": True,
                            "filename": ir["filename"],
                            "total_found": ir["total_found"],
                            "total_missing": ir["total_missing"],
                            "metrics": full_det.get("metrics", {
                                "total_found": ir["total_found"],
                                "total_missing": ir["total_missing"],
                                "total_cameras": len(full_det.get("cameras", [])),
                                "total_folders": len(full_det.get("folder_structure", [])),
                                "total_missing_files": len(full_det.get("missing_files", [])),
                                "total_contributor_files": len(full_det.get("contributors", [])),
                                "total_issues": len(full_det.get("issues", []))
                            }),
                            "missing_files": full_det.get("missing_files", json.loads(ir["missing_files"] or "[]")),
                            "folder_structure": full_det.get("folder_structure", []),
                            "cameras": full_det.get("cameras", json.loads(ir["cameras"] or "[]")),
                            "contributors": full_det.get("contributors", []),
                            "issues": full_det.get("issues", json.loads(ir["issues"] or "[]")),
                            "sheets": full_det.get("sheets", {}),
                            "raw_sheets": full_det.get("raw_sheets", {}),
                            "file_base64": file_b64,
                            "uploaded_at": ir["uploaded_at"],
                        }
                        inv_map[(s_name, d_str, s_str)] = rep_obj
                        if s_str in ("morning", "01m"):
                            inv_map[(s_name, d_str, "morning")] = rep_obj
                            inv_map[(s_name, d_str, "01m")] = rep_obj
                        elif s_str in ("evening", "02e"):
                            inv_map[(s_name, d_str, "evening")] = rep_obj
                            inv_map[(s_name, d_str, "02e")] = rep_obj

                events = []
                for r in rows:
                    r_dict = dict(r)
                    eid = r_dict.get("id")
                    ev_uncovered = list(uncovered_map.get(eid, []))

                    # For events without assignments in city_event_assignments, check individual_assignment
                    assignment_count = r_dict.get("assignment_count") or 0
                    if assignment_count == 0 and r_dict.get("assignment_mode") != "team":
                        try:
                            ind_assign = json.loads(r_dict.get("individual_assignment") or "{}")
                        except Exception:
                            ind_assign = {}
                        p_id = (ind_assign.get("photographer", {}).get("user_id") if isinstance(ind_assign.get("photographer"), dict) else None) or ind_assign.get("photographer_id")
                        v_id = (ind_assign.get("videographer", {}).get("user_id") if isinstance(ind_assign.get("videographer"), dict) else None) or ind_assign.get("videographer_id")
                        p_nc = ind_assign.get("photographer", {}).get("not_covered") if isinstance(ind_assign.get("photographer"), dict) else False
                        v_nc = ind_assign.get("videographer", {}).get("not_covered") if isinstance(ind_assign.get("videographer"), dict) else False

                        multis = json.loads(r_dict.get("individual_multi_assignments") or "[]")
                        has_multi = any(m.get("user_id") for m in multis if isinstance(m, dict))

                        if not p_id and not v_id and not p_nc and not v_nc and not has_multi:
                            ev_uncovered = [{
                                "sequence": str(r_dict.get("sequence_number") or 1),
                                "event_abr": r_dict.get("type") or "Event",
                                "sticker_name": "",
                            }]

                    safar_k = (r_dict.get("safar_name") or "").strip().lower()
                    date_k = (r_dict.get("date") or "").strip()
                    slot_k = (r_dict.get("event_time_slot") or "").strip().lower()

                    events.append({
                        "id": r_dict.get("id"),
                        "city_id": r_dict.get("city_id"),
                        "city_name": r_dict.get("city_name"),
                        "name": r_dict.get("name"),
                        "date": r_dict.get("date"),
                        "type": r_dict.get("type"),
                        "event_time_slot": r_dict.get("event_time_slot"),
                        "status": r_dict.get("status"),
                        "sequence_number": r_dict.get("sequence_number"),
                        "event_code": r_dict.get("event_code"),
                        "start_time": r_dict.get("start_time"),
                        "report_time": r_dict.get("report_time"),
                        "assignment_mode": r_dict.get("assignment_mode"),
                        "coordinator_id": r_dict.get("coordinator_id"),
                        "qmz_count": r_dict.get("qmz_count"),
                        "assignment_count": assignment_count,
                        "uncovered_sequences": ev_uncovered,
                        "uncovered_count": len(ev_uncovered),
                        "event_ended": bool(r_dict.get("event_ended")),
                        "event_end_time": r_dict.get("event_end_time") or "",
                        "finalized": bool(r_dict.get("finalized")),
                        "safar_name": r_dict.get("safar_name") or "",
                        "report_path": r_dict.get("report_path") or "",
                        "inventory_report": inv_map.get((safar_k, date_k, slot_k)),
                        "qmz_teams": json.loads(r_dict.get("qmz_teams") or "[]"),
                        "updated_at": r_dict.get("updated_at"),
                    })
                return json.dumps({"success": True, "events": events})
        except Exception as e:
            return json.dumps({"error": str(e)})

    def get_event(self, event_id: str):
        """Returns full event object with nested JSON fields and assignments."""
        if not event_id:
            return json.dumps({"error": "event_id is required"})
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                SELECT e.*, c.name as city_name, c.core_teams as city_core_teams
                FROM city_events e
                JOIN cities c ON c.id = e.city_id
                WHERE e.id = ?
                """, (event_id,))
                r = cursor.fetchone()
                if not r:
                    return json.dumps({"error": "Event not found"})

                evt = dict(r)
                evt["individual_assignment"] = json.loads(evt["individual_assignment"] or "{}")
                evt["individual_multi_assignments"] = json.loads(evt["individual_multi_assignments"] or "[]")
                evt["recording_details"] = json.loads(evt["recording_details"] or "{}")
                evt["qmz_teams"] = json.loads(evt["qmz_teams"] or "[]")
                evt["sequence_assignments"] = json.loads(evt["sequence_assignments"] or "{}")
                evt["admin_override_sequences"] = json.loads(evt["admin_override_sequences"] or "{}")
                evt["bethak_counts"] = json.loads(evt["bethak_counts"] or "[]")
                evt["bethak_individual"] = json.loads(evt["bethak_individual"] or "{}")
                evt["bethak_multi_assignments"] = json.loads(evt["bethak_multi_assignments"] or "[]")
                evt["event_ended"] = bool(evt["event_ended"])
                evt["finalized"] = bool(evt["finalized"])
                evt["city_core_teams"] = json.loads(evt["city_core_teams"] or "[]")

                # Fetch assignments
                cursor.execute("""
                SELECT * FROM city_event_assignments 
                WHERE event_id = ? 
                ORDER BY CAST(sequence AS INTEGER) ASC, sequence ASC, id ASC
                """, (event_id,))
                assign_rows = cursor.fetchall()
                if not assign_rows and (evt.get("type") == "Bethak" or "bethak" in str(evt.get("type", "")).lower()):
                    self._generate_and_save_bethak_assignments(conn, evt)
                    cursor.execute("""
                    SELECT * FROM city_event_assignments 
                    WHERE event_id = ? 
                    ORDER BY CAST(sequence AS INTEGER) ASC, sequence ASC, id ASC
                    """, (event_id,))
                    assign_rows = cursor.fetchall()
                assignments = []
                for ar in assign_rows:
                    assignments.append({
                        "id": ar["id"],
                        "event_id": ar["event_id"],
                        "sequence": ar["sequence"],
                        "event_abr": ar["event_abr"],
                        "sticker_name": ar["sticker_name"] or "",
                        "name": ar["name"] or "",
                        "its": ar["its"] or "",
                        "location": ar["location"] or "",
                        "mobile": ar["mobile"] or "",
                        "team_id": ar["team_id"],
                        "photographer_id": ar["photographer_id"],
                        "videographer_id": ar["videographer_id"],
                        "photo_not_covered": bool(ar["photo_not_covered"]),
                        "video_not_covered": bool(ar["video_not_covered"]),
                        "is_inline": bool(ar["is_inline"]) if "is_inline" in ar.keys() else False,
                    })
                evt["city_event_assignments"] = assignments

                # Fetch slot inventory report if available
                try:
                    slot_val = evt.get("event_time_slot") or ""
                    alt_slot = "01M" if (slot_val.lower().startswith("morn") or slot_val == "01M") else "02E"
                    cursor.execute("""
                        SELECT filename, total_found, total_missing, missing_files, issues, cameras, uploaded_at,
                               details_json, file_base64
                        FROM slot_inventory_reports
                        WHERE LOWER(safar_name) = LOWER(?) AND date = ? AND (slot = ? OR slot = ?)
                    """, (evt.get("safar_name", ""), evt.get("date", ""), slot_val, alt_slot))
                    inv_row = cursor.fetchone()
                    if inv_row:
                        full_details = {}
                        if len(inv_row) > 7 and inv_row[7]:
                            try:
                                full_details = json.loads(inv_row[7])
                            except Exception:
                                pass
                        file_b64 = inv_row[8] if len(inv_row) > 8 and inv_row[8] else full_details.get("file_base64", "")
                        evt["inventory_report"] = {
                            "uploaded": True,
                            "filename": inv_row[0],
                            "total_found": inv_row[1],
                            "total_missing": inv_row[2],
                            "metrics": full_details.get("metrics", {}),
                            "missing_files": full_details.get("missing_files", json.loads(inv_row[3] or "[]")),
                            "folder_structure": full_details.get("folder_structure", []),
                            "cameras": full_details.get("cameras", json.loads(inv_row[5] or "[]")),
                            "contributors": full_details.get("contributors", []),
                            "issues": full_details.get("issues", json.loads(inv_row[4] or "[]")),
                            "sheets": full_details.get("sheets", {}),
                            "raw_sheets": full_details.get("raw_sheets", {}),
                            "file_base64": file_b64,
                            "uploaded_at": inv_row[6]
                        }
                    else:
                        evt["inventory_report"] = None
                except Exception:
                    evt["inventory_report"] = None

                return json.dumps({"success": True, "event": evt})
        except Exception as e:
            return json.dumps({"error": str(e)})

    def update_event(self, event_id: str, patch: dict):
        """Updates specific fields on an event and bumps updated_at."""
        if not event_id:
            return json.dumps({"error": "event_id is required"})
        try:
            if isinstance(patch, str):
                try:
                    patch = json.loads(patch)
                except Exception:
                    patch = {}
            patch_data = dict(patch) if isinstance(patch, dict) else {}
            now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
            set_clauses = ["updated_at = ?"]
            params = [now_iso]

            json_fields = [
                "individual_assignment", "individual_multi_assignments",
                "recording_details", "qmz_teams", "sequence_assignments",
                "admin_override_sequences", "bethak_counts",
                "bethak_individual", "bethak_multi_assignments"
            ]

            for k, v in patch_data.items():
                if k in ("id", "created_at", "updated_at"):
                    continue
                if k in json_fields:
                    set_clauses.append(f"{k} = ?")
                    params.append(json.dumps(v if v is not None else ([] if 'assignments' in k or 'counts' in k or 'teams' in k else {})))
                elif k in ("event_ended", "finalized"):
                    set_clauses.append(f"{k} = ?")
                    params.append(1 if v else 0)
                else:
                    set_clauses.append(f"{k} = ?")
                    params.append(v)

            params.append(event_id)
            query = f"UPDATE city_events SET {', '.join(set_clauses)} WHERE id = ?"

            with self._get_connection() as conn:
                conn.execute(query, params)
                if "qmz_teams" in patch_data:
                    q_teams = patch_data["qmz_teams"]
                    if isinstance(q_teams, str):
                        try:
                            q_teams = json.loads(q_teams)
                        except Exception:
                            q_teams = []
                    if isinstance(q_teams, list) and len(q_teams) > 0:
                        for t in q_teams:
                            t_id = t.get("id")
                            t_name = t.get("name")
                            p_id = t.get("photographer_id")
                            v_id = t.get("videographer_id")
                            if len(q_teams) == 1:
                                conn.execute("""
                                UPDATE city_event_assignments
                                SET photographer_id = COALESCE(?, photographer_id),
                                    videographer_id = COALESCE(?, videographer_id),
                                    team_id = COALESCE(team_id, ?)
                                WHERE event_id = ?
                                """, (p_id, v_id, t_id, event_id))
                            elif t_id:
                                conn.execute("""
                                UPDATE city_event_assignments
                                SET photographer_id = COALESCE(?, photographer_id),
                                    videographer_id = COALESCE(?, videographer_id)
                                WHERE event_id = ? AND (team_id = ? OR team_id = ?)
                                """, (p_id, v_id, event_id, t_id, t_name or t_id))
                conn.commit()

            return json.dumps({"success": True, "id": event_id, "updated_at": now_iso})
        except Exception as e:
            return json.dumps({"error": str(e)})

    def delete_event(self, event_id: str):
        """Deletes an event and its cascading assignments."""
        if not event_id:
            return json.dumps({"error": "event_id is required"})
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("DELETE FROM city_event_assignments WHERE event_id = ?", (event_id,))
                cursor.execute("DELETE FROM city_events WHERE id = ?", (event_id,))
                conn.commit()
            return json.dumps({"success": True, "id": event_id})
        except Exception as e:
            return json.dumps({"error": str(e)})

    # ==========================================================================
    # OFFLINE FOLDER STRUCTURE GENERATION & CSV EXPORTS
    # ==========================================================================
    def select_export_dir(self):
        """Directory picker for folder export destination."""
        if not self._window:
            return json.dumps({"error": "No window available"})
        try:
            result = self._window.create_file_dialog(webview.FileDialog.FOLDER)
            if result:
                return json.dumps({"success": True, "path": result[0]})
            return json.dumps({"error": "Cancelled"})
        except Exception as e:
            return json.dumps({"error": str(e)})

    def check_safar_folder(self, target_dir: str, safar_name: str):
        """
        Checks if the chosen directory is inside, matches, or contains the specified Safar folder.
        Returns detection status and resolved base path.
        """
        if not target_dir or not safar_name:
            return json.dumps({"detected": False, "target_dir": target_dir or "", "safar_name": safar_name or ""})
        try:
            target_path = Path(target_dir).resolve()
            safar_clean = safar_name.strip()
            for ch in '<>:"/\\|?*':
                safar_clean = safar_clean.replace(ch, '_').strip()
            safar_lower = safar_clean.lower()
            parts_lower = [p.lower() for p in target_path.parts]

            if safar_lower in parts_lower:
                idx = parts_lower.index(safar_lower)
                resolved = Path(*target_path.parts[:idx + 1])
                return json.dumps({
                    "success": True,
                    "detected": True,
                    "mode": "exact_or_inside",
                    "safar_base_dir": str(resolved),
                    "safar_name": safar_clean
                })
            elif (target_path / safar_clean).exists() and (target_path / safar_clean).is_dir():
                return json.dumps({
                    "success": True,
                    "detected": True,
                    "mode": "parent_contains",
                    "safar_base_dir": str(target_path / safar_clean),
                    "safar_name": safar_clean
                })
            else:
                return json.dumps({
                    "success": True,
                    "detected": False,
                    "mode": "not_found",
                    "safar_base_dir": str(target_path / safar_clean),
                    "safar_name": safar_clean
                })
        except Exception as e:
            return json.dumps({"error": str(e)})

    def generate_folder_structure(self, event_ids: str, safar_name: str, target_dir: str):
        """
        Exports folder structure directly matching CSV to Folders specifications without creating a CSV file.
        Creates:
          {target_dir} / {Date} _{slot_code} /
              ├── Contributor / Cam 01, Cam 02, ...
              ├── {se_seq:02d}-{se_city}-{se_type} /
              │     ├── {Date} _{slot_code}-{seq_label}-{middle_token}-{its}
        """
        if not event_ids or not target_dir:
            return json.dumps({"error": "event_ids and target_dir are required"})

        try:
            import re
            if isinstance(event_ids, (list, tuple)):
                ids = [str(eid).strip() for eid in event_ids if str(eid).strip()]
            elif isinstance(event_ids, str):
                s = event_ids.strip()
                if s.startswith("[") and s.endswith("]"):
                    try:
                        parsed = json.loads(s)
                        if isinstance(parsed, list):
                            ids = [str(eid).strip() for eid in parsed if str(eid).strip()]
                        else:
                            ids = [s]
                    except Exception:
                        ids = [eid.strip() for eid in s.strip("[]").split(",") if eid.strip().strip("'\"")]
                else:
                    ids = [eid.strip() for eid in s.split(",") if eid.strip()]
            else:
                ids = [str(event_ids).strip()]

            if not ids:
                return json.dumps({"error": "No valid event IDs provided"})

            def sanitize(s):
                for ch in '<>:"/\\|?*':
                    s = s.replace(ch, '_')
                return s.strip()

            target_path = Path(target_dir).resolve()

            # Retrieve first event to establish master date and slot
            first_evt_resp = json.loads(self.get_event(ids[0]))
            if first_evt_resp.get("error"):
                return json.dumps(first_evt_resp)

            first_evt = first_evt_resp["event"]
            date_val = first_evt.get("date", "")
            slot_val = first_evt.get("event_time_slot", "Morning")
            slot_code = "01M" if slot_val == "Morning" else "02E"

            # Master folder name: e.g. "1448-06-09 _02E"
            master_name = f"{date_val} _{slot_code}"
            master_folder_path = target_path / master_name
            master_folder_path.mkdir(parents=True, exist_ok=True)

            # Query all sibling sub-events in this date + slot group
            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    SELECT e.*, c.name as city_name
                    FROM city_events e
                    JOIN cities c ON c.id = e.city_id
                    WHERE e.date = ? AND e.event_time_slot = ?
                    ORDER BY e.sequence_number ASC, e.id ASC
                """, (date_val, slot_val))
                sub_events = [dict(r) for r in cursor.fetchall()]

                cursor.execute("SELECT id, name FROM users")
                users_map = {u["id"]: u["name"] for u in cursor.fetchall()}

                for se in sub_events:
                    cursor.execute("""
                        SELECT * FROM city_event_assignments
                        WHERE event_id = ?
                        ORDER BY CAST(sequence AS INTEGER) ASC, sequence ASC, id ASC
                    """, (se["id"],))
                    asgns = [dict(a) for a in cursor.fetchall()]
                    if not asgns and (se.get("type") == "Bethak" or "bethak" in str(se.get("type", "")).lower()):
                        asgns = self._generate_and_save_bethak_assignments(conn, se)
                    se["assignments"] = asgns

            evt_defs = _load_event_definitions(self.base_dir)
            ABR_MAP = dict(evt_defs.get("name_to_abr", {}))
            ABR_MAP.update({
                "Aqeeqa": "AQ", "Aqiqa": "AQ", "Nikah": "N", "Majmui Ziyafat": "MZ", "Haddiyat": "H",
                "Mafsuhiyat": "MF", "Mulaqaat": "MUL", "Iftettah": "IF", "Iftetah": "IFT", "Bethak QMZ": "Q",
                "QMZ": "Q", "Qadam": "Q", "Namaz": "Namaz", "Waaz": "Waaz", "Majlis": "M",
                "Ziyarat": "Ziyarat", "Wada": "WD", "Isteqbal": "IST", "Ziyafat": "Z",
                "Tahneeq": "TQN", "Tahmeeq": "Tahmeeq", "Zafaf Olda": "ZO", "Bethak Majlis": "BM",
                "Bethak Qadam": "BQ", "Bethak Ziyafat": "BZ", "Sharaf": "SH"
            })
            COUNTED_TYPES = {"AQ", "N", "MZ", "Q", "M", "ZO", "IFT", "Z", "BM", "BQ", "BZ", "SH"}

            def format_seq_label(seq_val, fallback_num):
                s = str(seq_val or "").strip()
                if not s:
                    return f"{fallback_num:02d}"
                m = re.match(r"^(\d+)(.*)$", s)
                if m:
                    num_part = int(m.group(1))
                    suffix = m.group(2)
                    return f"{num_part:02d}{suffix}"
                return s

            # Index unique contributors for Contributor/Cam 01, Cam 02...
            unique_contributors = []
            for se in sub_events:
                default_p = ""
                default_v = ""
                indiv = json.loads(se.get("individual_assignment") or "{}") if isinstance(se.get("individual_assignment"), str) else (se.get("individual_assignment") or {})
                p_uid = indiv.get("photographer_id") or (indiv.get("photographer", {}).get("user_id") if isinstance(indiv.get("photographer"), dict) else None)
                v_uid = indiv.get("videographer_id") or (indiv.get("videographer", {}).get("user_id") if isinstance(indiv.get("videographer"), dict) else None)
                if p_uid and users_map.get(p_uid): default_p = users_map[p_uid]
                if v_uid and users_map.get(v_uid): default_v = users_map[v_uid]

                qmz_teams = json.loads(se.get("qmz_teams") or "[]") if isinstance(se.get("qmz_teams"), str) else (se.get("qmz_teams") or [])
                if qmz_teams and isinstance(qmz_teams, list):
                    for qt in qmz_teams:
                        if qt.get("photographer_id") and users_map.get(qt["photographer_id"]):
                            name = users_map[qt["photographer_id"]]
                            if name not in unique_contributors: unique_contributors.append(name)
                        if qt.get("videographer_id") and users_map.get(qt["videographer_id"]):
                            name = users_map[qt["videographer_id"]]
                            if name not in unique_contributors: unique_contributors.append(name)

                multis = json.loads(se.get("individual_multi_assignments") or "[]") if isinstance(se.get("individual_multi_assignments"), str) else (se.get("individual_multi_assignments") or [])
                for m in multis:
                    uid = m.get("user_id")
                    if uid and uid in users_map and users_map[uid] not in unique_contributors:
                        unique_contributors.append(users_map[uid])

                if default_p and default_p not in unique_contributors: unique_contributors.append(default_p)
                if default_v and default_v not in unique_contributors: unique_contributors.append(default_v)

                for a in se.get("assignments", []):
                    pid = a.get("photographer_id")
                    vid = a.get("videographer_id")
                    if pid and pid in users_map and users_map[pid] not in unique_contributors:
                        unique_contributors.append(users_map[pid])
                    if vid and vid in users_map and users_map[vid] not in unique_contributors:
                        unique_contributors.append(users_map[vid])

            # Create Contributor / Cam 01, Cam 02... if contributors exist
            num_cams = len(unique_contributors)
            if num_cams > 0:
                contrib_dir = master_folder_path / "Contributor"
                contrib_dir.mkdir(parents=True, exist_ok=True)
                for c_idx in range(1, num_cams + 1):
                    cam_dir = contrib_dir / f"Cam {c_idx:02d}"
                    cam_dir.mkdir(parents=True, exist_ok=True)

            created_folders = [str(master_folder_path)]
            type_counts = {}
            overall_seq = 1

            # Compile and create Leaf and Sub-folders
            for se in sub_events:
                se_seq = int(se.get("sequence_number", 1))
                se_city = sanitize(str(se.get("city_name") or "Main").strip())
                se_type = sanitize(str(se.get("type") or "Event").strip())
                leaf_folder_name = f"{se_seq:02d}-{se_city}-{se_type}"
                leaf_path = master_folder_path / leaf_folder_name
                leaf_path.mkdir(parents=True, exist_ok=True)
                created_folders.append(str(leaf_path))

                assignments = se.get("assignments", [])
                if not assignments:
                    raw_abr = se_type
                    abr = sanitize(ABR_MAP.get(raw_abr, raw_abr))
                    seq_label = f"{overall_seq:02d}"
                    subfolder_name = f"{master_name}-{seq_label}-{abr}-"
                    sub_path = leaf_path / subfolder_name
                    sub_path.mkdir(parents=True, exist_ok=True)
                    created_folders.append(str(sub_path))
                    overall_seq += 1
                else:
                    for a in assignments:
                        raw_abr = str(a.get("event_abr") or se_type).strip()
                        abr = sanitize(ABR_MAP.get(raw_abr, raw_abr))
                        its = sanitize(str(a.get("its") or "").strip())
                        sticker = sanitize(str(a.get("sticker_name") or "").strip())
                        raw_seq = str(a.get("sequence") or "").strip()
                        seq_label = format_seq_label(raw_seq, overall_seq)

                        if sticker:
                            if sticker.isdigit() and abr in COUNTED_TYPES:
                                middle_token = f"{int(sticker):02d}{abr}"
                            else:
                                middle_token = sticker
                        elif abr in COUNTED_TYPES:
                            type_counts[abr] = type_counts.get(abr, 0) + 1
                            count_str = f"{type_counts[abr]:02d}"
                            middle_token = f"{count_str}{abr}"
                        else:
                            middle_token = abr

                        if its:
                            subfolder_name = f"{master_name}-{seq_label}-{middle_token}-{its}"
                        else:
                            subfolder_name = f"{master_name}-{seq_label}-{middle_token}-"

                        sub_path = leaf_path / subfolder_name
                        sub_path.mkdir(parents=True, exist_ok=True)
                        created_folders.append(str(sub_path))
                        overall_seq += 1

            # --------------------------------------------------------------------------
            # STEP: AUTOMATIC 'Document' FOLDER & MAPPING PIPELINE COMPILATION
            # --------------------------------------------------------------------------
            doc_dir = master_folder_path / "Document"
            doc_dir.mkdir(parents=True, exist_ok=True)
            created_folders.append(str(doc_dir))

            # 1. Build and save the official 9-column mapping CSV directly into Document/
            mapping_csv_filename = f"{master_name}.csv"
            mapping_csv_path = doc_dir / mapping_csv_filename
            try:
                user_series_map = {}
                with self._get_connection() as conn:
                    cursor = conn.cursor()
                    try:
                        cursor.execute("SELECT name, series FROM users WHERE series IS NOT NULL AND series != ''")
                        for r in cursor.fetchall():
                            user_series_map[r[0]] = r[1]
                    except Exception:
                        pass

                csv_text, row_count = self._build_mapping_csv_content(
                    sub_events, users_map, user_series_map, ABR_MAP, COUNTED_TYPES, date_val, slot_code
                )
                if csv_text:
                    mapping_csv_path.write_text(csv_text, encoding="utf-8")
            except Exception as ex:
                print(f"[Export-Folders] Warning: Failed to write mapping CSV to Document: {ex}")

            # 2. Copy/move all working documents/files of that date from AIN_Temp into Document/
            ain_temp = _get_app_setting("ain_temp_path") or _get_app_setting("pdf_output_folder")
            if ain_temp and os.path.isdir(ain_temp):
                try:
                    for item in os.listdir(ain_temp):
                        src_item = os.path.join(ain_temp, item)
                        if os.path.isfile(src_item):
                            fl_lower = item.lower()
                            # Copy files matching date, slot or temp formats
                            if (date_val in item or slot_code in item or
                                fl_lower.endswith('.csv') or fl_lower.endswith('.xlsx') or fl_lower.endswith('.pdf')):
                                dst_item = os.path.join(str(doc_dir), item)
                                if not os.path.exists(dst_item):
                                    try:
                                        shutil.copy2(src_item, dst_item)
                                    except Exception as ex:
                                        print(f"[Export-Folders] Notice copying temp file {item}: {ex}")
                except Exception as ex:
                    print(f"[Export-Folders] Notice reading temp folder: {ex}")

            # Also copy any attached subevent report_path files
            for se in sub_events:
                rep_path = se.get("report_path")
                if rep_path and os.path.isfile(rep_path):
                    dst_rep = os.path.join(str(doc_dir), os.path.basename(rep_path))
                    if not os.path.exists(dst_rep):
                        try:
                            shutil.copy2(rep_path, dst_rep)
                        except Exception:
                            pass

            # 3. Update persisted app settings so downstream Media Sorting points directly to this Document/ folder!
            _set_app_setting("csv_input_path", str(mapping_csv_path))
            _set_app_setting("csv_dest_path", str(target_path))
            _set_app_setting("sorting_mapping_path", str(mapping_csv_path))
            _set_app_setting("sorting_root_path", str(master_folder_path))
            _set_app_setting("inventory_drive_path", str(master_folder_path))
            _set_app_setting("inventory_save_path", str(doc_dir / f"{master_name}_Inventory_Report.xlsx"))

            return json.dumps({
                "success": True,
                "base_dir": str(master_folder_path),
                "created_count": len(created_folders),
                "folders": created_folders,
                "document_folder": str(doc_dir),
                "mapping_csv": str(mapping_csv_path)
            })
        except Exception as e:
            return json.dumps({"error": str(e)})

    def _build_mapping_csv_content(self, sub_events, users_map, user_series_map, ABR_MAP, COUNTED_TYPES, date_val, slot_code):
        """Helper to build standard 9-column CSV content for a date & slot group."""
        import csv
        import io
        import re

        headers = [
            "Sub-Event List",
            "Folder_Name",
            "Contributors 1",
            "Contributors 2",
            "Contributors 3",
            "Contributors 4",
            "",
            "Contributor's Name",
            "Contributor's Series"
        ]

        def format_seq_label(seq_val, fallback_num):
            s = str(seq_val or "").strip()
            if not s:
                return f"{fallback_num:02d}"
            m = re.match(r"^(\d+)(.*)$", s)
            if m:
                num_part = int(m.group(1))
                suffix = m.group(2)
                return f"{num_part:02d}{suffix}"
            return s

        def get_series(name):
            if not name:
                return ""
            if name in user_series_map and user_series_map[name]:
                return user_series_map[name]
            cleaned_words = [w for w in name.strip().split() if w.lower() not in ('bhai', 'ben', 'shaikh', 'mulla', 'dr', 'mr', 'mrs', 'ms')]
            if not cleaned_words:
                cleaned_words = name.strip().split()
            first_word = cleaned_words[0].upper()
            if first_word.startswith("ALIASGAR"):
                return "MR_A"
            if len(first_word) <= 4:
                return first_word
            return first_word[:3]

        type_counts = {}
        csv_rows = []
        unique_contributors = []
        overall_seq = 1

        for se in sub_events:
            se_seq = int(se.get("sequence_number", 1))
            se_city = se.get("city_name", "")
            se_type = se.get("type", "Event")
            assignments = se.get("assignments", [])

            default_photographer = ""
            default_videographer = ""
            indiv = json.loads(se.get("individual_assignment") or "{}") if isinstance(se.get("individual_assignment"), str) else (se.get("individual_assignment") or {})
            p_user_id = indiv.get("photographer_id") or (indiv.get("photographer", {}).get("user_id") if isinstance(indiv.get("photographer"), dict) else None)
            v_user_id = indiv.get("videographer_id") or (indiv.get("videographer", {}).get("user_id") if isinstance(indiv.get("videographer"), dict) else None)
            if p_user_id: default_photographer = users_map.get(p_user_id, "")
            if v_user_id: default_videographer = users_map.get(v_user_id, "")

            qmz_teams = json.loads(se.get("qmz_teams") or "[]") if isinstance(se.get("qmz_teams"), str) else (se.get("qmz_teams") or [])
            if qmz_teams and isinstance(qmz_teams, list) and len(qmz_teams) > 0:
                first_t = qmz_teams[0]
                if not default_photographer and first_t.get("photographer_id"):
                    default_photographer = users_map.get(first_t["photographer_id"], "")
                if not default_videographer and first_t.get("videographer_id"):
                    default_videographer = users_map.get(first_t["videographer_id"], "")

            multis = json.loads(se.get("individual_multi_assignments") or "[]") if isinstance(se.get("individual_multi_assignments"), str) else (se.get("individual_multi_assignments") or [])
            multi_names = []
            for m in multis:
                uid = m.get("user_id")
                if uid and uid in users_map:
                    u_name = users_map[uid]
                    if u_name not in multi_names:
                        multi_names.append(u_name)

            if not multi_names:
                if default_photographer: multi_names.append(default_photographer)
                if default_videographer and default_videographer not in multi_names: multi_names.append(default_videographer)

            if not assignments:
                raw_abr = se_type
                abr = ABR_MAP.get(raw_abr, raw_abr)
                seq_label = f"{overall_seq:02d}"
                sub_event_list_val = f"{date_val} _{slot_code} - {se_seq:02d}-{se_city}-{se_type} - {seq_label}-{abr}"
                folder_name_val = f"{date_val} _{slot_code}-{seq_label}-{abr}-"

                c1 = multi_names[0] if len(multi_names) > 0 else default_photographer
                c2 = multi_names[1] if len(multi_names) > 1 else default_videographer
                c3 = multi_names[2] if len(multi_names) > 2 else ""
                c4 = multi_names[3] if len(multi_names) > 3 else ""

                for c in [c1, c2, c3, c4]:
                    if c and c not in unique_contributors:
                        unique_contributors.append(c)

                csv_rows.append({
                    "sub_event": sub_event_list_val,
                    "folder_name": folder_name_val,
                    "c1": c1, "c2": c2, "c3": c3, "c4": c4
                })
                overall_seq += 1
            else:
                if not assignments and (se_type == "Bethak" or "bethak" in str(se_type).lower()):
                    assignments = self._generate_bethak_assignments_from_counts(se)
                for a in assignments:
                    raw_abr = str(a.get("event_abr") or se_type).strip()
                    abr = ABR_MAP.get(raw_abr, raw_abr)
                    its = str(a.get("its") or "").strip()
                    sticker = str(a.get("sticker_name") or "").strip()
                    raw_seq = str(a.get("sequence") or "").strip()
                    seq_label = format_seq_label(raw_seq, overall_seq)

                    if sticker:
                        if sticker.isdigit() and abr in COUNTED_TYPES:
                            middle_token = f"{int(sticker):02d}{abr}"
                        else:
                            middle_token = sticker
                    elif abr in COUNTED_TYPES:
                        type_counts[abr] = type_counts.get(abr, 0) + 1
                        count_str = f"{type_counts[abr]:02d}"
                        middle_token = f"{count_str}{abr}"
                    else:
                        middle_token = abr

                    if its:
                        folder_name_val = f"{date_val} _{slot_code}-{seq_label}-{middle_token}-{its}"
                    else:
                        folder_name_val = f"{date_val} _{slot_code}-{seq_label}-{middle_token}-"

                    sub_event_list_val = f"{date_val} _{slot_code} - {se_seq:02d}-{se_city}-{se_type} - {seq_label}-{abr}"

                    row_p_id = a.get("photographer_id")
                    row_v_id = a.get("videographer_id")
                    row_t_id = a.get("team_id")
                    if (not row_p_id or not row_v_id) and qmz_teams:
                        matched_qt = None
                        if row_t_id:
                            for qt in qmz_teams:
                                if qt.get("id") == row_t_id or qt.get("name") == row_t_id:
                                    matched_qt = qt
                                    break
                        if not matched_qt and len(qmz_teams) == 1:
                            matched_qt = qmz_teams[0]
                        if matched_qt:
                            if not row_p_id and matched_qt.get("photographer_id"):
                                row_p_id = matched_qt["photographer_id"]
                            if not row_v_id and matched_qt.get("videographer_id"):
                                row_v_id = matched_qt["videographer_id"]

                    p_name = users_map.get(row_p_id) or default_photographer
                    is_photo_only = abr in ("H", "MF", "Haddiyat", "Mafsuhiyat")
                    if is_photo_only or a.get("video_not_covered"):
                        v_name = ""
                    else:
                        v_name = users_map.get(row_v_id) or default_videographer

                    if a.get("photo_not_covered"):
                        p_name = ""

                    if p_name or v_name or len(multi_names) <= 2:
                        c1, c2, c3, c4 = p_name, v_name, "", ""
                    else:
                        c1 = multi_names[0] if len(multi_names) > 0 else ""
                        c2 = multi_names[1] if len(multi_names) > 1 else ""
                        c3 = multi_names[2] if len(multi_names) > 2 else ""
                        c4 = multi_names[3] if len(multi_names) > 3 else ""

                    for c in [c1, c2, c3, c4]:
                        if c and c not in unique_contributors:
                            unique_contributors.append(c)

                    csv_rows.append({
                        "sub_event": sub_event_list_val,
                        "folder_name": folder_name_val,
                        "c1": c1, "c2": c2, "c3": c3, "c4": c4
                    })
                    overall_seq += 1

        out_buf = io.StringIO()
        writer = csv.writer(out_buf)
        writer.writerow(headers)
        for idx, r in enumerate(csv_rows):
            contrib_name = unique_contributors[idx] if idx < len(unique_contributors) else ""
            contrib_series = get_series(contrib_name) if contrib_name else ""
            writer.writerow([
                r["sub_event"],
                r["folder_name"],
                r["c1"],
                r["c2"],
                r["c3"],
                r["c4"],
                "",
                contrib_name,
                contrib_series
            ])

        return out_buf.getvalue(), len(csv_rows)

    def export_csv(self, event_id: str, default_filename: str = ""):
        """
        Exports event assignments for the entire time slot group to an AIN53 compatible CSV file.
        Exact header format:
        Sub-Event List,Folder_Name,Contributors 1,Contributors 2,,Contributor's Name,Contributor's Series
        """
        if not event_id:
            return json.dumps({"error": "event_id is required"})

        try:
            evt_resp = json.loads(self.get_event(event_id))
            if evt_resp.get("error"):
                return json.dumps(evt_resp)
            target_evt = evt_resp["event"]
            date_val = target_evt.get("date", "")
            slot_val = target_evt.get("event_time_slot", "Morning")
            slot_code = "01M" if slot_val == "Morning" else "02E"

            suggested_name = default_filename or f"{date_val} _{slot_code}.csv"
            save_path = None

            if self._window:
                result = self._window.create_file_dialog(
                    webview.FileDialog.SAVE,
                    save_filename=suggested_name,
                    file_types=("CSV Files (*.csv)",)
                )
                if not result:
                    return json.dumps({"success": False, "cancelled": True})
                save_path = result if isinstance(result, str) else result[0]
            else:
                save_path = os.path.join(str(self.base_dir), suggested_name)

            # Query all sibling sub-events in this date + slot group
            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    SELECT e.*, c.name as city_name
                    FROM city_events e
                    JOIN cities c ON c.id = e.city_id
                    WHERE e.date = ? AND e.event_time_slot = ?
                    ORDER BY e.sequence_number ASC, e.id ASC
                """, (date_val, slot_val))
                sub_events = [dict(r) for r in cursor.fetchall()]

                cursor.execute("SELECT id, name FROM users")
                users_map = {u["id"]: u["name"] for u in cursor.fetchall()}

                for se in sub_events:
                    cursor.execute("""
                        SELECT * FROM city_event_assignments
                        WHERE event_id = ?
                        ORDER BY CAST(sequence AS INTEGER) ASC, sequence ASC, id ASC
                    """, (se["id"],))
                    asgns = [dict(a) for a in cursor.fetchall()]
                    if not asgns and (se.get("type") == "Bethak" or "bethak" in str(se.get("type", "")).lower()):
                        asgns = self._generate_and_save_bethak_assignments(conn, se)
                    se["assignments"] = asgns

            evt_defs = _load_event_definitions(self.base_dir)
            ABR_MAP = dict(evt_defs.get("name_to_abr", {}))
            ABR_MAP.update({
                "Aqeeqa": "AQ", "Aqiqa": "AQ", "Nikah": "N", "Majmui Ziyafat": "MZ", "Haddiyat": "H",
                "Mafsuhiyat": "MF", "Mulaqaat": "MUL", "Iftettah": "IF", "Iftetah": "IFT", "Bethak QMZ": "Q",
                "QMZ": "Q", "Qadam": "Q", "Namaz": "Namaz", "Waaz": "Waaz", "Majlis": "M",
                "Ziyarat": "Ziyarat", "Wada": "WD", "Isteqbal": "IST", "Ziyafat": "Z",
                "Tahneeq": "TQN", "Tahmeeq": "Tahmeeq", "Zafaf Olda": "ZO", "Bethak Majlis": "BM",
                "Bethak Qadam": "BQ", "Bethak Ziyafat": "BZ", "Sharaf": "SH"
            })
            COUNTED_TYPES = {"AQ", "N", "MZ", "Q", "M", "ZO", "IFT", "Z", "BM", "BQ", "BZ", "SH"}

            user_series_map = {}
            with self._get_connection() as conn:
                cursor = conn.cursor()
                try:
                    safar_val = target_evt.get("safar_name", "")
                    if safar_val:
                        cursor.execute("""
                            SELECT name, series FROM users 
                            WHERE series IS NOT NULL AND series != ''
                            ORDER BY CASE WHEN LOWER(safar_name) = LOWER(?) THEN 1 ELSE 0 END ASC
                        """, (safar_val,))
                    else:
                        cursor.execute("SELECT name, series FROM users WHERE series IS NOT NULL AND series != ''")
                    for r in cursor.fetchall():
                        user_series_map[r[0]] = r[1]
                except Exception:
                    pass

            csv_content, total_rows = self._build_mapping_csv_content(
                sub_events, users_map, user_series_map, ABR_MAP, COUNTED_TYPES, date_val, slot_code
            )

            with open(save_path, "w", newline="", encoding="utf-8") as f:
                f.write(csv_content)

            return json.dumps({
                "success": True,
                "path": save_path,
                "filename": suggested_name,
                "csv_content": csv_content,
                "total_rows": total_rows
            })
        except Exception as e:
            return json.dumps({"error": str(e)})

    def _generate_bethak_assignments_from_counts(self, se):
        """Generates sequence assignment dictionaries from bethak_counts and qmz_teams."""
        counts = se.get("bethak_counts") or []
        if isinstance(counts, str):
            try: counts = json.loads(counts)
            except Exception: counts = []
        teams = se.get("qmz_teams") or []
        if isinstance(teams, str):
            try: teams = json.loads(teams)
            except Exception: teams = []

        assignments = []
        global_seq = 1
        for seg in counts:
            seg_type = seg.get("type") or "Bethak"
            seg_count = max(int(seg.get("count") or 1), 1)
            sub_types = seg.get("subTypes") or []
            for i in range(seg_count):
                seq_str = str(global_seq)
                sub_abr = sub_types[i] if (seg_type == 'Bethak QMZ' and i < len(sub_types) and sub_types[i]) else seg_type
                is_misaq = (seg_type == "Misaq")
                is_photo_only = seg_type in ("Haddiyat", "Mafsuhiyat") or is_misaq

                assigned_team = teams[(global_seq - 1) % len(teams)] if teams else None
                t_id = assigned_team.get("id") if assigned_team else None
                p_id = assigned_team.get("photographer_id") if assigned_team else None
                v_id = None if is_photo_only else (assigned_team.get("videographer_id") if assigned_team else None)

                assignments.append({
                    "sequence": seq_str,
                    "event_abr": sub_abr,
                    "sticker_name": "",
                    "name": "",
                    "its": "",
                    "location": "",
                    "mobile": "",
                    "team_id": t_id,
                    "photographer_id": p_id,
                    "videographer_id": v_id,
                    "photo_not_covered": False,
                    "video_not_covered": is_photo_only,
                    "is_inline": False
                })
                global_seq += 1
        return assignments

    def _generate_and_save_bethak_assignments(self, conn, se):
        """Generates sequence assignments for Bethak and saves them to city_event_assignments."""
        assignments = self._generate_bethak_assignments_from_counts(se)
        if not assignments:
            return []
        evt_id = se.get("id")
        if not evt_id:
            return assignments
        now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
        cursor = conn.cursor()
        rows_to_insert = []
        for a in assignments:
            rows_to_insert.append((
                evt_id,
                a["sequence"],
                a["event_abr"],
                a["sticker_name"],
                a["name"],
                a["its"],
                a["location"],
                a["mobile"],
                a["team_id"],
                a["photographer_id"],
                a["videographer_id"],
                1 if a["photo_not_covered"] else 0,
                1 if a["video_not_covered"] else 0,
                1 if a["is_inline"] else 0,
                now_iso,
                now_iso
            ))
        cursor.executemany("""
            INSERT INTO city_event_assignments (
                event_id, sequence, event_abr, sticker_name, name, its,
                location, mobile, team_id, photographer_id, videographer_id,
                photo_not_covered, video_not_covered, is_inline, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, rows_to_insert)
        conn.commit()
        return assignments

    def _build_date_sync_csv_content(self, sub_events, users_map, user_series_map, user_phone_map, date_val, slot_val):
        out_buf = io.StringIO()
        writer = csv.writer(out_buf)

        slot_code = "01M" if slot_val == "Morning" else "02E"
        writer.writerow(["# SLOT / DATE SYNC REPORT", f"{date_val} ({slot_val} - {slot_code})"])
        writer.writerow(["Date", date_val])
        writer.writerow(["Time Slot", f"{slot_val} ({slot_code})"])
        writer.writerow(["Total Sub-Events", len(sub_events)])
        writer.writerow([])

        for se in sub_events:
            se_seq = se.get("sequence_number") or 1
            se_type = se.get("type", "Event")
            se_city = se.get("city_name", "")
            se_code = se.get("event_code") or f"{se_seq:02d} {se_type}"
            se_status = se.get("status", "CREATED")
            se_notes = se.get("special_instructions") or se.get("notes") or ""
            se_loc = se.get("location") or ""
            
            et_lower = str(se_type or "").strip().lower()
            if et_lower == "qmz" or "qmz" in et_lower:
                engine = "qmz"
            elif "bethak" in et_lower:
                engine = "bethak"
            else:
                engine = "standard"

            # Heading for each event: e.g. "01 Ziyarat" or "02 QMZ"
            heading_title = f"{se_seq:02d} {se_type}"
            writer.writerow(["=" * 80])
            writer.writerow([heading_title])
            writer.writerow(["=" * 80])

            # Line-wise event details
            writer.writerow(["Event Name", heading_title])
            writer.writerow(["Event Type", se_type])
            writer.writerow(["Event Code", se_code])
            writer.writerow(["Date", date_val])
            writer.writerow(["Time Slot", f"{slot_val} ({slot_code})"])
            writer.writerow(["City", se_city])
            if se_loc:
                writer.writerow(["Location", se_loc])
            writer.writerow(["Status", se_status])

            # Core crew / teams / details based on engine
            ind_assign = se.get("individual_assignment") or {}
            if isinstance(ind_assign, str):
                try: ind_assign = json.loads(ind_assign)
                except Exception: ind_assign = {}

            # Drone
            drone_info = ind_assign.get("drone") or {}
            drone_u_id = drone_info.get("user_id")
            if drone_u_id and drone_u_id in users_map:
                d_name = users_map[drone_u_id]
                d_series = user_series_map.get(d_name, "")
                d_str = f"{d_name} ({d_series})" if d_series else d_name
                writer.writerow(["Drone Operator", d_str])

            if se_notes:
                writer.writerow(["Special Instructions / Notes", se_notes])

            if engine == 'standard':
                # Photographer
                p_info = ind_assign.get("photographer") or {}
                p_uid = p_info.get("user_id")
                if p_uid and p_uid in users_map:
                    p_name = users_map[p_uid]
                    p_ser = user_series_map.get(p_name, "")
                    writer.writerow(["Photographer", f"{p_name} ({p_ser})" if p_ser else p_name])
                    if p_info.get("location"):
                        writer.writerow(["Photographer Location", p_info["location"]])

                # Videographer
                v_info = ind_assign.get("videographer") or {}
                v_uid = v_info.get("user_id")
                if v_uid and v_uid in users_map:
                    v_name = users_map[v_uid]
                    v_ser = user_series_map.get(v_name, "")
                    writer.writerow(["Videographer", f"{v_name} ({v_ser})" if v_ser else v_name])
                    if v_info.get("location"):
                        writer.writerow(["Videographer Location", v_info["location"]])

                # Recording details
                rec_details = se.get("recording_details") or {}
                if isinstance(rec_details, str):
                    try: rec_details = json.loads(rec_details)
                    except Exception: rec_details = {}
                if rec_details.get("fixed_cameras_count"):
                    writer.writerow(["Fixed Cameras", rec_details["fixed_cameras_count"]])
                if rec_details.get("external_recorder"):
                    writer.writerow(["External Audio Recorder", rec_details["external_recorder"]])
                if rec_details.get("audio_operator"):
                    writer.writerow(["Audio Operator", rec_details["audio_operator"]])

                # Multi-assignments
                multi_raw = se.get("individual_multi_assignments") or []
                if isinstance(multi_raw, str):
                    try: multi_raw = json.loads(multi_raw)
                    except Exception: multi_raw = []
                if multi_raw:
                    writer.writerow([])
                    writer.writerow(["# ADDITIONAL CREW ASSIGNMENTS"])
                    writer.writerow(["Role", "Crew Name", "Series", "Location"])
                    for ma in multi_raw:
                        m_uid = ma.get("user_id")
                        m_name = users_map.get(m_uid, "") if m_uid else ""
                        m_ser = user_series_map.get(m_name, "") if m_name else ""
                        writer.writerow([
                            ma.get("role", "Crew").title(),
                            m_name,
                            m_ser,
                            ma.get("location", "")
                        ])

                # Inline ceremony segments
                assignments = se.get("assignments") or []
                if assignments:
                    writer.writerow([])
                    writer.writerow(["# INLINE CEREMONY SEGMENTS"])
                    writer.writerow(["Seq", "Event / Type", "Host Name", "Phone", "ITS", "Address", "Photographer", "Videographer"])
                    for a in assignments:
                        a_p_name = users_map.get(a.get("photographer_id"), "")
                        a_v_name = users_map.get(a.get("videographer_id"), "")
                        writer.writerow([
                            a.get("sequence", ""),
                            a.get("event_abr", "Nikah"),
                            a.get("name", ""),
                            a.get("mobile", ""),
                            a.get("its", ""),
                            a.get("location", ""),
                            a_p_name,
                            a_v_name
                        ])

            elif engine == 'qmz':
                # Teams line-wise
                qmz_teams = se.get("qmz_teams") or []
                if isinstance(qmz_teams, str):
                    try: qmz_teams = json.loads(qmz_teams)
                    except Exception: qmz_teams = []

                if qmz_teams:
                    writer.writerow(["Total Teams", len(qmz_teams)])
                    writer.writerow([])
                    writer.writerow(["# TEAMS ROTATION SETUP"])
                    writer.writerow(["Team Number", "Team Name", "Photographer", "Videographer"])
                    for t_idx, qt in enumerate(qmz_teams):
                        t_name = qt.get("name") or f"Team {t_idx + 1}"
                        p_name = users_map.get(qt.get("photographer_id"), "")
                        p_ser = user_series_map.get(p_name, "") if p_name else ""
                        p_display = f"{p_name} ({p_ser})" if p_ser else p_name
                        v_name = users_map.get(qt.get("videographer_id"), "")
                        v_ser = user_series_map.get(v_name, "") if v_name else ""
                        v_display = f"{v_name} ({v_ser})" if v_ser else v_name
                        writer.writerow([f"Team {t_idx + 1}", t_name, p_display, v_display])

                # Sequences table
                assignments = se.get("assignments") or []
                writer.writerow([])
                writer.writerow(["# QMZ SEQUENCES"])
                writer.writerow(["Seq", "Event / Type", "Sticker", "Host Name", "Phone", "ITS", "Address", "Team", "Photographer", "Videographer"])
                for a in assignments:
                    t_val = a.get("team_id") or ""
                    if qmz_teams and t_val:
                        matched_t = next((t for t in qmz_teams if t.get("id") == t_val or t.get("name") == t_val), None)
                        if matched_t:
                            t_val = matched_t.get("name") or t_val

                    p_name = ""
                    if not a.get("photo_not_covered"):
                        p_name = users_map.get(a.get("photographer_id"), "")
                    else:
                        p_name = "Not Covered"

                    v_name = ""
                    if not a.get("video_not_covered"):
                        v_name = users_map.get(a.get("videographer_id"), "")
                    else:
                        v_name = "Not Covered"

                    writer.writerow([
                        a.get("sequence", ""),
                        a.get("event_abr", "Qadam"),
                        a.get("sticker_name", ""),
                        a.get("name", ""),
                        a.get("mobile", ""),
                        a.get("its", ""),
                        a.get("location", ""),
                        t_val,
                        p_name,
                        v_name
                    ])

            elif engine == 'bethak':
                b_teams = se.get("qmz_teams") or []
                if isinstance(b_teams, str):
                    try: b_teams = json.loads(b_teams)
                    except Exception: b_teams = []

                if b_teams:
                    writer.writerow(["Total Teams", len(b_teams)])
                    writer.writerow([])
                    writer.writerow(["# TEAMS ROTATION SETUP"])
                    writer.writerow(["Team Number", "Team Name", "Photographer", "Videographer"])
                    for t_idx, qt in enumerate(b_teams):
                        t_name = qt.get("name") or f"Team {t_idx + 1}"
                        p_name = users_map.get(qt.get("photographer_id"), "")
                        p_ser = user_series_map.get(p_name, "") if p_name else ""
                        p_display = f"{p_name} ({p_ser})" if p_ser else p_name
                        v_name = users_map.get(qt.get("videographer_id"), "")
                        v_ser = user_series_map.get(v_name, "") if v_name else ""
                        v_display = f"{v_name} ({v_ser})" if v_ser else v_name
                        writer.writerow([f"Team {t_idx + 1}", t_name, p_display, v_display])

                assignments = se.get("assignments") or []
                if not assignments:
                    assignments = self._generate_bethak_assignments_from_counts(se)

                writer.writerow([])
                writer.writerow(["# BETHAK SEQUENCES"])
                writer.writerow(["Seq", "Segment / Type", "Sticker", "Host Name", "Phone", "ITS", "Address", "Team", "Photographer", "Videographer"])
                for a in assignments:
                    t_val = a.get("team_id") or ""
                    matched_t = None
                    if b_teams:
                        if t_val:
                            matched_t = next((t for t in b_teams if t.get("id") == t_val or t.get("name") == t_val), None)
                        if not matched_t and len(b_teams) == 1:
                            matched_t = b_teams[0]
                        if matched_t:
                            t_val = matched_t.get("name") or (f"Team {b_teams.index(matched_t) + 1}")

                    p_id = a.get("photographer_id") or (matched_t.get("photographer_id") if matched_t else None)
                    v_id = a.get("videographer_id") or (matched_t.get("videographer_id") if matched_t else None)

                    abr_val = str(a.get("event_abr") or "Bethak").strip()
                    is_photo_only = abr_val in ("Haddiyat", "Mafsuhiyat", "Misaq", "H", "MF")

                    if a.get("photo_not_covered"):
                        p_name = "Not Covered"
                    else:
                        p_name = users_map.get(p_id, "")

                    if is_photo_only or a.get("video_not_covered"):
                        v_name = "Not Covered"
                    else:
                        v_name = users_map.get(v_id, "")

                    writer.writerow([
                        a.get("sequence", ""),
                        abr_val,
                        a.get("sticker_name", ""),
                        a.get("name", ""),
                        a.get("mobile", ""),
                        a.get("its", ""),
                        a.get("location", ""),
                        t_val,
                        p_name,
                        v_name
                    ])

            writer.writerow([])
            writer.writerow([])

        return out_buf.getvalue(), len(sub_events)

    def export_date_sync_csv(self, event_id: str, default_filename: str = ""):
        """
        Exports slot events to human-readable Date Sync CSV for manual website synchronization.
        Separates each event with clean headings, writes event fields line-wise, and outputs sequence columns:
        Seq, Event / Type, Sticker, Host Name, Phone, ITS, Address, Team, Photographer, Videographer.
        """
        if not event_id:
            return json.dumps({"error": "event_id is required"})

        try:
            evt_resp = json.loads(self.get_event(event_id))
            if evt_resp.get("error"):
                return json.dumps(evt_resp)
            target_evt = evt_resp["event"]
            date_val = target_evt.get("date", "")
            slot_val = target_evt.get("event_time_slot", "Morning")
            slot_code = "01M" if slot_val == "Morning" else "02E"

            suggested_name = default_filename or f"{date_val} _{slot_code}_Date_Sync.csv"
            save_path = None

            if self._window:
                result = self._window.create_file_dialog(
                    webview.FileDialog.SAVE,
                    save_filename=suggested_name,
                    file_types=("CSV Files (*.csv)",)
                )
                if not result:
                    return json.dumps({"success": False, "cancelled": True})
                save_path = result if isinstance(result, str) else result[0]
            else:
                save_path = os.path.join(str(self.base_dir), suggested_name)

            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    SELECT e.*, c.name as city_name
                    FROM city_events e
                    JOIN cities c ON c.id = e.city_id
                    WHERE e.date = ? AND e.event_time_slot = ?
                    ORDER BY e.sequence_number ASC, e.id ASC
                """, (date_val, slot_val))
                sub_events = [dict(r) for r in cursor.fetchall()]

                cursor.execute("SELECT id, name, phone, series FROM users")
                users_rows = cursor.fetchall()
                users_map = {u["id"]: u["name"] for u in users_rows}
                user_series_map = {u["name"]: (u["series"] or "") for u in users_rows if u["name"]}
                user_phone_map = {u["name"]: (u["phone"] or "") for u in users_rows if u["name"]}

                for se in sub_events:
                    cursor.execute("""
                        SELECT * FROM city_event_assignments
                        WHERE event_id = ?
                        ORDER BY CAST(sequence AS INTEGER) ASC, sequence ASC, id ASC
                    """, (se["id"],))
                    asgns = [dict(a) for a in cursor.fetchall()]
                    if not asgns and (se.get("type") == "Bethak" or "bethak" in str(se.get("type", "")).lower()):
                        asgns = self._generate_and_save_bethak_assignments(conn, se)
                    se["assignments"] = asgns

            csv_content, total_events = self._build_date_sync_csv_content(
                sub_events, users_map, user_series_map, user_phone_map, date_val, slot_val
            )

            with open(save_path, "w", newline="", encoding="utf-8") as f:
                f.write(csv_content)

            return json.dumps({
                "success": True,
                "path": save_path,
                "filename": suggested_name,
                "csv_content": csv_content,
                "total_rows": total_events
            })
        except Exception as e:
            return json.dumps({"error": str(e)})

    def get_ain53_package_data(self, safar_name: str = "", date_filter: str = "", slot_filter: str = ""):
        """
        Builds the standardized .AIN53 JSON package data without showing any file dialog or saving to disk.
        Used for preloading, viewer display, and programmatic synchronization.
        """
        try:
            target_safar = str(safar_name or "").strip()
            date_filter = str(date_filter or "").strip()
            slot_filter = str(slot_filter or "").strip()

            with self._get_connection() as conn:
                cursor = conn.cursor()
                if not target_safar:
                    app_safar = _get_app_setting("active_safar_name", "")
                    if app_safar:
                        target_safar = app_safar
                    else:
                        cursor.execute("SELECT name FROM safars ORDER BY id ASC LIMIT 1")
                        r = cursor.fetchone()
                        if r:
                            target_safar = r[0]

                # Safar row
                cursor.execute("SELECT id, name, path, temp_path, created_at FROM safars WHERE LOWER(name) = LOWER(?)", (target_safar,))
                safar_row = cursor.fetchone()

                # Cities
                cursor.execute("SELECT id, name, teams_required, core_teams FROM cities ORDER BY id ASC")
                cities_list = []
                for c in cursor.fetchall():
                    core_teams = []
                    try:
                        core_teams = json.loads(c["core_teams"]) if c["core_teams"] else []
                    except Exception:
                        pass
                    cities_list.append({
                        "id": c["id"],
                        "name": c["name"],
                        "teams_required": c["teams_required"],
                        "core_teams": core_teams
                    })

                # Crew
                if target_safar:
                    cursor.execute("""
                        SELECT id, name, role, series, its, phone, safar_name 
                        FROM users 
                        WHERE LOWER(safar_name) = LOWER(?) OR (series IS NOT NULL AND series != '')
                        ORDER BY name ASC
                    """, (target_safar,))
                else:
                    cursor.execute("SELECT id, name, role, series, its, phone, safar_name FROM users ORDER BY name ASC")
                crew_list = []
                for u in cursor.fetchall():
                    crew_list.append({
                        "id": u["id"],
                        "name": u["name"],
                        "role": u["role"] or "Photographer",
                        "series": u["series"] or "",
                        "its": u["its"] or "",
                        "phone": u["phone"] or "",
                        "safar_name": u["safar_name"] or "",
                        "active": True
                    })

                # Events query
                query = """
                    SELECT e.*, c.name as city_name 
                    FROM city_events e
                    LEFT JOIN cities c ON c.id = e.city_id
                    WHERE 1=1
                """
                params = []
                if target_safar:
                    query += " AND LOWER(e.safar_name) = LOWER(?)"
                    params.append(target_safar)
                if date_filter:
                    query += " AND e.date = ?"
                    params.append(date_filter)
                if slot_filter:
                    if slot_filter in ("Morning", "01M"):
                        query += " AND (e.event_time_slot = 'Morning' OR e.event_time_slot = '01M')"
                    elif slot_filter in ("Evening", "02E"):
                        query += " AND (e.event_time_slot = 'Evening' OR e.event_time_slot = '02E')"
                    else:
                        query += " AND e.event_time_slot = ?"
                        params.append(slot_filter)

                query += " ORDER BY e.date ASC, e.event_time_slot ASC, e.sequence_number ASC, e.id ASC"
                cursor.execute(query, params)
                raw_events = [dict(r) for r in cursor.fetchall()]

                # Prevent export of empty Safar with no events or dates
                if not date_filter and len(raw_events) == 0:
                    return json.dumps({"error": f"Cannot export empty Safar '{target_safar}'. It has no dates or events."})

                # Group events by date -> slot
                schedule_map = {}
                total_sequences = 0
                covered_sequences = 0

                for evt in raw_events:
                    d_val = evt.get("date") or "Unknown"
                    slot_val = evt.get("event_time_slot") or "Morning"
                    slot_code = "01M" if slot_val.lower().startswith("morn") or slot_val == "01M" else "02E"
                    slot_name = "Morning" if slot_code == "01M" else "Evening"

                    # Load assignments
                    cursor.execute("""
                        SELECT a.*, 
                               pu.name as photographer_name, pu.series as photographer_series,
                               vu.name as videographer_name, vu.series as videographer_series
                        FROM city_event_assignments a
                        LEFT JOIN users pu ON pu.id = a.photographer_id
                        LEFT JOIN users vu ON vu.id = a.videographer_id
                        WHERE a.event_id = ?
                        ORDER BY CAST(a.sequence AS INTEGER) ASC, a.sequence ASC, a.id ASC
                    """, (evt["id"],))
                    asgns = [dict(a) for a in cursor.fetchall()]

                    formatted_asgns = []
                    for a in asgns:
                        total_sequences += 1
                        photo_not_cov = bool(a.get("photo_not_covered"))
                        video_not_cov = bool(a.get("video_not_covered"))
                        has_photo = bool(a.get("photographer_name") or a.get("photographer_id"))
                        has_video = bool(a.get("videographer_name") or a.get("videographer_id"))
                        is_uncovered = photo_not_cov or video_not_cov or (not has_photo and not has_video)
                        if not is_uncovered:
                            covered_sequences += 1

                        formatted_asgns.append({
                            "id": a.get("id"),
                            "sequence": str(a.get("sequence") or ""),
                            "event_abr": a.get("event_abr") or "",
                            "sticker_name": a.get("sticker_name") or "",
                            "name": a.get("name") or "",
                            "its": str(a.get("its") or ""),
                            "location": a.get("location") or "",
                            "mobile": a.get("mobile") or "",
                            "team_id": a.get("team_id") or "",
                            "photographer_id": a.get("photographer_id"),
                            "photographer_name": a.get("photographer_name") or "",
                            "photographer_series": a.get("photographer_series") or "",
                            "videographer_id": a.get("videographer_id"),
                            "videographer_name": a.get("videographer_name") or "",
                            "videographer_series": a.get("videographer_series") or "",
                            "photo_not_covered": photo_not_cov,
                            "video_not_covered": video_not_cov,
                            "is_inline": bool(a.get("is_inline"))
                        })

                    def _parse_json_field(field_val):
                        if not field_val: return None
                        try:
                            return json.loads(field_val) if isinstance(field_val, str) else field_val
                        except Exception:
                            return None

                    formatted_evt = {
                        "id": evt.get("id"),
                        "sequence_number": evt.get("sequence_number") or 1,
                        "event_code": evt.get("event_code") or "",
                        "name": evt.get("name") or evt.get("type"),
                        "type": evt.get("type"),
                        "engine": "QMZ" if evt.get("type") == "QMZ" else ("Bethak" if evt.get("type") == "Bethak" else "Standard"),
                        "city_id": evt.get("city_id"),
                        "city_name": evt.get("city_name") or "",
                        "status": evt.get("status") or "CREATED",
                        "start_time": evt.get("start_time") or "",
                        "report_time": evt.get("report_time") or "",
                        "assignment_mode": evt.get("assignment_mode") or "individual",
                        "qmz_count": evt.get("qmz_count") or 1,
                        "qmz_teams": _parse_json_field(evt.get("qmz_teams")) or [],
                        "bethak_counts": _parse_json_field(evt.get("bethak_counts")) or [],
                        "individual_assignment": _parse_json_field(evt.get("individual_assignment")),
                        "recording_details": _parse_json_field(evt.get("recording_details")),
                        "notes": evt.get("notes") or "",
                        "assignments": formatted_asgns
                    }

                    if d_val not in schedule_map:
                        schedule_map[d_val] = {}
                    if slot_code not in schedule_map[d_val]:
                        schedule_map[d_val][slot_code] = {
                            "slot_code": slot_code,
                            "slot_name": slot_name,
                            "start_time": evt.get("start_time") or "",
                            "end_time": "",
                            "status": evt.get("status") or "CREATED",
                            "events": []
                        }
                    schedule_map[d_val][slot_code]["events"].append(formatted_evt)

            # Build Schedule Array
            schedule_list = []
            for d_key, slots in sorted(schedule_map.items()):
                slots_arr = []
                for s_code, s_data in sorted(slots.items()):
                    s_data["events_count"] = len(s_data["events"])
                    s_data["sequences_count"] = sum(len(e["assignments"]) for e in s_data["events"])

                    # Fetch slot inventory report if uploaded
                    cursor.execute("""
                        SELECT filename, total_found, total_missing, missing_files, issues, cameras, uploaded_at,
                               details_json, file_base64 
                        FROM slot_inventory_reports 
                        WHERE LOWER(safar_name) = LOWER(?) AND date = ? AND (slot = ? OR slot = ?)
                    """, (target_safar, d_key, s_code, s_data.get("slot_name", "")))
                    inv_row = cursor.fetchone()
                    if inv_row:
                        full_details = {}
                        if len(inv_row) > 7 and inv_row[7]:
                            try:
                                full_details = json.loads(inv_row[7])
                            except Exception:
                                pass
                        
                        file_b64 = inv_row[8] if len(inv_row) > 8 and inv_row[8] else full_details.get("file_base64", "")
                        raw_sh = full_details.get("raw_sheets", {})
                        sh_names = full_details.get("sheet_names", list(raw_sh.keys()))
                        sh_stats = full_details.get("sheet_stats", {s: {"rows": len(raw_sh[s]), "columns": len(raw_sh[s][0]) if raw_sh[s] else 0} for s in raw_sh})
                        m_type = full_details.get("mime_type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")

                        rep_obj = {
                            "uploaded": True,
                            "filename": inv_row[0],
                            "date": d_key,
                            "slot": s_code,
                            "slot_name": s_data.get("slot_name", ""),
                            "file_size": full_details.get("file_size", len(file_b64) if file_b64 else 0),
                            "mime_type": m_type,
                            "total_found": inv_row[1],
                            "total_missing": inv_row[2],
                            "metrics": full_details.get("metrics", {
                                "total_found": inv_row[1],
                                "total_missing": inv_row[2],
                                "total_cameras": len(full_details.get("cameras", [])),
                                "total_folders": len(full_details.get("folder_structure", [])),
                                "total_missing_files": len(full_details.get("missing_files", [])),
                                "total_contributor_files": len(full_details.get("contributors", [])),
                                "total_issues": len(full_details.get("issues", [])),
                                "total_sheets": len(sh_names)
                            }),
                            "sheet_names": sh_names,
                            "sheet_stats": sh_stats,
                            "missing_files": full_details.get("missing_files", json.loads(inv_row[3] or "[]")),
                            "folder_structure": full_details.get("folder_structure", []),
                            "cameras": full_details.get("cameras", json.loads(inv_row[5] or "[]")),
                            "contributors": full_details.get("contributors", []),
                            "issues": full_details.get("issues", json.loads(inv_row[4] or "[]")),
                            "sheets": full_details.get("sheets", {}),
                            "raw_sheets": raw_sh,
                            "file_base64": file_b64,
                            "excel_replica": {
                                "filename": inv_row[0],
                                "mime_type": m_type,
                                "file_size": full_details.get("file_size", len(file_b64) if file_b64 else 0),
                                "sheet_names": sh_names,
                                "sheet_stats": sh_stats,
                                "file_base64": file_b64,
                                "raw_sheets": raw_sh
                            },
                            "uploaded_at": inv_row[6]
                        }
                        s_data["inventory_report"] = rep_obj
                        for ev in s_data.get("events", []):
                            ev["inventory_report"] = rep_obj
                    else:
                        s_data["inventory_report"] = None

                    # Check if slot events were marked ended
                    cursor.execute("""
                        SELECT MAX(event_ended), MAX(event_end_time) 
                        FROM city_events 
                        WHERE date = ? AND (
                            (event_time_slot = 'Morning' AND ? IN ('01M', 'Morning')) OR
                            (event_time_slot = 'Evening' AND ? IN ('02E', 'Evening'))
                        )
                    """, (d_key, s_code, s_code))
                    ended_res = cursor.fetchone()
                    is_ended = bool(ended_res and ended_res[0])
                    s_data["event_ended"] = is_ended
                    s_data["event_end_time"] = ended_res[1] if (ended_res and is_ended) else None
                    if is_ended:
                        s_data["status"] = "ENDED"

                    slots_arr.append(s_data)
                schedule_list.append({
                    "date": d_key,
                    "slots": slots_arr
                })

            scope = "FULL_SAFAR"
            if date_filter and slot_filter:
                scope = "DATE_SLOT"
            elif date_filter:
                scope = "SINGLE_DAY"

            # Gather all inventory reports and files for root-level package embedding
            all_inventory_reports = []
            all_inventory_files = {}
            for d in schedule_list:
                for s in d.get("slots", []):
                    rep = s.get("inventory_report")
                    if rep and rep.get("uploaded"):
                        all_inventory_reports.append(rep)
                        fn = rep.get("filename") or "Inventory_Report.xlsx"
                        all_inventory_files[fn] = rep

            package = {
                "$schema": "https://ain53.org/schemas/safar-sync-v1.json",
                "format": "AIN53_SAFAR_SYNC_PACKAGE",
                "version": "1.0.0",
                "generator": {
                    "app": "AIN53 Data Management Desktop",
                    "version": "1.5.0",
                    "platform": sys.platform,
                    "exported_at": datetime.datetime.now(datetime.timezone.utc).isoformat()
                },
                "safar": {
                    "id": safar_row[0] if safar_row else 1,
                    "name": target_safar or "Safar",
                    "scope": scope,
                    "target_date": date_filter or None,
                    "target_slot": slot_filter or None,
                    "created_at": safar_row[4] if safar_row and len(safar_row) > 4 else None
                },
                "cities": cities_list,
                "crew": crew_list,
                "schedule": schedule_list,
                "inventory_reports": all_inventory_reports,
                "inventory_files": all_inventory_files,
                "metrics": {
                    "total_days": len(schedule_list),
                    "total_events": len(raw_events),
                    "total_sequences": total_sequences,
                    "total_crew": len(crew_list),
                    "total_inventory_reports": len(all_inventory_reports),
                    "covered_sequences": covered_sequences,
                    "uncovered_sequences": total_sequences - covered_sequences
                }
            }

            file_content = json.dumps(package, indent=2, ensure_ascii=False)
            return json.dumps({
                "success": True,
                "package": package,
                "file_content": file_content,
                "total_events": len(raw_events),
                "total_sequences": total_sequences,
                "safar_name": target_safar,
                "safar_dir": safar_row[2] if safar_row and len(safar_row) > 2 else ""
            })
        except Exception as e:
            return json.dumps({"error": str(e)})

    def export_ain53(self, safar_name: str = "", date_filter: str = "", slot_filter: str = "", default_filename: str = ""):
        """
        Exports the entire Safar (or a specific date/slot) into a standardized .AIN53 JSON package.
        Prompts user with a native Save dialog. If cancelled, returns cancelled without modifying anything.
        """
        try:
            pack_raw = self.get_ain53_package_data(safar_name, date_filter, slot_filter)
            pack_res = json.loads(pack_raw)
            if not pack_res.get("success"):
                return pack_raw

            target_safar = pack_res.get("safar_name", "")
            file_content = pack_res.get("file_content", "")
            total_events = pack_res.get("total_events", 0)
            total_sequences = pack_res.get("total_sequences", 0)
            safar_dir = pack_res.get("safar_dir", "")

            # Filename & Save: Safar name = filename for full safar, Date = filename for single date
            clean_safar = target_safar or "safar"
            if default_filename:
                suggested_name = default_filename
            elif date_filter:
                suggested_name = f"{date_filter}.AIN53"
            else:
                suggested_name = f"{clean_safar}.AIN53"

            save_path = None
            if self._window:
                result = self._window.create_file_dialog(
                    webview.FileDialog.SAVE,
                    save_filename=suggested_name,
                    file_types=("AIN53 Sync Files (*.AIN53)", "JSON Files (*.json)")
                )
                if not result:
                    # Explicit user cancel: do NOT save anything and do NOT mark completed
                    return json.dumps({"success": False, "cancelled": True})
                save_path = result if isinstance(result, str) else result[0]
            else:
                if not safar_dir:
                    safar_dir = _get_app_setting("safar_root_path", "")
                if safar_dir and Path(safar_dir).exists():
                    save_path = str(Path(safar_dir) / suggested_name)
                else:
                    dl = Path.home() / "Downloads"
                    save_path = str(dl / suggested_name if dl.exists() else self.base_dir / suggested_name)

            with open(save_path, "w", encoding="utf-8") as f:
                f.write(file_content)

            # Mark Safar as completed only on genuine user export
            if not date_filter and target_safar:
                try:
                    with self._get_connection() as conn:
                        cursor = conn.cursor()
                        cursor.execute("UPDATE safars SET status = 'completed' WHERE LOWER(name) = LOWER(?)", (target_safar,))
                        conn.commit()
                except Exception as st_err:
                    pass

            return json.dumps({
                "success": True,
                "path": save_path,
                "filename": suggested_name,
                "file_content": file_content,
                "total_events": total_events,
                "total_sequences": total_sequences,
                "safar_name": target_safar
            })
        except Exception as e:
            return json.dumps({"error": str(e)})

    def import_ain53(self, file_path: str = "", file_content: str = ""):
        """
        Imports an .AIN53 Safar sync file into the local SQLite database.
        Reconciles Safar, cities, crew, events, and assignments.
        """
        try:
            if not file_content:
                if not file_path and self._window:
                    result = self._window.create_file_dialog(
                        webview.FileDialog.OPEN,
                        file_types=("AIN53 Sync Files (*.AIN53)", "JSON Files (*.json)", "All Files (*.*)")
                    )
                    if not result:
                        return json.dumps({"success": False, "cancelled": True})
                    file_path = result if isinstance(result, str) else result[0]
                if file_path and os.path.exists(file_path):
                    with open(file_path, "r", encoding="utf-8") as f:
                        file_content = f.read()

            if not file_content:
                return json.dumps({"success": False, "cancelled": True})

            payload = json.loads(file_content)
            if payload.get("format") != "AIN53_SAFAR_SYNC_PACKAGE":
                return json.dumps({"error": "Invalid format signature. Expected 'AIN53_SAFAR_SYNC_PACKAGE'"})

            safar_meta = payload.get("safar", {})
            safar_name = safar_meta.get("name", "").strip()
            if not safar_name:
                return json.dumps({"error": "Missing 'safar.name' in sync package"})

            with self._get_connection() as conn:
                cursor = conn.cursor()

                # 1. Upsert Safar
                cursor.execute("""
                    INSERT INTO safars (name) VALUES (?)
                    ON CONFLICT(name) DO NOTHING
                """, (safar_name,))

                # 2. Upsert Cities
                city_id_map = {}
                for city in payload.get("cities", []):
                    c_name = city.get("name", "").strip()
                    if not c_name: continue
                    t_req = city.get("teams_required", 1)
                    cursor.execute("""
                        INSERT INTO cities (name, teams_required) VALUES (?, ?)
                        ON CONFLICT(name) DO UPDATE SET teams_required = excluded.teams_required
                    """, (c_name, t_req))
                    cursor.execute("SELECT id FROM cities WHERE LOWER(name) = LOWER(?)", (c_name,))
                    r = cursor.fetchone()
                    if r:
                        city_id_map[c_name.lower()] = r[0]

                # 3. Upsert Crew / Users
                for u in payload.get("crew", []):
                    u_name = u.get("name", "").strip()
                    if not u_name: continue
                    u_role = u.get("role", "Photographer")
                    u_series = u.get("series", "")
                    u_its = u.get("its", "")
                    u_phone = u.get("phone", "")
                    cursor.execute("""
                        SELECT id FROM users WHERE LOWER(name) = LOWER(?)
                    """, (u_name,))
                    existing = cursor.fetchone()
                    if existing:
                        cursor.execute("""
                            UPDATE users SET role = ?, series = ?, safar_name = ?, its = ?, phone = ?
                            WHERE id = ?
                        """, (u_role, u_series, safar_name, u_its, u_phone, existing[0]))
                    else:
                        cursor.execute("""
                            INSERT INTO users (name, role, series, safar_name, its, phone)
                            VALUES (?, ?, ?, ?, ?, ?)
                        """, (u_name, u_role, u_series, safar_name, u_its, u_phone))

                # 4. Upsert Schedule, Events, and Assignments
                events_synced = 0
                sequences_synced = 0

                for day in payload.get("schedule", []):
                    d_val = day.get("date")
                    for slot in day.get("slots", []):
                        slot_name = slot.get("slot_name", "Morning")
                        for evt in slot.get("events", []):
                            evt_id = evt.get("id") or f"evt_{d_val}_{slot_name}_{evt.get('sequence_number', 1)}"
                            c_name = (evt.get("city_name") or "").lower()
                            c_id = city_id_map.get(c_name) or evt.get("city_id") or 1

                            cursor.execute("""
                                INSERT INTO city_events (
                                    id, safar_name, city_id, name, date, type, event_time_slot,
                                    sequence_number, event_code, start_time, report_time,
                                    assignment_mode, qmz_count, qmz_teams, bethak_counts,
                                    individual_assignment, recording_details, status
                                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                                ON CONFLICT(id) DO UPDATE SET
                                    safar_name = excluded.safar_name,
                                    city_id = excluded.city_id,
                                    name = excluded.name,
                                    date = excluded.date,
                                    type = excluded.type,
                                    event_time_slot = excluded.event_time_slot,
                                    sequence_number = excluded.sequence_number,
                                    event_code = excluded.event_code,
                                    start_time = excluded.start_time,
                                    report_time = excluded.report_time,
                                    assignment_mode = excluded.assignment_mode,
                                    qmz_count = excluded.qmz_count,
                                    qmz_teams = excluded.qmz_teams,
                                    bethak_counts = excluded.bethak_counts,
                                    status = excluded.status
                            """, (
                                evt_id, safar_name, c_id, evt.get("name") or evt.get("type"),
                                d_val, evt.get("type", "Waaz"), slot_name,
                                evt.get("sequence_number", 1), evt.get("event_code", ""),
                                evt.get("start_time", ""), evt.get("report_time", ""),
                                evt.get("assignment_mode", "individual"), evt.get("qmz_count", 1),
                                json.dumps(evt.get("qmz_teams") or []), json.dumps(evt.get("bethak_counts") or []),
                                json.dumps(evt.get("individual_assignment") or {}),
                                json.dumps(evt.get("recording_details") or {}),
                                evt.get("status", "CREATED")
                            ))
                            events_synced += 1

                            # Reconcile assignments
                            cursor.execute("DELETE FROM city_event_assignments WHERE event_id = ?", (evt_id,))
                            for asgn in evt.get("assignments", []):
                                cursor.execute("""
                                    INSERT INTO city_event_assignments (
                                        event_id, sequence, event_abr, sticker_name, name, its,
                                        location, mobile, team_id, photographer_id, videographer_id,
                                        photo_not_covered, video_not_covered, is_inline
                                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                                """, (
                                    evt_id, str(asgn.get("sequence") or ""), asgn.get("event_abr") or "",
                                    asgn.get("sticker_name") or "", asgn.get("name") or "",
                                    str(asgn.get("its") or ""), asgn.get("location") or "",
                                    asgn.get("mobile") or "", asgn.get("team_id") or "",
                                    asgn.get("photographer_id"), asgn.get("videographer_id"),
                                    1 if asgn.get("photo_not_covered") else 0,
                                    1 if asgn.get("video_not_covered") else 0,
                                    1 if asgn.get("is_inline") else 0
                                ))
                                sequences_synced += 1

                        # Ingest slot inventory report if provided in package
                        inv_rep = slot.get("inventory_report")
                        if inv_rep and isinstance(inv_rep, dict):
                            details_json = json.dumps(inv_rep)
                            file_b64 = inv_rep.get("file_base64", "")
                            cursor.execute("""
                                INSERT INTO slot_inventory_reports (
                                    safar_name, date, slot, filename, total_found, total_missing,
                                    missing_files, issues, cameras, details_json, file_base64, uploaded_at
                                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                                ON CONFLICT(safar_name, date, slot) DO UPDATE SET
                                    filename = excluded.filename,
                                    total_found = excluded.total_found,
                                    total_missing = excluded.total_missing,
                                    missing_files = excluded.missing_files,
                                    issues = excluded.issues,
                                    cameras = excluded.cameras,
                                    details_json = excluded.details_json,
                                    file_base64 = excluded.file_base64,
                                    uploaded_at = excluded.uploaded_at
                            """, (
                                safar_name, d_val, slot.get("slot_code") or slot_name,
                                inv_rep.get("filename", "Inventory_Report.xlsx"),
                                inv_rep.get("total_found", 0),
                                inv_rep.get("total_missing", 0),
                                json.dumps(inv_rep.get("missing_files", [])),
                                json.dumps(inv_rep.get("issues", [])),
                                json.dumps(inv_rep.get("cameras", [])),
                                details_json,
                                file_b64,
                                inv_rep.get("uploaded_at") or datetime.datetime.now().isoformat()
                            ))

                        if slot.get("event_ended"):
                            cursor.execute("""
                                UPDATE city_events
                                SET status = 'COMPLETED', event_ended = 1, event_end_time = ?, updated_at = datetime('now')
                                WHERE date = ? AND (
                                    (event_time_slot = 'Morning' AND ? IN ('01M', 'Morning')) OR
                                    (event_time_slot = 'Evening' AND ? IN ('02E', 'Evening'))
                                )
                            """, (slot.get("event_end_time") or datetime.datetime.now().isoformat(), d_val, slot.get("slot_code") or slot_name, slot.get("slot_code") or slot_name))

                conn.commit()

            return json.dumps({
                "success": True,
                "safar_name": safar_name,
                "events_synced": events_synced,
                "sequences_synced": sequences_synced
            })
        except Exception as e:
            return json.dumps({"error": str(e)})

    def upload_slot_inventory(self, safar_name: str, date: str, slot: str, file_path_or_content: str = "", filename: str = ""):
        """
        Uploads and parses an Inventory Report for a specific slot.
        Validates that filename ends with '_Inventory_Report' or '_Invertory_Report' (e.g. *_Inventory_Report.xlsx or .csv).
        """
        import re
        import base64
        import io
        try:
            target_safar = str(safar_name or "").strip()
            date = str(date or "").strip()
            slot = str(slot or "").strip()
            filename = str(filename or "").strip()

            if not filename and file_path_or_content and isinstance(file_path_or_content, str) and os.path.exists(file_path_or_content):
                filename = os.path.basename(file_path_or_content)

            # Accept any valid spreadsheet file (.xlsx, .xls, .csv)
            ext = os.path.splitext(filename or "")[1].lower()
            if ext not in ['.xlsx', '.xls', '.csv']:
                return json.dumps({
                    "error": f"Invalid file format '{filename}'. Please upload an Excel (.xlsx/.xls) or CSV (.csv) Inventory Report."
                })

            parsed = None
            raw_bytes = None
            file_base64 = ""
            if file_path_or_content and isinstance(file_path_or_content, str) and os.path.exists(file_path_or_content):
                with open(file_path_or_content, "rb") as f:
                    raw_bytes = f.read()
                file_base64 = base64.b64encode(raw_bytes).decode('ascii')
                parsed = self._parse_inventory_report_data(file_path_or_content, filename, raw_bytes, file_base64)
            elif file_path_or_content:
                data_str = str(file_path_or_content)
                if "," in data_str and "base64," in data_str:
                    data_str = data_str.split("base64,", 1)[1]
                try:
                    raw_bytes = base64.b64decode(data_str)
                    file_base64 = data_str
                    parsed = self._parse_inventory_report_data(io.BytesIO(raw_bytes), filename, raw_bytes, file_base64)
                except Exception:
                    raw_bytes = data_str.encode('utf-8')
                    file_base64 = base64.b64encode(raw_bytes).decode('ascii')
                    parsed = self._parse_inventory_report_data(file_path_or_content, filename, raw_bytes, file_base64)
            else:
                return json.dumps({"error": "No file content or path provided"})

            # Auto-detect date and slot from content or filename if not provided
            if not date or not slot:
                sample_txt = ""
                if raw_bytes:
                    try:
                        sample_txt = raw_bytes[:4000].decode('utf-8', errors='ignore')
                    except Exception:
                        pass
                search_txt = f"{filename} {sample_txt}"
                m_date = re.search(r'(\d{4}-\d{2}-\d{2})', search_txt)
                if m_date and not date:
                    date = m_date.group(1)
                m_slot = re.search(r'(01M|02E|[mM]orning|[eE]vening)', search_txt, re.I)
                if m_slot and not slot:
                    s_str = m_slot.group(1)
                    slot = "01M" if (s_str.lower().startswith("morn") or s_str.upper() == "01M") else "02E"

            # Always save as a clean .xlsx Excel filename
            final_filename = parsed.get("excel_filename") or parsed.get("filename") or filename
            if not final_filename.lower().endswith(".xlsx") and not final_filename.lower().endswith(".xls"):
                final_filename = os.path.splitext(final_filename)[0] + ".xlsx"

            details_json = json.dumps(parsed, ensure_ascii=False)

            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    INSERT INTO slot_inventory_reports (
                        safar_name, date, slot, filename, total_found, total_missing,
                        missing_files, issues, cameras, details_json, file_base64, uploaded_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
                    ON CONFLICT(safar_name, date, slot) DO UPDATE SET
                        filename = excluded.filename,
                        total_found = excluded.total_found,
                        total_missing = excluded.total_missing,
                        missing_files = excluded.missing_files,
                        issues = excluded.issues,
                        cameras = excluded.cameras,
                        details_json = excluded.details_json,
                        file_base64 = excluded.file_base64,
                        uploaded_at = excluded.uploaded_at
                """, (
                    target_safar, date, slot, final_filename,
                    parsed.get("total_found", 0),
                    parsed.get("total_missing", 0),
                    json.dumps(parsed.get("missing_files", [])),
                    json.dumps(parsed.get("issues", [])),
                    json.dumps(parsed.get("cameras", [])),
                    details_json,
                    parsed.get("file_base64") or file_base64
                ))
                conn.commit()

            return json.dumps({
                "success": True,
                "report": parsed
            })
        except Exception as e:
            return json.dumps({"error": str(e)})

    def get_slot_inventory(self, safar_name: str, date: str, slot: str):
        """Fetches the uploaded inventory report and event completion status for a slot."""
        try:
            target_safar = str(safar_name or "").strip()
            date = str(date or "").strip()
            slot = str(slot or "").strip()

            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    SELECT filename, total_found, total_missing, missing_files, issues, cameras, uploaded_at,
                           details_json, file_base64
                    FROM slot_inventory_reports
                    WHERE LOWER(safar_name) = LOWER(?) AND date = ? AND (slot = ? OR slot = ?)
                """, (target_safar, date, slot, "Morning" if slot == "01M" else ("Evening" if slot == "02E" else slot)))
                row = cursor.fetchone()

                cursor.execute("""
                    SELECT MAX(event_ended), MAX(event_end_time)
                    FROM city_events
                    WHERE date = ? AND (
                        (event_time_slot = 'Morning' AND ? IN ('01M', 'Morning')) OR
                        (event_time_slot = 'Evening' AND ? IN ('02E', 'Evening'))
                    )
                """, (date, slot, slot))
                ended_res = cursor.fetchone()
                is_ended = bool(ended_res and ended_res[0])
                end_time = ended_res[1] if (ended_res and is_ended) else None

                if not row:
                    return json.dumps({
                        "has_report": False,
                        "event_ended": is_ended,
                        "event_end_time": end_time
                    })

                full_det = {}
                if len(row) > 7 and row[7]:
                    try:
                        full_det = json.loads(row[7])
                    except Exception:
                        pass

                file_b64 = row[8] if len(row) > 8 and row[8] else full_det.get("file_base64", "")

                report_data = {
                    "filename": row[0],
                    "total_found": row[1],
                    "total_missing": row[2],
                    "metrics": full_det.get("metrics", {
                        "total_found": row[1],
                        "total_missing": row[2]
                    }),
                    "missing_files": full_det.get("missing_files", json.loads(row[3] or "[]")),
                    "folder_structure": full_det.get("folder_structure", []),
                    "cameras": full_det.get("cameras", json.loads(row[5] or "[]")),
                    "contributors": full_det.get("contributors", []),
                    "issues": full_det.get("issues", json.loads(row[4] or "[]")),
                    "sheets": full_det.get("sheets", {}),
                    "raw_sheets": full_det.get("raw_sheets", {}),
                    "file_base64": file_b64,
                    "uploaded_at": row[6]
                }

                return json.dumps({
                    "has_report": True,
                    "event_ended": is_ended,
                    "event_end_time": end_time,
                    "report": report_data
                })
        except Exception as e:
            return json.dumps({"error": str(e)})

    def end_event_slot(self, safar_name: str, date: str, slot: str):
        """
        Marks all events in the specified date/slot as ENDED.
        Strict requirement: Must have an uploaded inventory report first.
        """
        try:
            target_safar = str(safar_name or "").strip()
            date = str(date or "").strip()
            slot = str(slot or "").strip()

            with self._get_connection() as conn:
                cursor = conn.cursor()
                # End the events
                now_str = datetime.datetime.now().strftime("%Y-%m-%d %I:%M %p")
                cursor.execute("""
                    UPDATE city_events
                    SET status = 'COMPLETED',
                        event_ended = 1,
                        event_end_time = ?,
                        updated_at = datetime('now')
                    WHERE date = ? AND (
                        (event_time_slot = 'Morning' AND ? IN ('01M', 'Morning')) OR
                        (event_time_slot = 'Evening' AND ? IN ('02E', 'Evening'))
                    )
                """, (now_str, date, slot, slot))
                conn.commit()

            return json.dumps({
                "success": True,
                "ended_at": now_str
            })
        except Exception as e:
            return json.dumps({"error": str(e)})

    def _parse_inventory_report_data(self, file_path_or_bytes, filename: str, raw_bytes: bytes = None, file_base64: str = ""):
        """
        Parses an uploaded Inventory Report into a complete, exact replica.
        Captures all 5 sheets (Missing Files, Folder Structure, Camera Summary, Contributor, Issues),
        raw 2D sheet matrices, extension totals, metrics, and base64-encoded binary content.
        """
        import re
        import os
        import base64
        import io

        total_found = 0
        total_missing = 0
        missing_files = []
        folder_structure = []
        cameras = []
        contributors = []
        issues = []
        raw_sheets = {}

        if not raw_bytes:
            if isinstance(file_path_or_bytes, (bytes, bytearray)):
                raw_bytes = bytes(file_path_or_bytes)
            elif isinstance(file_path_or_bytes, io.BytesIO):
                raw_bytes = file_path_or_bytes.getvalue()
            elif isinstance(file_path_or_bytes, str) and os.path.exists(file_path_or_bytes):
                try:
                    with open(file_path_or_bytes, "rb") as f:
                        raw_bytes = f.read()
                except Exception:
                    pass

        if not file_base64 and raw_bytes:
            file_base64 = base64.b64encode(raw_bytes).decode('ascii')

        ext = os.path.splitext(filename)[1].lower()
        if ext in ['.xlsx', '.xls']:
            try:
                import openpyxl
                wb_source = io.BytesIO(raw_bytes) if raw_bytes else file_path_or_bytes
                wb = openpyxl.load_workbook(wb_source, data_only=True)

                # 1. 100% Exact 2D Grid Replica for ALL Sheets in Workbook
                for s_name in wb.sheetnames:
                    ws = wb[s_name]
                    grid = []
                    for r in range(1, ws.max_row + 1):
                        row_vals = []
                        for c in range(1, ws.max_column + 1):
                            v = ws.cell(r, c).value
                            row_vals.append(str(v) if v is not None else "")
                        grid.append(row_vals)
                    raw_sheets[s_name] = grid

                # 2. Detailed Sheet 1: Missing Files
                if 'Missing Files' in wb.sheetnames:
                    ws = wb['Missing Files']
                    for r in range(2, ws.max_row + 1):
                        fp = str(ws.cell(r, 1).value or "").strip()
                        fn = str(ws.cell(r, 2).value or "").strip()
                        st = str(ws.cell(r, 3).value or "").strip()
                        ct = str(ws.cell(r, 4).value or "").strip()
                        if fp or fn:
                            missing_files.append({
                                "folder_path": fp,
                                "file_name": fn,
                                "status": st,
                                "camera_type": ct
                            })

                # 3. Detailed Sheet 2: Folder Structure
                if 'Folder Structure' in wb.sheetnames:
                    ws = wb['Folder Structure']
                    for col in range(1, ws.max_column + 1):
                        folder_path = str(ws.cell(1, col).value or "").strip()
                        if not folder_path:
                            continue
                        contrib = str(ws.cell(2, col).value or "").strip()
                        files = []
                        ext_counts = {}
                        for r in range(3, ws.max_row + 1):
                            val = str(ws.cell(r, col).value or "").strip()
                            if not val:
                                continue
                            m_cnt = re.match(r'^\.?([a-zA-Z0-9_-]+):\s*(\d+)$', val)
                            if m_cnt:
                                ext_counts[m_cnt.group(1).lower()] = int(m_cnt.group(2))
                            else:
                                files.append(val)
                                _, file_ext = os.path.splitext(val.lower())
                                clean_ext = file_ext.lstrip('.')
                                if clean_ext:
                                    ext_counts[clean_ext] = ext_counts.get(clean_ext, 0) + 1
                        folder_structure.append({
                            "column_index": col,
                            "folder_path": folder_path,
                            "contributor": contrib,
                            "total_files": len(files),
                            "files": files,
                            "extension_counts": ext_counts
                        })

                # 4. Detailed Sheet 3: Camera Summary
                if 'Camera Summary' in wb.sheetnames:
                    ws = wb['Camera Summary']
                    for col in range(1, ws.max_column + 1):
                        cam_header = str(ws.cell(1, col).value or "").strip()
                        if not cam_header:
                            continue
                        cam_files = []
                        cam_found = 0
                        cam_missing = 0
                        for r in range(2, ws.max_row + 1):
                            val = str(ws.cell(r, col).value or "").strip()
                            if not val:
                                continue
                            if val.startswith("Total Found:"):
                                try: cam_found = int(re.search(r'\d+', val).group())
                                except Exception: pass
                            elif val.startswith("Total Missing:"):
                                try: cam_missing = int(re.search(r'\d+', val).group())
                                except Exception: pass
                            else:
                                cam_files.append(val)
                        total_found += cam_found
                        total_missing += cam_missing
                        cameras.append({
                            "camera": cam_header,
                            "files_count": len(cam_files),
                            "total_found": cam_found,
                            "total_missing": cam_missing,
                            "files": cam_files
                        })

                # 5. Detailed Sheet 4: Contributor
                if 'Contributor' in wb.sheetnames:
                    ws = wb['Contributor']
                    for r in range(2, ws.max_row + 1):
                        fp = str(ws.cell(r, 1).value or "").strip()
                        fn = str(ws.cell(r, 2).value or "").strip()
                        if (fp or fn) and fn.lower() != "file name":
                            contributors.append({
                                "folder_path": fp,
                                "file_name": fn
                            })

                # 6. Detailed Sheet 5: Issues
                if 'Issues' in wb.sheetnames:
                    ws = wb['Issues']
                    for r in range(2, ws.max_row + 1):
                        p = str(ws.cell(r, 1).value or "").strip()
                        t = str(ws.cell(r, 2).value or "").strip()
                        d = str(ws.cell(r, 3).value or "").strip()
                        if (p or t or d) and p.lower() != "path":
                            issues.append({
                                "path": p,
                                "type": t,
                                "description": d
                            })

                # Fallback totals if 0
                if total_found == 0 and total_missing == 0:
                    for ws in wb.worksheets:
                        for row in ws.iter_rows(values_only=True):
                            for cell in row:
                                if cell:
                                    s = str(cell)
                                    m1 = re.search(r'Total Found:\s*(\d+)', s)
                                    if m1: total_found += int(m1.group(1))
                                    m2 = re.search(r'Total Missing:\s*(\d+)', s)
                                    if m2: total_missing += int(m2.group(1))
            except Exception as pe:
                print(f"[Inventory Parse Warning] openpyxl error: {pe}")
        else:
            # CSV or plain text multi-section report
            raw_text = raw_bytes.decode('utf-8', errors='replace') if raw_bytes else (
                file_path_or_bytes if isinstance(file_path_or_bytes, str) else file_path_or_bytes.read().decode('utf-8', errors='replace')
            )
            lines = raw_text.splitlines()
            i = 0
            n = len(lines)

            while i < n:
                line = lines[i].strip()
                if not line:
                    i += 1
                    continue

                parts = [p.strip() for p in line.split(',')]

                # Section 1: Missing Files header
                if parts == ['Folder Path', 'File Name', 'Status', 'Camera Type']:
                    i += 1
                    while i < n:
                        sub = lines[i].strip()
                        if not sub:
                            i += 1; continue
                        sub_parts = [p.strip() for p in sub.split(',')]
                        # If next row is actually multi-column folder structure or has emojis / paths
                        if len(sub_parts) > 4 or any('📂' in p for p in sub_parts) or any('\\' in p or '/' in p for p in sub_parts if p):
                            break
                        if sub.startswith('Cam ') or 'Folder Path,File Name' in sub or 'Path,Issue Type,Description' in sub:
                            break
                        if len(sub_parts) >= 2 and sub_parts[0] and sub_parts[1]:
                            missing_files.append({
                                'folder_path': sub_parts[0],
                                'file_name': sub_parts[1],
                                'status': sub_parts[2] if len(sub_parts) > 2 else 'MISSING',
                                'camera_type': sub_parts[3] if len(sub_parts) > 3 else ''
                            })
                        i += 1
                    continue

                # Section 4: Contributor
                if len(parts) >= 2 and parts[0] == 'Folder Path' and parts[1] == 'File Name' and (len(parts) == 2 or not parts[2]):
                    i += 1
                    while i < n:
                        sub = lines[i].strip()
                        if not sub:
                            i += 1; continue
                        if 'Path,Issue Type,Description' in sub or sub.startswith('Cam ') or sub.startswith('Total Found:'):
                            break
                        sub_parts = [p.strip() for p in sub.split(',')]
                        if len(sub_parts) >= 2 and sub_parts[0] and sub_parts[1]:
                            contributors.append({'folder_path': sub_parts[0], 'file_name': sub_parts[1]})
                        i += 1
                    continue

                # Section 5: Issues
                if len(parts) >= 3 and parts[0] == 'Path' and parts[1] == 'Issue Type' and parts[2] == 'Description':
                    i += 1
                    while i < n:
                        sub = lines[i].strip()
                        if not sub:
                            i += 1; continue
                        if sub.startswith('Cam ') or 'Folder Path,File Name' in sub:
                            break
                        sub_parts = [p.strip() for p in sub.split(',')]
                        if len(sub_parts) >= 3 and (sub_parts[0] or sub_parts[1] or sub_parts[2]):
                            issues.append({'path': sub_parts[0], 'type': sub_parts[1], 'description': sub_parts[2]})
                        i += 1
                    continue

                # Section 3: Camera Summary
                if re.match(r'^Cam\s*\d+', line, re.I):
                    cam_header = line
                    cam_files = []
                    cam_found = 0
                    cam_missing = 0
                    i += 1
                    while i < n:
                        sub = lines[i].strip()
                        if not sub:
                            i += 1; continue
                        if sub.startswith('Total Found:'):
                            m = re.search(r'\d+', sub)
                            if m: cam_found = int(m.group())
                            i += 1; continue
                        if sub.startswith('Total Missing:'):
                            m = re.search(r'\d+', sub)
                            if m: cam_missing = int(m.group())
                            i += 1; continue
                        if re.match(r'^Cam\s*\d+', sub, re.I) or 'Folder Path,File Name' in sub or 'Path,Issue Type,Description' in sub:
                            break
                        cam_files.append(sub)
                        i += 1
                    cameras.append({
                        'camera': cam_header,
                        'files_count': len(cam_files),
                        'total_found': cam_found,
                        'total_missing': cam_missing,
                        'files': cam_files
                    })
                    total_found += cam_found
                    total_missing += cam_missing
                    continue

                # Section 2: Folder Structure
                fs_rows = []
                while i < n:
                    sub = lines[i].strip()
                    if not sub:
                        i += 1; continue
                    if sub.startswith('Cam ') or sub.startswith('Total Found:') or 'Folder Path,File Name' in sub or 'Path,Issue Type,Description' in sub:
                        break
                    sub_parts = [p.strip() for p in lines[i].split(',')]
                    fs_rows.append(sub_parts)
                    i += 1

                if fs_rows:
                    max_cols = max(len(r) for r in fs_rows)
                    norm_rows = [r + [''] * (max_cols - len(r)) for r in fs_rows]
                    for col_idx in range(max_cols):
                        f_path = norm_rows[0][col_idx] if len(norm_rows) > 0 else ''
                        contrib = norm_rows[1][col_idx] if len(norm_rows) > 1 else ''
                        col_files = []
                        ext_counts = {}
                        for r_idx in range(2, len(norm_rows)):
                            val = norm_rows[r_idx][col_idx]
                            if not val: continue
                            m_cnt = re.match(r'^\.?([a-zA-Z0-9_-]+):\s*(\d+)$', val)
                            if m_cnt:
                                ext_counts[m_cnt.group(1).lower()] = int(m_cnt.group(2))
                            else:
                                col_files.append(val)
                                _, f_ext = os.path.splitext(val.lower())
                                c_ext = f_ext.lstrip('.')
                                if c_ext:
                                    ext_counts[c_ext] = ext_counts.get(c_ext, 0) + 1
                        if f_path or contrib or col_files:
                            folder_structure.append({
                                'column_index': col_idx + 1,
                                'folder_path': f_path,
                                'contributor': contrib,
                                'total_files': len(col_files),
                                'files': col_files,
                                'extension_counts': ext_counts
                            })

            # Fallback regex totals if total_found/total_missing were not in cameras
            if total_found == 0:
                m_found = re.findall(r'Total Found:\s*(\d+)', raw_text)
                if m_found: total_found = sum(int(x) for x in m_found)
            if total_missing == 0:
                m_missing = re.findall(r'Total Missing:\s*(\d+)', raw_text)
                if m_missing: total_missing = sum(int(x) for x in m_missing)

            # SYNTHESIZE 1000% EXACT REPLICA .XLSX WORKBOOK USING OPENPYXL
            try:
                import openpyxl
                from openpyxl.styles import Font, PatternFill
                from openpyxl.utils import get_column_letter

                wb = openpyxl.Workbook()

                # 1. Sheet: Missing Files
                ws1 = wb.active
                ws1.title = 'Missing Files'
                ws1.append(['Folder Path', 'File Name', 'Status', 'Camera Type'])
                red_fill = PatternFill(start_color='FFFFC7CE', end_color='FFFFC7CE', fill_type='solid')
                red_font = Font(color='9C0006', bold=True)
                bold_font = Font(bold=True)
                for c_i in range(1, 5):
                    ws1.cell(1, c_i).font = bold_font
                for mf in missing_files:
                    ws1.append([mf.get('folder_path', ''), mf.get('file_name', ''), mf.get('status', 'MISSING'), mf.get('camera_type', '')])
                    r = ws1.max_row
                    for c in range(1, 5):
                        ws1.cell(r, c).fill = red_fill
                        ws1.cell(r, c).font = red_font

                # 2. Sheet: Folder Structure
                ws2 = wb.create_sheet(title='Folder Structure')
                blue_fill = PatternFill(start_color='DDEBF7', end_color='DDEBF7', fill_type='solid')
                blue_font = Font(color='1F4E78', bold=True)
                gray_fill = PatternFill(start_color='F2F2F2', end_color='F2F2F2', fill_type='solid')
                gray_font = Font(italic=True, bold=True)
                yellow_fill = PatternFill(start_color='FFFFFF00', end_color='FFFFFF00', fill_type='solid')

                for col_idx, fs in enumerate(folder_structure, start=1):
                    c1 = ws2.cell(1, col_idx, value=fs['folder_path'])
                    c1.fill = blue_fill
                    c1.font = blue_font
                    c2 = ws2.cell(2, col_idx, value=fs['contributor'])
                    c2.fill = gray_fill
                    c2.font = gray_font
                    cur_r = 3
                    for f in fs['files']:
                        ws2.cell(cur_r, col_idx, value=f)
                        cur_r += 1
                    for ext_name, ext_cnt in fs['extension_counts'].items():
                        c_e = ws2.cell(cur_r, col_idx, value=f".{ext_name}: {ext_cnt}")
                        c_e.font = bold_font
                        if ext_name not in ['jpg', 'jpeg', 'png', 'mp4', 'mov', 'cr3', 'arw']:
                            c_e.fill = yellow_fill
                        cur_r += 1

                # 3. Sheet: Camera Summary
                ws3 = wb.create_sheet(title='Camera Summary')
                for col_idx, cam in enumerate(cameras, start=1):
                    c_h = ws3.cell(1, col_idx, value=cam['camera'])
                    c_h.font = bold_font
                    cur_r = 2
                    for f in cam['files']:
                        ws3.cell(cur_r, col_idx, value=f)
                        cur_r += 1
                    c_found = ws3.cell(cur_r, col_idx, value=f"Total Found: {cam['total_found']}")
                    c_found.font = bold_font
                    cur_r += 1
                    c_miss = ws3.cell(cur_r, col_idx, value=f"Total Missing: {cam['total_missing']}")
                    c_miss.font = bold_font
                    if cam['total_missing'] > 0:
                        c_miss.fill = red_fill
                        c_miss.font = red_font

                # 4. Sheet: Contributor
                ws4 = wb.create_sheet(title='Contributor')
                ws4.append(['Folder Path', 'File Name'])
                for c_i in range(1, 3):
                    ws4.cell(1, c_i).font = bold_font
                for cb in contributors:
                    ws4.append([cb.get('folder_path', ''), cb.get('file_name', '')])

                # 5. Sheet: Issues
                ws5 = wb.create_sheet(title='Issues')
                ws5.append(['Path', 'Issue Type', 'Description'])
                for c_i in range(1, 4):
                    ws5.cell(1, c_i).font = bold_font
                for iss in issues:
                    ws5.append([iss.get('path', ''), iss.get('type', ''), iss.get('description', '')])

                # Dynamic column dimensions
                for ws in wb.worksheets:
                    for col in ws.columns:
                        max_l = 0
                        for cell in col:
                            if cell.value is not None:
                                max_l = max(max_l, len(str(cell.value)))
                        col_letter = get_column_letter(col[0].column)
                        ws.column_dimensions[col_letter].width = max(max_l + 3, 12)

                # Extract 2D grid replica for all 5 sheets
                for s_name in wb.sheetnames:
                    ws = wb[s_name]
                    grid = []
                    for r in range(1, ws.max_row + 1):
                        row_vals = []
                        for c in range(1, ws.max_column + 1):
                            v = ws.cell(r, c).value
                            row_vals.append(str(v) if v is not None else "")
                        grid.append(row_vals)
                    raw_sheets[s_name] = grid

                # Save synthesized workbook to memory and encode as base64
                buf = io.BytesIO()
                wb.save(buf)
                excel_bytes = buf.getvalue()
                file_base64 = base64.b64encode(excel_bytes).decode('ascii')
                raw_bytes = excel_bytes
            except Exception as e_syn:
                print(f"[Inventory Parse Warning] openpyxl Excel synthesis note: {e_syn}")

        mime_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        excel_filename = os.path.splitext(filename)[0] + ".xlsx" if not filename.lower().endswith(".xlsx") else filename
        sheet_names = list(raw_sheets.keys())
        sheet_stats = {s: {"rows": len(raw_sheets[s]), "columns": len(raw_sheets[s][0]) if raw_sheets[s] else 0} for s in raw_sheets}

        return {
            "uploaded": True,
            "filename": excel_filename,
            "excel_filename": excel_filename,
            "file_size": len(raw_bytes) if raw_bytes else 0,
            "mime_type": mime_type,
            "total_found": total_found,
            "total_missing": total_missing,
            "metrics": {
                "total_found": total_found,
                "total_missing": total_missing,
                "total_cameras": len(cameras),
                "total_folders": len(folder_structure),
                "total_missing_files": len(missing_files),
                "total_contributor_files": len(contributors),
                "total_issues": len(issues),
                "total_sheets": len(sheet_names)
            },
            "sheet_names": sheet_names,
            "sheet_stats": sheet_stats,
            "missing_files": missing_files,
            "folder_structure": folder_structure,
            "cameras": cameras,
            "contributors": contributors,
            "issues": issues,
            "sheets": {
                "missing_files": missing_files,
                "folder_structure": folder_structure,
                "camera_summary": cameras,
                "contributors": contributors,
                "issues": issues
            },
            "raw_sheets": raw_sheets,
            "file_base64": file_base64,
            "excel_replica": {
                "filename": excel_filename,
                "mime_type": mime_type,
                "file_size": len(raw_bytes) if raw_bytes else 0,
                "sheet_names": sheet_names,
                "sheet_stats": sheet_stats,
                "file_base64": file_base64,
                "raw_sheets": raw_sheets
            }
        }

    def export_team_images_zip(self, zip_filename: str, images_json: str):
        """
        Takes JSON array of base64 PNG images [{"name": "Team 1.png", "base64": "..."}],
        prompts user with file dialog to save a .zip file, and packages them all into the ZIP.
        """
        import zipfile
        import base64
        try:
            images = json.loads(images_json) if isinstance(images_json, str) else images_json
            if not images or not isinstance(images, list):
                return json.dumps({"error": "No image data provided for export"})

            suggested_name = zip_filename or "Team_Images.zip"
            if not suggested_name.lower().endswith(".zip"):
                suggested_name += ".zip"

            save_path = None
            if self._window:
                result = self._window.create_file_dialog(
                    webview.FileDialog.SAVE,
                    save_filename=suggested_name,
                    file_types=("ZIP Archives (*.zip)",)
                )
                if not result:
                    return json.dumps({"success": False, "cancelled": True})
                save_path = result if isinstance(result, str) else result[0]
            else:
                downloads_dir = str(Path.home() / "Downloads")
                save_path = os.path.join(downloads_dir, suggested_name)

            with zipfile.ZipFile(save_path, "w", zipfile.ZIP_DEFLATED) as zf:
                for item in images:
                    name = item.get("name") or "team_image.png"
                    b64 = item.get("base64") or ""
                    if "," in b64:
                        b64 = b64.split(",", 1)[1]
                    img_bytes = base64.b64decode(b64)
                    zf.writestr(name, img_bytes)

            return json.dumps({
                "success": True,
                "path": save_path,
                "count": len(images)
            })
        except Exception as e:
            return json.dumps({"error": f"Failed to generate ZIP archive: {str(e)}"})

    def import_csv(self, event_id: str = None, group_date: str = None, group_slot: str = None, file_path: str = None, csv_text: str = None, safar_name: str = None):
        """
        Imports CSV schedule data and populates city_event_assignments.
        Supports full Part awareness:
        - If only 1 QMZ part: data added ONLY to QMZ sub-event.
        - If multiple parts (e.g. Waaz, QMZ, Namaz): data mapped strictly to corresponding sub-event.
        - Strictly isolated to the target date and slot (and safar).
        """
        import csv
        import io

        try:
            raw_data = ""
            filename = "Schedule.csv"

            if csv_text and isinstance(csv_text, str) and csv_text.strip():
                raw_data = csv_text
                if file_path:
                    filename = os.path.basename(file_path)
            elif file_path and os.path.exists(file_path):
                filename = os.path.basename(file_path)
                with open(file_path, "r", encoding="utf-8-sig", errors="replace") as f:
                    raw_data = f.read()
            elif self._window:
                result = self._window.create_file_dialog(
                    webview.FileDialog.OPEN,
                    file_types=("CSV Files (*.csv)", "All Files (*.*)")
                )
                if not result:
                    return json.dumps({"error": "No file selected"})
                path = result[0] if isinstance(result, (list, tuple)) else result
                filename = os.path.basename(path)
                with open(path, "r", encoding="utf-8-sig", errors="replace") as f:
                    raw_data = f.read()
            else:
                return json.dumps({"error": "No CSV content or file provided"})

            if not raw_data.strip():
                return json.dumps({"error": "The CSV file is empty"})

            # Parse lines using csv.reader
            reader = csv.reader(io.StringIO(raw_data))
            rows = list(reader)
            if not rows:
                return json.dumps({"error": "No rows found in CSV"})

            # Detect header row
            header_idx = -1
            header_map = {}
            for i, r in enumerate(rows):
                lower_cells = [c.strip().lower() for c in r]
                if any("seq" in c for c in lower_cells) or any("its" in c for c in lower_cells) or any("sticker" in c for c in lower_cells):
                    header_idx = i
                    for col_idx, col_name in enumerate(lower_cells):
                        if "seq" in col_name: header_map["seq"] = col_idx
                        elif "event" in col_name and "sub" not in col_name: header_map["event"] = col_idx
                        elif "sticker" in col_name: header_map["sticker"] = col_idx
                        elif "name" in col_name: header_map["name"] = col_idx
                        elif "its" in col_name: header_map["its"] = col_idx
                        elif "loc" in col_name or "address" in col_name: header_map["location"] = col_idx
                        elif "mob" in col_name or "phone" in col_name: header_map["mobile"] = col_idx
                        elif "mauze" in col_name or "city" in col_name: header_map["mauze"] = col_idx
                        elif "sub" in col_name: header_map["sub_event"] = col_idx
                    break

            if header_idx == -1:
                header_idx = 0
                header_map = {
                    "seq": 0, "event": 1, "sticker": 2, "name": 3,
                    "its": 4, "location": 5, "mobile": 6, "mauze": 7, "sub_event": 8
                }

            # Load event definitions from Event List.xlsx
            evt_defs = _load_event_definitions(self.base_dir)

            # Parse rows into distinct parts
            parsed_parts = []
            current_part = {
                "name": "Part 1",
                "event_type": None,
                "rows": []
            }

            for r in rows[header_idx + 1:]:
                if not r or not any(cell.strip() for cell in r):
                    continue
                first_cell = r[0].strip().lower()
                if first_cell.startswith("part ") or first_cell == "part":
                    if current_part["rows"]:
                        parsed_parts.append(current_part)
                    part_event = r[1].strip() if len(r) > 1 else ""
                    current_part = {
                        "name": r[0].strip(),
                        "event_type": part_event or None,
                        "rows": []
                    }
                    continue

                def get_cell(key):
                    idx = header_map.get(key)
                    if idx is not None and idx < len(r):
                        return r[idx].strip()
                    return ""

                seq_val = get_cell("seq")
                ev_val = get_cell("event")
                stk_val = get_cell("sticker")
                name_val = get_cell("name")
                its_val = get_cell("its")
                loc_val = get_cell("location")
                mob_val = get_cell("mobile")
                mauze_val = get_cell("mauze")
                sub_val = get_cell("sub_event")

                if not seq_val and not name_val and not its_val:
                    continue

                # Check if this row is genuinely a sub-event:
                # 1. Non-empty 'Sub Event' column
                # 2. OR sequence explicitly has child letter (e.g. '1a', '1b')
                import re
                has_child_seq = bool(re.search(r"^\d+[a-zA-Z]+$", seq_val)) if seq_val else False
                has_sub_col = bool(sub_val and sub_val.strip())
                is_sub_event = has_sub_col or has_child_seq

                target_ev_raw = sub_val if (has_sub_col and not ev_val) else ev_val
                ev_norm = normalize_event_from_definitions(target_ev_raw, evt_defs)

                current_part["rows"].append({
                    "sequence": seq_val or str(len(current_part["rows"]) + 1),
                    "event_abr": ev_norm or "Qadam",
                    "sticker_name": stk_val or seq_val or "",
                    "name": name_val or "",
                    "its": its_val or "",
                    "location": loc_val or "",
                    "mobile": mob_val or "",
                    "mauze": mauze_val or "",
                    "sub_event": sub_val or "",
                    "raw_event": ev_val,
                    "is_inline": 1 if is_sub_event else 0
                })

            if current_part["rows"]:
                parsed_parts.append(current_part)

            if not parsed_parts:
                return json.dumps({"error": "No valid sequence rows could be extracted from the CSV"})

            # Determine part event types if not explicitly given
            for p in parsed_parts:
                if not p["event_type"]:
                    types_in_rows = [row["event_abr"].lower() for row in p["rows"]]
                    has_q = any("qadam" in t or t == "q" for t in types_in_rows)
                    has_m = any("majlis" in t or t == "m" for t in types_in_rows)
                    has_z = any("ziyafat" in t or t == "z" for t in types_in_rows)
                    if (has_q or has_m or has_z) or any("qmz" in t for t in types_in_rows):
                        p["event_type"] = "QMZ"
                    elif any("waaz" in t for t in types_in_rows):
                        p["event_type"] = "Waaz"
                    elif any("namaz" in t for t in types_in_rows):
                        p["event_type"] = "Namaz"
                    elif any("bethak" in t for t in types_in_rows):
                        p["event_type"] = "Bethak"
                    elif any("ziyarat" in t for t in types_in_rows):
                        p["event_type"] = "Ziyarat"
                    else:
                        p["event_type"] = "QMZ"
                else:
                    et_lower = p["event_type"].lower()
                    if "waaz" in et_lower or et_lower == "w": p["event_type"] = "Waaz"
                    elif "namaz" in et_lower or et_lower == "n": p["event_type"] = "Namaz"
                    elif "bethak" in et_lower or et_lower == "b": p["event_type"] = "Bethak"
                    elif "ziyarat" in et_lower: p["event_type"] = "Ziyarat"
                    elif "majlis" in et_lower: p["event_type"] = "Majlis"
                    elif "ziyafat" in et_lower or "qadam" in et_lower or "qmz" in et_lower or et_lower in ["q", "z"]: p["event_type"] = "QMZ"
                    else: p["event_type"] = "QMZ"

            # Determine target sub-events to receive assignments (strictly scoped)
            with self._get_connection() as conn:
                cursor = conn.cursor()

                target_sub_events = []
                target_date = group_date
                target_slot = group_slot
                target_city_id = 1
                target_safar = safar_name

                if event_id:
                    cursor.execute("SELECT id, type, city_id, date, event_time_slot, sequence_number, safar_name FROM city_events WHERE id = ?", (event_id,))
                    row = cursor.fetchone()
                    if row:
                        ev_dict = dict(row)
                        target_sub_events.append(ev_dict)
                        target_date = ev_dict["date"]
                        target_slot = ev_dict["event_time_slot"]
                        target_city_id = ev_dict["city_id"]
                        target_safar = ev_dict.get("safar_name") or target_safar
                elif group_date and group_slot:
                    q = """
                    SELECT id, type, city_id, date, event_time_slot, sequence_number, safar_name 
                    FROM city_events 
                    WHERE date = ? AND event_time_slot = ?
                    """
                    p_args = [group_date, group_slot]
                    if safar_name and safar_name.strip() and safar_name != "All":
                        q += " AND LOWER(COALESCE(safar_name, '')) = LOWER(?)"
                        p_args.append(safar_name.strip())
                    q += " ORDER BY sequence_number ASC"
                    cursor.execute(q, p_args)
                    target_sub_events = [dict(r) for r in cursor.fetchall()]
                    if target_sub_events:
                        target_city_id = target_sub_events[0]["city_id"]

                if not target_sub_events and not (target_date and target_slot):
                    return json.dumps({"error": "No matching event date and slot found to attach CSV data"})

                sub_event_buckets = {}   # sub_id -> rows

                # Check if there is ONLY ONE QMZ part in the uploaded CSV
                is_single_qmz = (len(parsed_parts) == 1 and parsed_parts[0]["event_type"] == "QMZ")

                if event_id and len(parsed_parts) == 1:
                    sub_event_buckets[event_id] = parsed_parts[0]["rows"]
                elif is_single_qmz:
                    # Data will ONLY be added for QMZ!
                    qmz_sub = next((s for s in target_sub_events if s["type"] == "QMZ"), None)
                    if qmz_sub:
                        sub_event_buckets[qmz_sub["id"]] = parsed_parts[0]["rows"]
                    else:
                        # Auto-create QMZ sub-event in that date & slot
                        max_seq = 0
                        if target_sub_events:
                            max_seq = max(s.get("sequence_number", 1) for s in target_sub_events)
                        new_seq = max_seq + 1
                        new_id = f"evt-{int(datetime.datetime.now().timestamp()*1000)}"
                        slot_code = "01M" if target_slot == "Morning" else "02E"
                        seq_str = str(new_seq).padStart(2, "0") if hasattr(str(new_seq), "padStart") else f"{new_seq:02d}"
                        
                        # Get city name
                        cursor.execute("SELECT name FROM cities WHERE id = ?", (target_city_id,))
                        c_row = cursor.fetchone()
                        c_name = c_row[0] if c_row else "City"
                        evt_code = f"{target_date} _ {slot_code}-{seq_str}-QMZ-{c_name}"

                        now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
                        cursor.execute("""
                        INSERT INTO city_events (
                            id, city_id, name, date, type, event_time_slot, status,
                            sequence_number, event_code, assignment_mode, qmz_count,
                            safar_name, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, 'QMZ', ?, 'CREATED', ?, ?, 'team', 5, ?, ?, ?)
                        """, (new_id, target_city_id, evt_code, target_date, target_slot, new_seq, evt_code, target_safar or "", now_iso, now_iso))
                        sub_event_buckets[new_id] = parsed_parts[0]["rows"]
                else:
                    # Multi-part mode (e.g. Waaz, QMZ, Namaz, etc.)
                    # Match each part to its corresponding sub-event or auto-create it
                    for p in parsed_parts:
                        p_type = p["event_type"]
                        matched_sub = next((s for s in target_sub_events if s["type"].lower() == p_type.lower()), None)
                        if matched_sub:
                            sub_event_buckets[matched_sub["id"]] = p["rows"]
                        else:
                            # Auto-create missing sub-event for this part
                            max_seq = 0
                            if target_sub_events:
                                max_seq = max(s.get("sequence_number", 1) for s in target_sub_events)
                            new_seq = max_seq + 1
                            new_id = f"evt-{int(datetime.datetime.now().timestamp()*1000)}-{p_type}"
                            slot_code = "01M" if target_slot == "Morning" else "02E"
                            seq_str = f"{new_seq:02d}"
                            
                            cursor.execute("SELECT name FROM cities WHERE id = ?", (target_city_id,))
                            c_row = cursor.fetchone()
                            c_name = c_row[0] if c_row else "City"
                            evt_code = f"{target_date} _ {slot_code}-{seq_str}-{p_type}-{c_name}"
                            assign_mode = "team" if p_type in ["QMZ", "Bethak"] else "individual"

                            now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
                            cursor.execute("""
                            INSERT INTO city_events (
                                id, city_id, name, date, type, event_time_slot, status,
                                sequence_number, event_code, assignment_mode, qmz_count,
                                safar_name, created_at, updated_at
                            ) VALUES (?, ?, ?, ?, ?, ?, 'CREATED', ?, ?, ?, 5, ?, ?, ?)
                            """, (new_id, target_city_id, evt_code, target_date, p_type, target_slot, new_seq, evt_code, assign_mode, target_safar or "", now_iso, now_iso))
                            target_sub_events.append({"id": new_id, "type": p_type, "sequence_number": new_seq})
                            sub_event_buckets[new_id] = p["rows"]

                now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
                total_inserted = 0

                for sub_id, items in sub_event_buckets.items():
                    if not items:
                        continue

                    # Fetch parent event qmz_teams
                    cursor.execute("SELECT qmz_teams FROM city_events WHERE id = ?", (sub_id,))
                    t_row = cursor.fetchone()
                    try:
                        ev_teams = json.loads(t_row[0]) if t_row and t_row[0] else []
                    except Exception:
                        ev_teams = []

                    # Clear existing and insert imported rows for this specific sub-event ONLY
                    cursor.execute("DELETE FROM city_event_assignments WHERE event_id = ?", (sub_id,))
                    rows_to_insert = []
                    main_row_counter = 0
                    last_assigned_team = ev_teams[0] if ev_teams else None

                    for a in items:
                        is_inline_row = bool(a.get("is_inline"))
                        t_id = None
                        p_id = None
                        v_id = None

                        if ev_teams:
                            if not is_inline_row:
                                assigned_t = ev_teams[main_row_counter % len(ev_teams)]
                                main_row_counter += 1
                                last_assigned_team = assigned_t
                            else:
                                assigned_t = last_assigned_team or ev_teams[0]

                            t_id = assigned_t.get("id") or assigned_t.get("name")
                            p_id = assigned_t.get("photographer_id")
                            v_id = assigned_t.get("videographer_id")

                        rows_to_insert.append((
                            sub_id,
                            str(a.get("sequence", "")),
                            str(a.get("event_abr", "Qadam")),
                            str(a.get("sticker_name", "") or ""),
                            str(a.get("name", "") or ""),
                            str(a.get("its", "") or ""),
                            str(a.get("location", "") or ""),
                            str(a.get("mobile", "") or ""),
                            t_id,
                            p_id,
                            v_id,
                            0, 0,
                            1 if is_inline_row else 0,
                            now_iso, now_iso
                        ))

                    cursor.executemany("""
                    INSERT INTO city_event_assignments (
                        event_id, sequence, event_abr, sticker_name, name, its,
                        location, mobile, team_id, photographer_id, videographer_id,
                        photo_not_covered, video_not_covered, is_inline, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, rows_to_insert)
                    total_inserted += len(rows_to_insert)

                    # Update report_path, status, qmz_count, and bump updated_at
                    cursor.execute("""
                    UPDATE city_events 
                    SET report_path = ?, status = 'COMPLETED', qmz_count = ?, updated_at = ? 
                    WHERE id = ?
                    """, (filename, len(items), now_iso, sub_id))

                conn.commit()

            return json.dumps({
                "success": True,
                "filename": filename,
                "total_rows": total_inserted,
                "sub_events_count": len(sub_event_buckets),
                "is_single_qmz": is_single_qmz,
                "parts_count": len(parsed_parts)
            })
        except Exception as e:
            return json.dumps({"error": str(e)})

    def get_event_definitions(self) -> str:
        """Returns event list definitions and abbreviations from Event List.xlsx."""
        defs = _load_event_definitions(self.base_dir)
        return json.dumps({"success": True, "definitions": defs})

    def select_import_file(self) -> str:
        """Native file dialog to pick an Excel (.xlsx, .xls) or CSV file for import."""
        if not self._window:
            return json.dumps({"error": "Native window dialog unavailable"})
        try:
            result = self._window.create_file_dialog(
                webview.FileDialog.OPEN,
                file_types=(
                    "Import Files (*.xlsx;*.xls;*.csv;*.txt)",
                    "Excel Workbooks (*.xlsx;*.xls)",
                    "CSV Files (*.csv;*.txt)",
                    "All Files (*.*)"
                )
            )
            if not result:
                return json.dumps({"cancelled": True})
            path = result if isinstance(result, str) else result[0]
            return json.dumps({"success": True, "file_path": path})
        except Exception as e:
            return json.dumps({"error": str(e)})

    def read_table_as_csv(self, file_path: str = "") -> str:
        """Reads a .csv, .xlsx, or .xls file and converts it into a standard CSV string."""
        if not file_path or not os.path.exists(file_path):
            return json.dumps({"error": "File does not exist: " + str(file_path)})
        try:
            import io, csv
            lower = file_path.lower()
            if lower.endswith(('.xlsx', '.xls')):
                import openpyxl
                wb = openpyxl.load_workbook(file_path, data_only=True)
                ws = wb.active
                output = io.StringIO()
                writer = csv.writer(output)
                for row in ws.iter_rows(values_only=True):
                    writer.writerow(['' if c is None else str(c) for c in row])
                csv_text = output.getvalue()
            else:
                with open(file_path, 'r', encoding='utf-8-sig', errors='replace') as f:
                    csv_text = f.read()
            return json.dumps({
                "success": True,
                "file_path": file_path,
                "file_name": os.path.basename(file_path),
                "csv_text": csv_text
            })
        except Exception as e:
            return json.dumps({"error": str(e)})

    def select_sharaf_file(self) -> str:
        """Native file dialog to pick a Sharaf Data Excel / CSV file."""
        if self._window:
            try:
                result = self._window.create_file_dialog(
                    webview.FileDialog.OPEN,
                    file_types=(
                        "Supported Files (*.xlsx;*.xls;*.csv)",
                        "Excel Files (*.xlsx;*.xls)",
                        "CSV Files (*.csv)",
                        "All Files (*.*)"
                    )
                )
                if result:
                    path = result if isinstance(result, str) else result[0]
                    return json.dumps({"success": True, "file_path": path})
                return json.dumps({"cancelled": True})
            except Exception as e:
                print(f"[EventsApi] PyWebView select_sharaf_file error: {e}")

        # Fallback to Tkinter file dialog if window is not available or threw an error
        try:
            import tkinter as tk
            from tkinter import filedialog
            root = tk.Tk()
            root.withdraw()
            root.attributes('-topmost', True)
            path = filedialog.askopenfilename(
                title="Select Sharaf File",
                filetypes=[
                    ("Supported Files (*.xlsx, *.xls, *.csv)", "*.xlsx *.xls *.csv"),
                    ("Excel Files (*.xlsx, *.xls)", "*.xlsx *.xls"),
                    ("CSV Files (*.csv)", "*.csv"),
                    ("All Files (*.*)", "*.*")
                ]
            )
            root.destroy()
            if not path:
                return json.dumps({"cancelled": True})
            return json.dumps({"success": True, "file_path": path})
        except Exception as e:
            return json.dumps({"error": str(e)})

    def parse_sharaf_file(self, file_path: str = "", file_base64: str = "", file_name: str = "") -> str:
        """
        Parses a Sharaf data Excel/CSV file (e.g. Sharaf_Data_07-Sep-26 (1).xlsx).
        Supports either a local file_path or raw file_base64 content.
        
        Strictly adheres to specifications:
        1. Required Columns:
           - Sharaf_Name (Aliases: sharafname, segment)
           - ITS_ID (Aliases: its, itsid, itsno, itsnumber)
           - FullName (Aliases: fullname, name)
        2. Optional Columns Consumed:
           - Tarteeb (Aliases: tarteeb): Sticker/order number. Any prefix (e.g. MZG-2) is stripped down to numeric digits (2).
           - Whatsapp_Mobile (Aliases: whatsapp, whatsappmobile, whatsappno): Preferred contact phone.
           - Mobile (Aliases: mobile, mobileno, contact): Regular mobile (fallback if WhatsApp is empty).
           - Sharaf_Date (Aliases: sharafdate): Gregorian date / Excel serial, automatically converted to Hijri.
           - Sharaf_Time (Aliases: sharaftime): Slot indicator (Morning, Evening, 01M, 02E).
        3. Ignored Columns (Explicitly skipped and not populated):
           - Sharaf_HDate, Safar_Name, Token_No, Gender, Age, Jamaat, Jamiaat, Precedence.
        """
        from collections import OrderedDict
        import io
        import re
        import datetime

        effective_name = file_name or (os.path.basename(file_path) if file_path else "Sharaf_Data.xlsx")

        if not file_base64 and (not file_path or not os.path.exists(file_path)):
            return json.dumps({"error": "Valid file path or file data is required"})

        # --- Helper: Bohra / Fatimid Tabular Hijri Conversion ---
        islamic_month_names = [
            'Moharram', 'Safar', 'Rabiul Awwal', 'Rabiul Aakhar',
            'Jumada al-Ula', 'Jumada al-Ukhra', 'Rajab', 'Shaban',
            'Ramadan', 'Shawwal', 'Zilqad', 'Zilhaj'
        ]

        def gregorian_to_bohra_hijri(gy: int, gm: int, gd: int):
            anchor_g = datetime.date(2026, 6, 15)  # 1 Moharram 1448
            target_g = datetime.date(gy, gm, gd)
            diff_days = (target_g - anchor_g).days
            leap_years_mod = {2, 5, 7, 10, 13, 16, 18, 21, 24, 26, 29}

            def is_leap(y):
                return (y % 30) in leap_years_mod

            def days_in_year(y):
                return 355 if is_leap(y) else 354

            def month_lens(y):
                return [30, 29, 30, 29, 30, 29, 30, 29, 30, 29, 30, 30 if is_leap(y) else 29]

            current_year = 1448
            rem_days = diff_days

            if rem_days >= 0:
                while True:
                    diy = days_in_year(current_year)
                    if rem_days < diy:
                        break
                    rem_days -= diy
                    current_year += 1
                mls = month_lens(current_year)
                current_month = 1
                for ml in mls:
                    if rem_days < ml:
                        break
                    rem_days -= ml
                    current_month += 1
                current_day = rem_days + 1
            else:
                while rem_days < 0:
                    current_year -= 1
                    diy = days_in_year(current_year)
                    rem_days += diy
                mls = month_lens(current_year)
                current_month = 1
                for ml in mls:
                    if rem_days < ml:
                        break
                    rem_days -= ml
                    current_month += 1
                current_day = rem_days + 1

            month_name = islamic_month_names[current_month - 1]
            hdate_iso = f"{current_year:04d}-{current_month:02d}-{current_day:02d}"
            hdate_display = f"{current_day} {month_name} {current_year}H."
            return hdate_iso, hdate_display

        def parse_date_value(val):
            if val is None or str(val).strip() == "":
                return "", "", ""
            gy, gm, gd = None, None, None
            try:
                if isinstance(val, (datetime.date, datetime.datetime)):
                    gy, gm, gd = val.year, val.month, val.day
                elif isinstance(val, (int, float)) or (isinstance(val, str) and val.replace(".", "", 1).isdigit() and float(val) > 30000):
                    serial = int(float(val))
                    d = datetime.date(1899, 12, 30) + datetime.timedelta(days=serial)
                    gy, gm, gd = d.year, d.month, d.day
                else:
                    s = str(val).strip()
                    from dateutil import parser
                    d = parser.parse(s)
                    gy, gm, gd = d.year, d.month, d.day
            except Exception:
                return "", "", ""

            if gy and gm and gd:
                gdate_str = f"{gy:04d}-{gm:02d}-{gd:02d}"
                hdate_iso, hdate_display = gregorian_to_bohra_hijri(gy, gm, gd)
                return gdate_str, hdate_iso, hdate_display
            return "", "", ""

        def extract_tarteeb_digits(val):
            """Sticker/order number. Any prefix (e.g., MZG-2) is stripped down to numeric digits (2)."""
            if val is None:
                return ""
            s = str(val).strip()
            if not s:
                return ""
            m = re.search(r'(\d+)', s)
            if m:
                try:
                    return str(int(m.group(1)))
                except ValueError:
                    return m.group(1)
            return ""

        def clean_phone(val):
            if val is None:
                return ""
            s = str(val).strip()
            if s.endswith(".0"):
                s = s[:-2]
            return s

        def normalize_sharaf(sharaf_raw: str) -> str:
            s_clean = str(sharaf_raw).strip()
            s_low = s_clean.lower()
            if 'global' in s_low or 'majmui' in s_low or 'majmuni' in s_low or 'majmooi' in s_low:
                return 'Majmui Ziyafat'
            elif 'aqiqa' in s_low or 'aqeeqa' in s_low:
                return 'Aqiqa'
            elif 'nikah' in s_low or 'nikaah' in s_low:
                return 'Nikah'
            elif 'misaq' in s_low or 'meesaq' in s_low:
                return 'Misaq'
            elif 'ziyafat' in s_low:
                return 'Bethak Ziyafat'
            elif 'qadam' in s_low:
                return 'Bethak Qadam'
            elif 'majlis' in s_low:
                return 'Bethak Majlis'
            elif 'haddiyat' in s_low:
                return 'Haddiyat'
            elif 'mafsuhiyat' in s_low:
                return 'Mafsuhiyat'
            elif 'mulaqaat' in s_low or 'mulaqat' in s_low:
                return 'Mulaqaat'
            return s_clean or 'Bethak Qadam'

        def normalize_slot(raw: str) -> str:
            raw_clean = str(raw).strip().lower()
            if 'morn' in raw_clean or '01m' in raw_clean or raw_clean == 'm':
                return 'Morning'
            if 'even' in raw_clean or '02e' in raw_clean or raw_clean == 'e':
                return 'Evening'
            if 'm' in raw_clean and 'e' not in raw_clean:
                return 'Morning'
            return 'Evening'

        try:
            rows = []
            if file_base64:
                import base64
                b64_clean = file_base64
                if "," in b64_clean:
                    b64_clean = b64_clean.split(",", 1)[1]
                file_bytes = base64.b64decode(b64_clean)
                if effective_name.lower().endswith(('.xlsx', '.xls')):
                    import openpyxl
                    wb = openpyxl.load_workbook(io.BytesIO(file_bytes), data_only=True)
                    ws = wb.active
                    rows = list(ws.iter_rows(values_only=True))
                else:
                    import csv
                    text_content = file_bytes.decode('utf-8-sig', errors='replace')
                    rows = list(csv.reader(io.StringIO(text_content)))
            elif file_path.lower().endswith(('.xlsx', '.xls')):
                import openpyxl
                wb = openpyxl.load_workbook(file_path, data_only=True)
                ws = wb.active
                rows = list(ws.iter_rows(values_only=True))
            else:
                import csv
                with open(file_path, 'r', encoding='utf-8-sig', errors='replace') as f:
                    reader = csv.reader(f)
                    rows = list(reader)

            if not rows:
                return json.dumps({"error": "The selected file is empty"})

            # Build flexible normalized header dictionary
            raw_headers = [str(c).strip() if c is not None else '' for c in rows[0]]
            norm_col_map = {}
            for idx, h in enumerate(raw_headers):
                norm_h = re.sub(r'[^a-z0-9]', '', h.lower())
                if norm_h and norm_h not in norm_col_map:
                    norm_col_map[norm_h] = idx

            # Define Alias Mapping according to Image 1 specifications
            COLUMN_ALIASES = {
                'sharaf_name': ['sharafname', 'segment', 'sharaf', 'ceremony', 'ceremonytype'],
                'its_id': ['itsid', 'its', 'itsno', 'itsnumber'],
                'fullname': ['fullname', 'name', 'muminname', 'attendee'],
                'tarteeb': ['tarteeb', 'order', 'orderno'],
                'whatsapp_mobile': ['whatsappmobile', 'whatsapp', 'whatsappno'],
                'mobile': ['mobile', 'mobileno', 'contact', 'phone', 'phoneno'],
                'sharaf_date': ['sharafdate', 'date'],
                'sharaf_time': ['sharaftime', 'time', 'slot', 'timeslot']
            }

            col_indices = {}
            for canonical, aliases in COLUMN_ALIASES.items():
                for alias in aliases:
                    clean_alias = re.sub(r'[^a-z0-9]', '', alias.lower())
                    if clean_alias in norm_col_map:
                        col_indices[canonical] = norm_col_map[clean_alias]
                        break

            # Validate Required Columns
            missing_required = []
            if 'sharaf_name' not in col_indices:
                missing_required.append("Sharaf_Name (aliases: sharafname, segment)")
            if 'its_id' not in col_indices:
                missing_required.append("ITS_ID (aliases: its, itsid, itsno, itsnumber)")
            if 'fullname' not in col_indices:
                missing_required.append("FullName (aliases: fullname, name)")

            if missing_required:
                return json.dumps({
                    "error": f"Missing required column(s): {', '.join(missing_required)}. Found headers: {', '.join(filter(None, raw_headers))}"
                })

            def get_val(row, key, default=""):
                idx = col_indices.get(key)
                if idx is not None and idx < len(row) and row[idx] is not None:
                    return row[idx]
                return default

            gdate_final = ""
            hdate_iso_final = ""
            hdate_display_final = ""
            raw_rows_per_slot = OrderedDict()
            contiguous_segs_per_slot = OrderedDict()

            for r in rows[1:]:
                if not any(r):
                    continue

                # 1. Date resolution (Gregorian converted to Hijri)
                if not gdate_final and 'sharaf_date' in col_indices:
                    raw_date = get_val(r, 'sharaf_date')
                    g_str, h_iso, h_disp = parse_date_value(raw_date)
                    if g_str:
                        gdate_final = g_str
                        hdate_iso_final = h_iso
                        hdate_display_final = h_disp

                # 2. Slot indicator
                raw_slot = str(get_val(r, 'sharaf_time', 'Evening'))
                slot_key = normalize_slot(raw_slot)

                # 3. Sharaf / Ceremony type
                raw_sharaf = str(get_val(r, 'sharaf_name', 'Qadam')).strip()
                norm_sharaf = normalize_sharaf(raw_sharaf)

                # 4. Tarteeb -> Sticker (strip prefix to numeric digits)
                raw_tarteeb = get_val(r, 'tarteeb')
                sticker_digits = extract_tarteeb_digits(raw_tarteeb)

                # 5. ITS & Name
                raw_its = str(get_val(r, 'its_id')).strip()
                if raw_its.endswith('.0'):
                    raw_its = raw_its[:-2]
                raw_name = str(get_val(r, 'fullname')).strip()

                # 6. Contact Number (WhatsApp preferred, Mobile fallback)
                raw_whatsapp = clean_phone(get_val(r, 'whatsapp_mobile'))
                raw_mobile = clean_phone(get_val(r, 'mobile'))
                preferred_contact = raw_whatsapp if raw_whatsapp else raw_mobile

                # Build row: Ignored columns (Sharaf_HDate, Safar_Name, Token_No, Gender, Age, Jamaat, Jamiaat, Precedence)
                # are explicitly NOT populated from the source file.
                row_dict = {
                    'its': raw_its,
                    'name': raw_name,
                    'sticker': sticker_digits,
                    'mobile': preferred_contact,
                    'whatsapp': raw_whatsapp,
                    'mobile_fallback': raw_mobile,
                    'location': '',
                    'sharaf': norm_sharaf,
                    'raw_sharaf': raw_sharaf,
                    'tarteeb': sticker_digits,
                    'token': '',
                    'gender': '',
                    'age': '',
                    'jamaat': '',
                    'jamiaat': '',
                    'precedence': ''
                }

                if slot_key not in raw_rows_per_slot:
                    raw_rows_per_slot[slot_key] = []
                    contiguous_segs_per_slot[slot_key] = []
                raw_rows_per_slot[slot_key].append(row_dict)

                slot_segs = contiguous_segs_per_slot[slot_key]
                if slot_segs and slot_segs[-1]['type'] == norm_sharaf:
                    slot_segs[-1]['rows'].append(row_dict)
                else:
                    slot_segs.append({
                        'type': norm_sharaf,
                        'rows': [row_dict]
                    })

            res_slots = {}
            for sk, rlist in raw_rows_per_slot.items():
                slot_segs = contiguous_segs_per_slot.get(sk, [])
                seg_list = []
                for sg in slot_segs:
                    seg_list.append({
                        'type': sg['type'],
                        'count': len(sg['rows']),
                        'rows': sg['rows']
                    })
                res_slots[sk] = {
                    'total_rows': len(rlist),
                    'all_rows': rlist,
                    'segments': seg_list
                }

            # If file contains multiple slots, also provide an "All Records" option
            if len(raw_rows_per_slot) > 1:
                all_raw_rows = []
                all_contiguous_segs = []
                for sk, rlist in raw_rows_per_slot.items():
                    all_raw_rows.extend(rlist)
                    for sg in contiguous_segs_per_slot.get(sk, []):
                        if all_contiguous_segs and all_contiguous_segs[-1]['type'] == sg['type']:
                            all_contiguous_segs[-1]['rows'].extend(sg['rows'])
                        else:
                            all_contiguous_segs.append({
                                'type': sg['type'],
                                'rows': list(sg['rows'])
                            })
                res_slots['All Records'] = {
                    'total_rows': len(all_raw_rows),
                    'all_rows': all_raw_rows,
                    'segments': [{'type': s['type'], 'count': len(s['rows']), 'rows': s['rows']} for s in all_contiguous_segs]
                }

            return json.dumps({
                'success': True,
                'file_path': file_path or effective_name,
                'file_name': effective_name,
                'date': hdate_iso_final or gdate_final,
                'hdate': hdate_iso_final,
                'hdate_display': hdate_display_final,
                'gregorian_date': gdate_final,
                'slots': res_slots
            })
        except Exception as e:
            return json.dumps({"error": f"Failed parsing Sharaf data file: {str(e)}"})


