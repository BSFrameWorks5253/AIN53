# Instructions for AI: How to Read, Parse, and Sync .AIN53 Files on the Website

> **Context for AI Developer:**  
> You are tasked with implementing the `.AIN53` file intake, parser, dashboard viewer, and database synchronization logic on the **AIN53 central website**.  
> This document is your single source of truth. It contains the exact file format specification, schema definitions, validation algorithms, frontend React/TypeScript components, and backend database ingestion endpoints. Follow these specifications precisely.

---

## 1. What is an `.AIN53` File?

An **`.AIN53`** file is a standardized, self-contained JSON package exported by field coordinators using the AIN53 desktop application. It transfers Safar schedules, event configurations, ceremony sequences, and photography/videography crew camera series to the central website.

### Key Characteristics:
* **File Extension:** `.AIN53` (Accept `.AIN53`, `.ain53`, or `.json` in web dropzones).
* **MIME Type:** `application/x-ain53+json` or `application/json`.
* **Encoding:** UTF-8 text formatted as JSON.
* **Naming Conventions:**
  * **Full Safar Package:** Named exactly as the Safar name: `<Safar_Name>.AIN53` (e.g. `Khandala.AIN53`, `1448-08 Raipur.AIN53`).
  * **Single Date Package:** Named strictly as the Hijri date: `<Date>.AIN53` (e.g. `1448-04-06.AIN53`).
* **Root Signature:** Must contain `"format": "AIN53_SAFAR_SYNC_PACKAGE"`.

---

## 2. Complete TypeScript Data Contract

Copy and paste these TypeScript interfaces directly into your web codebase (e.g. `types/ain53.ts`):

```typescript
export interface Ain53Package {
  $schema?: string;
  format: 'AIN53_SAFAR_SYNC_PACKAGE';
  version: string; // e.g. "1.0.0"
  generator: {
    app: string;
    version: string;
    platform?: string;
    exported_at: string; // ISO 8601 UTC timestamp
  };
  safar: {
    id?: number | string;
    name: string; // e.g. "Khandala"
    scope: 'FULL_SAFAR' | 'DATE_SLOT' | 'SINGLE_DAY';
    target_date?: string | null; // e.g. "1448-04-06"
    target_slot?: 'Morning' | 'Evening' | '01M' | '02E' | null;
    created_at?: string | null;
  };
  cities: Ain53City[];
  crew: Ain53CrewMember[];
  schedule: Ain53DaySchedule[];
  inventory_reports?: Ain53SlotInventoryReport[]; // All uploaded inventory reports & 1000% Excel replicas
  inventory_files?: Record<string, Ain53SlotInventoryReport>; // Filename-indexed map of full Excel replicas
  metrics: {
    total_days: number;
    total_events: number;
    total_sequences: number;
    total_crew: number;
    total_inventory_reports?: number;
    covered_sequences: number;
    uncovered_sequences: number;
  };
}

export interface Ain53City {
  id: number;
  name: string;
  teams_required?: number;
  core_teams?: any[];
}

export interface Ain53CrewMember {
  id: number;
  name: string; // e.g. "Murtaza Bhai"
  role: string; // "Photographer", "Videographer", "Coordinator", "Drone"
  series: string; // Camera SD card series e.g. "A", "B", "C"
  phone?: string;
  email?: string;
  its?: string;
  active?: boolean;
}

export interface Ain53DaySchedule {
  date: string; // Hijri date format YYYY-MM-DD, e.g. "1448-04-06"
  slots: Ain53Slot[];
}

export interface Ain53Slot {
  slot_code: '01M' | '02E'; // 01M = Morning, 02E = Evening
  slot_name: 'Morning' | 'Evening';
  start_time?: string; // e.g. "09:30 AM"
  end_time?: string;
  status: 'CREATED' | 'IN_PROGRESS' | 'COMPLETED' | string;
  event_ended?: boolean; // True when coordinator uploaded inventory report and finalized slot
  event_end_time?: string; // Timestamp when slot was marked ended
  inventory_report?: Ain53SlotInventoryReport | null; // Verified Drive Inventory Audit Report
  events_count: number;
  sequences_count: number;
  events: Ain53Event[];
}

export interface Ain53SlotInventoryReport {
  uploaded?: boolean;
  filename: string; // Must end with _Inventory_Report.xlsx or _Invertory_Report.xlsx
  file_size?: number; // Raw byte size
  total_found: number; // Count of verified media files on drive
  total_missing: number; // Count of missing files
  uploaded_at?: string; // ISO timestamp
  file_base64?: string; // Complete raw binary of the original .xlsx file (base64 encoded) for direct 1-click download / byte-for-byte reconstruction

  // High-level audit metrics
  metrics?: {
    total_found: number;
    total_missing: number;
    total_cameras: number;
    total_folders: number;
    total_missing_files: number;
    total_contributor_files: number;
    total_issues: number;
  };

  // Structured Replica Sheets
  missing_files?: Array<{
    folder_path: string;
    file_name: string;
    status: string;
    camera_type: string;
  }>;
  folder_structure?: Array<{
    column_index?: number;
    folder_path: string;
    contributor: string;
    total_files: number;
    files: Array<{ file_name: string; extension: string; camera_type: string }>;
    extension_counts: Record<string, number>;
  }>;
  cameras?: Array<{
    camera: string;
    files_count: number;
    total_found: number;
    total_missing: number;
    files: Array<{ folder: string; file: string; status: string; camera_type: string }>;
  }> | Record<string, any>;
  contributors?: Array<{
    folder_path: string;
    file_name: string;
  }>;
  issues?: Array<{
    path: string;
    type: string;
    description: string;
  }>;

  // Normalized sheet container
  sheets?: {
    missing_files: Array<any>;
    folder_structure: Array<any>;
    camera_summary: Array<any>;
    contributors: Array<any>;
    issues: Array<any>;
  };

  // Exact 2D matrix of every cell across all worksheets: { [sheet_name]: string[][] }
  raw_sheets?: Record<string, string[][]>;

  // 1000% Exact Excel Replica Bundle
  mime_type?: string;
  sheet_names?: string[];
  sheet_stats?: Record<string, { rows: number; columns: number }>;
  excel_replica?: {
    filename: string;
    mime_type: string;
    file_size: number;
    sheet_names: string[];
    sheet_stats: Record<string, { rows: number; columns: number }>;
    file_base64: string;
    raw_sheets: Record<string, string[][]>;
  };
}

export interface Ain53Event {
  id: string; // Event UUID or string ID
  sequence_number: number; // Order within the slot (1, 2, 3...)
  event_code: string; // e.g. "1448-04-06 _ 01M-01-Waaz-Khandala"
  name: string; // e.g. "Subah Waaz Mubarak"
  type: 'Waaz' | 'Majlis' | 'Namaz' | 'Ziyarat' | 'Bethak' | 'QMZ' | 'Isteqbal' | 'Wada' | string;
  engine: 'Standard' | 'QMZ' | 'Bethak';
  city_id: number;
  city_name: string;
  status: 'CREATED' | 'ONGOING' | 'COMPLETED' | string;
  start_time?: string;
  report_time?: string;
  assignment_mode: 'individual' | 'team';
  qmz_count?: number;
  qmz_teams?: any[];
  bethak_counts?: any[];
  individual_assignment?: Record<string, any>;
  recording_details?: Record<string, any>;
  notes?: string;
  assignments: Ain53Assignment[];
}

export interface Ain53Assignment {
  id?: number | string;
  sequence: string; // e.g. "1", "2", "3a"
  event_abr: string; // e.g. "Q", "MZ", "N", "AQ", "BM", "BQ", "BZ", "Waaz"
  sticker_name: string; // Physical sticker label e.g. "Q-01", "N-02"
  name: string; // Host / Mumineen Name
  its: string; // 8-digit ITS number
  location: string; // Venue / Address / Bunglow
  mobile: string; // Contact phone number
  team_id?: string;
  photographer_id?: number | null;
  photographer_name?: string;
  photographer_series?: string; // Camera SD Series assigned to photographer
  videographer_id?: number | null;
  videographer_name?: string;
  videographer_series?: string; // Camera SD Series assigned to videographer
  photo_not_covered: boolean;
  video_not_covered: boolean;
  is_inline?: boolean;
}
```

---

## 3. Client-Side Reading & Validation Engine

Implement this parser function in your frontend codebase (e.g. `utils/ain53Parser.ts`):

```typescript
export interface ParseResult {
  success: boolean;
  package?: Ain53Package;
  error?: string;
}

export async function parseAin53File(file: File): Promise<ParseResult> {
  // 1. Validate Extension
  const name = file.name.toLowerCase();
  if (!name.endsWith('.ain53') && !name.endsWith('.json')) {
    return {
      success: false,
      error: `Invalid file extension (${file.name}). Expected a .AIN53 package file.`
    };
  }

  // 2. Read UTF-8 Text
  let text = '';
  try {
    text = await file.text();
  } catch (err: any) {
    return { success: false, error: `Failed to read file: ${err.message}` };
  }

  // 3. Parse JSON
  let data: any;
  try {
    data = JSON.parse(text);
  } catch (err: any) {
    return { success: false, error: `File is not valid JSON: ${err.message}` };
  }

  // 4. Validate Format Signature
  if (data.format !== 'AIN53_SAFAR_SYNC_PACKAGE') {
    return {
      success: false,
      error: `Invalid format signature. Expected 'AIN53_SAFAR_SYNC_PACKAGE', found '${data.format || 'none'}'`
    };
  }

  // 5. Validate Required Structure
  if (!data.safar || !data.safar.name) {
    return { success: false, error: "Package is missing required 'safar.name' attribute." };
  }
  if (!Array.isArray(data.schedule)) {
    return { success: false, error: "Package is missing required 'schedule' array." };
  }

  return {
    success: true,
    package: data as Ain53Package
  };
}
```

---

## 4. Ready-to-Use React Uploader & Dropzone Component

Copy and paste this component into your React / Next.js app (e.g. `components/Ain53Uploader.tsx`):

```tsx
import React, { useState, useRef } from 'react';
import { Ain53Package } from '../types/ain53';
import { parseAin53File } from '../utils/ain53Parser';

interface Props {
  onSyncLoaded: (pkg: Ain53Package) => void;
  onSyncToServer?: (pkg: Ain53Package) => Promise<void>;
}

export const Ain53Uploader: React.FC<Props> = ({ onSyncLoaded, onSyncToServer }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = async (file: File) => {
    setError(null);
    setSuccessMsg(null);
    setLoading(true);

    try {
      const result = await parseAin53File(file);
      if (!result.success || !result.package) {
        setError(result.error || 'Failed to parse .AIN53 package');
        return;
      }

      const pkg = result.package;
      onSyncLoaded(pkg);

      // If backend sync callback provided, send payload to server
      if (onSyncToServer) {
        await onSyncToServer(pkg);
      }

      setSuccessMsg(
        `Successfully loaded ${pkg.safar.name} (${pkg.metrics.total_events} events, ${pkg.metrics.total_sequences} sequences)`
      );
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      style={{
        border: `2px dashed ${isDragging ? '#10b981' : '#374151'}`,
        borderRadius: '14px',
        padding: '2.5rem 1.5rem',
        textAlign: 'center',
        background: isDragging ? 'rgba(16, 185, 129, 0.05)' : '#111827',
        color: '#f9fafb',
        cursor: 'pointer',
        transition: 'all 0.2s ease'
      }}
      onClick={() => fileInputRef.current?.click()}
    >
      <input
        type="file"
        ref={fileInputRef}
        accept=".AIN53,.ain53,.json"
        style={{ display: 'none' }}
        onChange={(e) => {
          if (e.target.files && e.target.files[0]) {
            processFile(e.target.files[0]);
          }
        }}
      />

      <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>📦</div>
      <h3 style={{ fontSize: '1.25rem', fontWeight: 700, margin: '0 0 0.5rem 0' }}>
        Drop your <span style={{ color: '#10b981' }}>.AIN53</span> Safar file here
      </h3>
      <p style={{ color: '#9ca3af', fontSize: '0.9rem', margin: '0 0 1.25rem 0' }}>
        or click to browse your computer (.AIN53 or .json)
      </p>

      {loading && <p style={{ color: '#38bdf8' }}>Parsing and syncing Safar data...</p>}
      {error && <p style={{ color: '#ef4444', fontWeight: 600 }}>⚠️ {error}</p>}
      {successMsg && <p style={{ color: '#10b981', fontWeight: 600 }}>✓ {successMsg}</p>}
    </div>
  );
};
```

---

## 5. Backend Database Synchronization & Upsert Pipeline

When receiving an `.AIN53` package at `POST /api/safar/sync`:

### Database Schema (SQL - PostgreSQL / MySQL / SQLite):
```sql
CREATE TABLE IF NOT EXISTS safars (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cities (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) UNIQUE NOT NULL,
  teams_required INT DEFAULT 1
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  role VARCHAR(100) DEFAULT 'Photographer',
  series VARCHAR(50) DEFAULT '',
  safar_name VARCHAR(255) DEFAULT '',
  phone VARCHAR(50) DEFAULT '',
  its VARCHAR(50) DEFAULT '',
  active BOOLEAN DEFAULT TRUE,
  UNIQUE(name, safar_name)
);

CREATE TABLE IF NOT EXISTS city_events (
  id VARCHAR(255) PRIMARY KEY,
  safar_name VARCHAR(255) NOT NULL,
  city_id INT REFERENCES cities(id),
  name VARCHAR(255),
  date VARCHAR(50) NOT NULL, -- Hijri date YYYY-MM-DD
  type VARCHAR(50) NOT NULL, -- Waaz, Bethak, QMZ, Majlis, Namaz, etc.
  event_time_slot VARCHAR(20) NOT NULL, -- Morning, Evening
  sequence_number INT DEFAULT 1,
  event_code VARCHAR(255),
  start_time VARCHAR(50),
  report_time VARCHAR(50),
  assignment_mode VARCHAR(50) DEFAULT 'individual',
  qmz_count INT DEFAULT 1,
  qmz_teams JSONB DEFAULT '[]',
  bethak_counts JSONB DEFAULT '[]',
  status VARCHAR(50) DEFAULT 'CREATED',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS city_event_assignments (
  id SERIAL PRIMARY KEY,
  event_id VARCHAR(255) REFERENCES city_events(id) ON DELETE CASCADE,
  sequence VARCHAR(50) NOT NULL,
  event_abr VARCHAR(50) NOT NULL,
  sticker_name VARCHAR(100) DEFAULT '',
  name VARCHAR(255) DEFAULT '',
  its VARCHAR(50) DEFAULT '',
  location VARCHAR(255) DEFAULT '',
  mobile VARCHAR(50) DEFAULT '',
  team_id VARCHAR(50),
  photographer_id INT,
  videographer_id INT,
  photo_not_covered BOOLEAN DEFAULT FALSE,
  video_not_covered BOOLEAN DEFAULT FALSE,
  is_inline BOOLEAN DEFAULT FALSE,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS slot_inventory_reports (
  id SERIAL PRIMARY KEY,
  safar_name VARCHAR(255) NOT NULL,
  date VARCHAR(50) NOT NULL,
  slot VARCHAR(50) NOT NULL,
  filename VARCHAR(255) NOT NULL,
  total_found INT DEFAULT 0,
  total_missing INT DEFAULT 0,
  missing_files JSONB DEFAULT '[]',
  issues JSONB DEFAULT '[]',
  cameras JSONB DEFAULT '[]',
  details_json JSONB DEFAULT '{}', -- Complete exact replica containing all 5 sheets and raw_sheets
  file_base64 TEXT DEFAULT '',      -- Original .xlsx binary content base64 encoded for byte-for-byte download
  uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(safar_name, date, slot)
);
```

### Node.js / Next.js / Express Ingestion Controller:
```javascript
// controllers/safarSyncController.js

export async function syncAin53Package(dbClient, pkg) {
  if (pkg.format !== 'AIN53_SAFAR_SYNC_PACKAGE') {
    throw new Error('Invalid AIN53 package format signature');
  }

  const safarName = pkg.safar.name.trim();

  await dbClient.query('BEGIN');
  try {
    // 1. Upsert Safar
    await dbClient.query(
      `INSERT INTO safars (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`,
      [safarName]
    );

    // 2. Upsert Cities
    const cityMap = {};
    for (const city of (pkg.cities || [])) {
      const res = await dbClient.query(
        `INSERT INTO cities (name, teams_required) VALUES ($1, $2)
         ON CONFLICT (name) DO UPDATE SET teams_required = EXCLUDED.teams_required
         RETURNING id, name`,
        [city.name, city.teams_required || 1]
      );
      cityMap[city.name.toLowerCase()] = res.rows[0].id;
    }

    // 3. Upsert Crew Members
    for (const crew of (pkg.crew || [])) {
      await dbClient.query(
        `INSERT INTO users (name, role, series, safar_name, phone, its, active)
         VALUES ($1, $2, $3, $4, $5, $6, true)
         ON CONFLICT (name, safar_name) DO UPDATE SET
           role = EXCLUDED.role,
           series = EXCLUDED.series,
           phone = EXCLUDED.phone,
           its = EXCLUDED.its`,
        [crew.name, crew.role || 'Photographer', crew.series || '', safarName, crew.phone || '', crew.its || '']
      );
    }

    // 4. Upsert Schedule, Events, and Sequences
    let eventsCount = 0;
    let seqCount = 0;

    for (const day of pkg.schedule) {
      for (const slot of day.slots) {
        // Ingest Slot Inventory Report & Full Replica (if attached to this slot)
        if (slot.inventory_report) {
          const inv = slot.inventory_report;
          await dbClient.query(
            `INSERT INTO slot_inventory_reports (
              safar_name, date, slot, filename, total_found, total_missing,
              missing_files, issues, cameras, details_json, file_base64, uploaded_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            ON CONFLICT (safar_name, date, slot) DO UPDATE SET
              filename = EXCLUDED.filename,
              total_found = EXCLUDED.total_found,
              total_missing = EXCLUDED.total_missing,
              missing_files = EXCLUDED.missing_files,
              issues = EXCLUDED.issues,
              cameras = EXCLUDED.cameras,
              details_json = EXCLUDED.details_json,
              file_base64 = EXCLUDED.file_base64,
              uploaded_at = EXCLUDED.uploaded_at`,
            [
              safarName, day.date, slot.slot_code, inv.filename,
              inv.total_found, inv.total_missing,
              JSON.stringify(inv.missing_files || []),
              JSON.stringify(inv.issues || []),
              JSON.stringify(inv.cameras || []),
              JSON.stringify(inv), // Store full replica with all 5 sheets and raw_sheets
              inv.file_base64 || '',
              inv.uploaded_at || new Date().toISOString()
            ]
          );
        }

        for (const evt of slot.events) {
          const resolvedCityId = cityMap[evt.city_name?.toLowerCase()] || evt.city_id || 1;

          await dbClient.query(
            `INSERT INTO city_events (
              id, safar_name, city_id, name, date, type, event_time_slot,
              sequence_number, event_code, start_time, report_time,
              assignment_mode, qmz_count, qmz_teams, bethak_counts, status, event_ended, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW())
            ON CONFLICT (id) DO UPDATE SET
              name = EXCLUDED.name,
              status = EXCLUDED.status,
              event_ended = EXCLUDED.event_ended,
              start_time = EXCLUDED.start_time,
              report_time = EXCLUDED.report_time,
              qmz_teams = EXCLUDED.qmz_teams,
              bethak_counts = EXCLUDED.bethak_counts,
              updated_at = NOW()`,
            [
              evt.id, safarName, resolvedCityId, evt.name, day.date, evt.type, slot.slot_name,
              evt.sequence_number, evt.event_code, evt.start_time || '', evt.report_time || '',
              evt.assignment_mode || 'individual', evt.qmz_count || 1,
              JSON.stringify(evt.qmz_teams || []), JSON.stringify(evt.bethak_counts || []),
              evt.status || 'CREATED', slot.event_ended ? true : (evt.status === 'COMPLETED')
            ]
          );
          eventsCount++;

          // Reconcile assignments: Delete old assignments for this event to avoid orphans, then insert fresh
          await dbClient.query(`DELETE FROM city_event_assignments WHERE event_id = $1`, [evt.id]);

          for (const asgn of (evt.assignments || [])) {
            await dbClient.query(
              `INSERT INTO city_event_assignments (
                event_id, sequence, event_abr, sticker_name, name, its,
                location, mobile, team_id, photographer_id, videographer_id,
                photo_not_covered, video_not_covered, is_inline, updated_at
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())`,
              [
                evt.id, asgn.sequence, asgn.event_abr, asgn.sticker_name || '', asgn.name || '',
                asgn.its || '', asgn.location || '', asgn.mobile || '', asgn.team_id || null,
                asgn.photographer_id || null, asgn.videographer_id || null,
                asgn.photo_not_covered || false, asgn.video_not_covered || false,
                asgn.is_inline ? true : false
              ]
            );
            seqCount++;
          }
        }
      }
    }

    await dbClient.query('COMMIT');
    return { success: true, safar: safarName, eventsCount, seqCount };
  } catch (err) {
    await dbClient.query('ROLLBACK');
    throw err;
  }
}
```

---

## 6. Real-World Minimal Sample Payload for Testing

You can use this JSON snippet directly to test your website's parser and ingestion pipeline:

```json
{
  "format": "AIN53_SAFAR_SYNC_PACKAGE",
  "version": "1.0.0",
  "generator": {
    "app": "AIN53 Data Management",
    "version": "1.5.0",
    "exported_at": "2026-09-27T16:45:00.000Z"
  },
  "safar": {
    "name": "Khandala",
    "scope": "FULL_SAFAR"
  },
  "cities": [
    { "id": 1, "name": "Khandala", "teams_required": 2 }
  ],
  "crew": [
    { "id": 101, "name": "Murtaza Bhai", "role": "Photographer", "series": "A" },
    { "id": 102, "name": "Hussain Bhai", "role": "Videographer", "series": "B" }
  ],
  "schedule": [
    {
      "date": "1448-04-06",
      "slots": [
        {
          "slot_code": "01M",
          "slot_name": "Morning",
          "start_time": "09:30 AM",
          "status": "COMPLETED",
          "events_count": 1,
          "sequences_count": 2,
          "events": [
            {
              "id": "evt-001",
              "sequence_number": 1,
              "event_code": "1448-04-06 _ 01M-01-Waaz-Khandala",
              "name": "Subah Waaz Mubarak",
              "type": "Waaz",
              "engine": "Standard",
              "city_id": 1,
              "city_name": "Khandala",
              "status": "COMPLETED",
              "assignment_mode": "individual",
              "assignments": [
                {
                  "sequence": "1",
                  "event_abr": "Waaz",
                  "sticker_name": "WZ-01",
                  "name": "Stage Setup & Waaz",
                  "its": "50392817",
                  "location": "Main Hall",
                  "photographer_id": 101,
                  "photographer_name": "Murtaza Bhai",
                  "photographer_series": "A",
                  "videographer_id": 102,
                  "videographer_name": "Hussain Bhai",
                  "videographer_series": "B",
                  "photo_not_covered": false,
                  "video_not_covered": false
                },
                {
                  "sequence": "2",
                  "event_abr": "Q",
                  "sticker_name": "Q-01",
                  "name": "Shk Shabbir Bhai",
                  "its": "30485921",
                  "location": "Bunglow 7",
                  "photographer_id": 101,
                  "photographer_name": "Murtaza Bhai",
                  "photographer_series": "A",
                  "videographer_id": 102,
                  "videographer_name": "Hussain Bhai",
                  "videographer_series": "B",
                  "photo_not_covered": false,
                  "video_not_covered": false
                }
              ]
            }
          ]
        }
      ]
    }
  ],
  "metrics": {
    "total_days": 1,
    "total_events": 1,
    "total_sequences": 2,
    "total_crew": 2,
    "covered_sequences": 2,
    "uncovered_sequences": 0
  }
}
```

---

## 7. Rendering the Exact Replica Inventory Sheets & 1-Click Excel Download

When coordinators upload an inventory report (`*_Inventory_Report.xlsx` or `..._Invertory_Report.xlsx`), the AIN53 desktop system parses and packages an **exact, 100% replica** of the workbook directly inside `slot.inventory_report`.

### 7.1 Architecture of the Exact Replica
The `slot.inventory_report` object provides three complementary ways to access and display audit information without requiring client-side Excel parsing:

1. **Structured Sheet Collections (`report.sheets` or top-level properties):**
   - **Sheet 1: Folder Structure (`report.folder_structure`):** List of folders scanned, contributor names, total files count, individual files with extension and detected camera type, and extension breakdown (`extension_counts`: e.g. `{ ".mp4": 12, ".jpg": 48 }`).
   - **Sheet 2: Camera Summary (`report.cameras`):** Breakdown per camera letter (e.g. `A`, `B`, `C`), including files count, total found, total missing, and file inventory.
   - **Sheet 3: Contributor Submissions (`report.contributors`):** Folder path and file names submitted by external contributors/helpers.
   - **Sheet 4: Issues Log (`report.issues`):** Audit warnings or errors detected during drive scans (`{ path, type, description }`).
   - **Sheet 5: Missing Files (`report.missing_files`):** All missing ceremony sequence media files (`{ folder_path, file_name, status, camera_type }`).

2. **Raw Cell 2D Matrix (`report.raw_sheets`):**
   - Direct row-by-row cell matrix (`Record<string, string[][]>`), mapping every sheet tab (e.g. `raw_sheets["Folder Structure"]`, `raw_sheets["Camera Summary"]`) exactly as it was laid out in the spreadsheet.

3. **Original Binary Reconstruction (`report.file_base64`):**
   - Contains the base64-encoded binary content of the uploaded `.xlsx` file. Enables instant client-side download of the original file without additional API calls.

### 7.2 Web Client: 1-Click Download Implementation

Use this helper in React or vanilla JavaScript to trigger an immediate browser download of the original Excel file:

```typescript
export function downloadOriginalInventoryReport(report: Ain53SlotInventoryReport) {
  if (!report.file_base64) {
    alert("No raw binary data available for this report.");
    return;
  }

  // Convert Base64 back to binary Blob
  const byteCharacters = atob(report.file_base64);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  const blob = new Blob([byteArray], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });

  // Create temporary anchor to trigger browser download
  const downloadUrl = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = downloadUrl;
  a.download = report.filename || 'Drive_Inventory_Report.xlsx';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(downloadUrl);
}
```

### 7.3 React Component: Multi-Sheet Accordion Viewer

```tsx
import React, { useState } from 'react';
import { Ain53SlotInventoryReport } from '../types/ain53';
import { downloadOriginalInventoryReport } from '../utils/downloadReport';

export const InventoryReportReplicaViewer: React.FC<{ report: Ain53SlotInventoryReport }> = ({ report }) => {
  const [activeTab, setActiveTab] = useState<'folders' | 'cameras' | 'missing' | 'contributors' | 'issues'>('folders');

  return (
    <div className="inventory-replica-container" style={{ border: '1px solid #374151', borderRadius: '10px', padding: '1rem', background: '#111827' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div>
          <h4 style={{ margin: 0, color: '#f3f4f6' }}>📑 {report.filename}</h4>
          <span style={{ fontSize: '0.85rem', color: '#9ca3af' }}>
            Found: <strong style={{ color: '#34d399' }}>{report.total_found}</strong> | 
            Missing: <strong style={{ color: '#f87171' }}>{report.total_missing}</strong>
          </span>
        </div>
        {report.file_base64 && (
          <button
            onClick={() => downloadOriginalInventoryReport(report)}
            style={{ padding: '0.5rem 1rem', background: '#059669', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
          >
            📥 Download Original .xlsx
          </button>
        )}
      </div>

      {/* Sheet Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid #374151', paddingBottom: '0.5rem', marginBottom: '1rem' }}>
        <button onClick={() => setActiveTab('folders')} style={{ fontWeight: activeTab === 'folders' ? 'bold' : 'normal' }}>
          Folder Structure ({report.folder_structure?.length || 0})
        </button>
        <button onClick={() => setActiveTab('cameras')} style={{ fontWeight: activeTab === 'cameras' ? 'bold' : 'normal' }}>
          Camera Summary ({Array.isArray(report.cameras) ? report.cameras.length : 0})
        </button>
        <button onClick={() => setActiveTab('missing')} style={{ fontWeight: activeTab === 'missing' ? 'bold' : 'normal' }}>
          Missing Files ({report.missing_files?.length || 0})
        </button>
        <button onClick={() => setActiveTab('contributors')} style={{ fontWeight: activeTab === 'contributors' ? 'bold' : 'normal' }}>
          Contributors ({report.contributors?.length || 0})
        </button>
        <button onClick={() => setActiveTab('issues')} style={{ fontWeight: activeTab === 'issues' ? 'bold' : 'normal' }}>
          Issues ({report.issues?.length || 0})
        </button>
      </div>

      {/* Tab Panels */}
      {activeTab === 'folders' && (
        <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
          {report.folder_structure?.map((folder, idx) => (
            <div key={idx} style={{ padding: '0.5rem', borderBottom: '1px solid #1f2937' }}>
              <strong>📂 {folder.folder_path}</strong> ({folder.total_files} files)
              <div style={{ fontSize: '0.8rem', color: '#9ca3af' }}>
                Extensions: {JSON.stringify(folder.extension_counts)}
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'missing' && (
        <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
          {report.missing_files?.map((m, idx) => (
            <div key={idx} style={{ color: '#f87171', padding: '0.25rem 0' }}>
              ❌ {m.folder_path} / {m.file_name} [{m.camera_type}]
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
```

