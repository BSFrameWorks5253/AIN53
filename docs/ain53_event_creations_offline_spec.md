# AIN53 Event Architecture & Creation Specification (Offline Edition)

This specification provides the complete data contracts, algorithms, state engines, and full React/TypeScript implementations for **Standard**, **Bethak**, and **QMZ** event creation and management in AIN53.

---

## 1. Domain Model & Naming Standards

### 1.1 Event Engines
AIN53 categorizes every event into one of three distinct engines:

| Engine | Event Types | Assignment Model | Data Columns Used |
| :--- | :--- | :--- | :--- |
| **Standard** | `Waaz`, `Majlis`, `Namaz`, `Ziyarat`, `Isteqbal`, `Wada` | Individual / Multi-individual contributor assignment + optional inline sub-segments | `individual_assignment`, `individual_multi_assignments`, `city_event_assignments`, `recording_details` |
| **QMZ** | `QMZ` (legacy `QMZ-New`) | Multi-team rotation over sequenced family visits (Qadam, Majlis, Ziyafat) | `qmz_teams`, `qmz_count`, `city_event_assignments` |
| **Bethak** | `Bethak` | Segmented ceremony blocks (Nikah, Misaq, Haddiyat, etc.) with ceremony-level crew routing | `bethak_counts`, `qmz_teams`, `bethak_individual`, `bethak_multi_assignments`, `city_event_assignments` |

### 1.2 Slot & Sequence Numbering
* **Slot Grouping**: Events are grouped by `Date + Time Slot` (`date|||slot`).
  * Slots: `Morning` (Code `01M`) or `Evening` (Code `02E`).
* **Sequence within Slot**: Every event in a slot receives a 1-based chronological sequence number (`sequence_number`: `1, 2, 3...`).
* **Official Event Code**:
  $$\text{Event Code} = \{\text{HIJRI\_DATE}\} \_ \{\text{SLOT\_CODE}\}-\{\text{SEQ}\}-\{\text{TYPE}\}-\{\text{CITY}\}$$
  * *Example*: `1447-09-01 _ 01M-01-Waaz-Mumbai`
  * *Example*: `1447-09-01 _ 01M-02-Bethak-Mumbai`
  * *Example*: `1447-09-01 _ 01M-03-QMZ-Mumbai`

---

## 2. Database Schema (PostgreSQL / SQLite Equivalent)

### 2.1 Table: `city_events`
```sql
CREATE TABLE IF NOT EXISTS city_events (
    id TEXT PRIMARY KEY,
    city_id INTEGER NOT NULL,
    name TEXT,
    date TEXT NOT NULL,                         -- Hijri date: YYYY-MM-DD
    type TEXT NOT NULL CHECK (type IN ('Waaz','Majlis','Namaz','Ziyarat','QMZ','Bethak','Isteqbal','Wada')),
    event_time_slot TEXT NOT NULL CHECK (event_time_slot IN ('Morning','Evening')),
    status TEXT NOT NULL DEFAULT 'CREATED' CHECK (status IN ('CREATED','ONGOING','COMPLETED')),
    sequence_number INTEGER NOT NULL DEFAULT 1,
    event_code TEXT,
    start_time TEXT,                            -- HH:MM format
    report_time TEXT,                           -- HH:MM format
    assignment_mode TEXT DEFAULT 'individual' CHECK (assignment_mode IN ('individual','team')),
    coordinator_id INTEGER,
    
    -- Standard engine fields
    individual_assignment JSONB,                -- { photographer: { user_id, location }, videographer: ..., drone: ... }
    individual_multi_assignments JSONB DEFAULT '[]'::jsonb,
    recording_details JSONB,                    -- For Waaz camera operator configurations
    
    -- QMZ engine fields
    qmz_count INTEGER DEFAULT 1,
    qmz_teams JSONB DEFAULT '[]'::jsonb,        -- [ { id, name, photographer_id, videographer_id, save_for_reuse } ]
    sequence_assignments JSONB DEFAULT '{}'::jsonb,
    admin_override_sequences JSONB DEFAULT '{}'::jsonb,
    
    -- Bethak engine fields
    bethak_counts JSONB DEFAULT '[]'::jsonb,    -- [ { type: 'Nikah', count: 2 }, { type: 'Bethak QMZ', count: 3, subTypes: ['BQ','BM','BZ'] } ]
    bethak_individual JSONB,
    bethak_multi_assignments JSONB DEFAULT '[]'::jsonb,
    
    -- Lifecycle & governance
    event_ended BOOLEAN NOT NULL DEFAULT FALSE,
    event_end_time TIMESTAMPTZ,
    finalized BOOLEAN NOT NULL DEFAULT FALSE,
    report_path TEXT,
    notes TEXT,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_city_events_lookup ON city_events (city_id, date, event_time_slot, sequence_number);
```

### 2.2 Table: `city_event_assignments` (Granular Ceremony / Sequence Rows)
```sql
CREATE TABLE IF NOT EXISTS city_event_assignments (
    id BIGSERIAL PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES city_events(id) ON DELETE CASCADE,
    sequence TEXT NOT NULL,                     -- e.g. "1", "2", "3a", "3b"
    event_abr TEXT NOT NULL,                    -- e.g. "Qadam", "Majlis", "Nikah", "Misaq", "Waaz"
    sticker_name TEXT DEFAULT '',
    name TEXT DEFAULT '',                       -- Host / Mumineen Name
    its TEXT DEFAULT '',                        -- 8-digit ITS ID
    location TEXT DEFAULT '',
    mobile TEXT DEFAULT '',
    team_id TEXT,                              -- FK to QMZTeam.id or empty
    photographer_id INTEGER,                   -- FK to user
    videographer_id INTEGER,                   -- FK to user
    photo_not_covered BOOLEAN DEFAULT FALSE,
    video_not_covered BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT uq_cea_event_sequence_team UNIQUE NULLS NOT DISTINCT (event_id, sequence, team_id)
);

CREATE INDEX idx_cea_event_seq ON city_event_assignments (event_id, sequence);
```

---

## 3. TypeScript Interfaces & Data Contracts

```typescript
export type StandardEventType = 'Waaz' | 'Majlis' | 'Namaz' | 'Ziyarat' | 'Isteqbal' | 'Wada';
export type TeamEventType = 'QMZ' | 'Bethak';
export type CityEventType = StandardEventType | TeamEventType;
export type EventStatus = 'CREATED' | 'ONGOING' | 'COMPLETED';

export interface QMZTeam {
  id: string;
  name: string;
  photographer_id: number | null;
  videographer_id: number | null;
  save_for_reuse: boolean;
}

export interface QMZNewAssignment {
  sequence: string;
  event_abr: string;
  sticker_name: string;
  name: string;
  its: string;
  location: string;
  mobile: string;
  team_id: string | null;
  photographer_id: number | null;
  videographer_id: number | null;
  photo_not_covered?: boolean;
  video_not_covered?: boolean;
}

export interface BethakSegment {
  type: string;
  count: number;
  subTypes?: string[]; // Used by Bethak QMZ: ['BQ', 'BM', 'BZ']
}

export interface EventIndividualAssignment {
  photographer?: { user_id: number | null; location: string };
  videographer?: { user_id: number | null; location: string };
  drone?: { user_id: number | null; location: string };
}

export interface EventMultiIndividualAssignment {
  id: string;
  role: 'photographer' | 'videographer' | 'drone';
  user_id: number | null;
  location: string;
}

export interface CityEvent {
  id: string;
  name?: string;
  date: string;
  type: CityEventType;
  event_time_slot?: 'Morning' | 'Evening';
  status: EventStatus;
  start_time?: string | null;
  report_time?: string | null;
  assignment_mode?: 'individual' | 'team';
  coordinator_id?: number | null;
  sequence_number?: number;
  event_code?: string;
  
  // Standard fields
  individual_assignment?: EventIndividualAssignment;
  individual_multi_assignments?: EventMultiIndividualAssignment[];
  
  // QMZ fields
  qmz_count?: number;
  qmz_teams?: QMZTeam[];
  sequence_assignments?: Record<number, string>;
  
  // Bethak fields
  bethak_counts?: BethakSegment[];
  bethak_individual?: EventIndividualAssignment;
  bethak_multi_assignments?: EventMultiIndividualAssignment[];
  
  // Ceremony rows
  city_event_assignments?: QMZNewAssignment[];
  
  // Lifecycle
  event_ended: boolean;
  event_end_time?: string | null;
  finalized: boolean;
  report_path?: string | null;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
}
```

---

## 4. Event Creation Form & Hook Implementation

### 4.1 Form Hook (`useCreateEventForm.ts`)
```typescript
import { useState } from 'react';
import type { CityEventType } from '@/types';

export interface SubEventRow {
  id: string;
  type: CityEventType | '';
  cityId: number | 'new' | '';
  newCityName?: string;
}

export interface CreateEventForm {
  date: string;
  event_time_slot: 'Morning' | 'Evening';
  qmz_count: number;
  subEvents: SubEventRow[];
}

export const blankSubEvent = (defaultCityId?: number | 'new' | ''): SubEventRow => ({
  id: `sub-${Date.now()}-${Math.floor(Math.random() * 9999)}`,
  type: '',
  cityId: defaultCityId ?? '',
  newCityName: '',
});

export function useCreateEventForm(defaultCityId: number) {
  const [form, setForm] = useState<CreateEventForm>(() => ({
    date: '', // Provide default Hijri date
    event_time_slot: 'Morning',
    qmz_count: 1,
    subEvents: [blankSubEvent(defaultCityId)],
  }));

  const updateSubEvent = (id: string, patch: Partial<SubEventRow>) => {
    setForm(prev => ({
      ...prev,
      subEvents: prev.subEvents.map(s => s.id === id ? { ...s, ...patch } : s),
    }));
  };

  const removeSubEvent = (id: string) => {
    setForm(prev => ({
      ...prev,
      subEvents: prev.subEvents.filter(s => s.id !== id),
    }));
  };

  const addSubEvent = (cityId?: number | 'new' | '') => {
    setForm(prev => {
      const lastRow = prev.subEvents[prev.subEvents.length - 1];
      const nextCityId = lastRow ? lastRow.cityId : (cityId ?? defaultCityId);
      return {
        ...prev,
        subEvents: [
          ...prev.subEvents,
          {
            id: `sub-${Date.now()}-${Math.floor(Math.random() * 9999)}`,
            type: '',
            cityId: nextCityId,
            newCityName: '',
          },
        ],
      };
    });
  };

  const resetForm = (cityId?: number) => {
    setForm({
      date: '',
      event_time_slot: 'Morning',
      qmz_count: 1,
      subEvents: [blankSubEvent(cityId ?? defaultCityId)],
    });
  };

  const validateForm = (): SubEventRow[] | null => {
    if (!form.date) return null;
    const validSubs = form.subEvents.filter(s => s.type);
    if (validSubs.length === 0) return null;
    for (const sub of validSubs) {
      if (!sub.cityId) return null;
      if (sub.cityId === 'new' && !sub.newCityName?.trim()) return null;
    }
    return validSubs;
  };

  return { form, setForm, updateSubEvent, removeSubEvent, addSubEvent, resetForm, validateForm };
}
```

### 4.2 Multi-Event Creation Pipeline (`handleCreate`)
```typescript
export function getEventEngine(type: CityEventType): 'standard' | 'qmz' | 'bethak' {
  if (type === 'QMZ' || (type as string) === 'QMZ-New') return 'qmz';
  if (type === 'Bethak') return 'bethak';
  return 'standard';
}

export function generateEventCode(
  date: string,
  slot: 'Morning' | 'Evening',
  seq: number,
  type: string,
  cityName: string
): string {
  const slotCode = slot === 'Morning' ? '01M' : '02E';
  const seqStr = String(seq).padStart(2, '0');
  return `${date} _ ${slotCode}-${seqStr}-${type}-${cityName}`;
}

export const buildDefaultTeams = (targetCity: any): QMZTeam[] => {
  const coreTeams = targetCity.core_teams ?? [];
  const seeded = coreTeams.slice(0, Math.max(targetCity.teams_required || 0, 1)).map((ct: any, idx: number) => ({
    id: `team-${Date.now()}-${idx}-${Math.floor(Math.random() * 999)}`,
    name: `Team ${idx + 1}`,
    photographer_id: ct.photographer_id ?? null,
    videographer_id: ct.videographer_id ?? null,
    save_for_reuse: false,
  }));
  return seeded.length > 0
    ? seeded
    : [{ id: `team-${Date.now()}-0`, name: 'Team 1', photographer_id: null, videographer_id: null, save_for_reuse: false }];
};

export const buildQMZNewRows = (count: number, teams: QMZTeam[]): QMZNewAssignment[] => {
  if (count <= 0 || teams.length === 0) return [];
  return Array.from({ length: count }, (_, i) => {
    const team = teams[i % teams.length];
    return {
      sequence: String(i + 1),
      event_abr: 'Qadam',
      sticker_name: '',
      name: '',
      its: '',
      location: '',
      mobile: '',
      team_id: team.id,
      photographer_id: team.photographer_id,
      videographer_id: team.videographer_id,
    };
  });
};

export async function executeCreateEvents({
  form,
  validSubs,
  startingSeq,
  resolvedCity,
  cityName,
  cityId,
  saveEventToDb,
  syncAssignmentsToDb,
}: any) {
  let seq = startingSeq;
  const createdEvents: CityEvent[] = [];

  for (const sub of validSubs) {
    const type = sub.type as CityEventType;
    const engine = getEventEngine(type);
    const assignmentMode: 'individual' | 'team' = engine === 'standard' ? 'individual' : 'team';
    const eventCode = generateEventCode(form.date, form.event_time_slot, seq, type, cityName);

    let qmzTeams: QMZTeam[] | undefined;
    if ((engine === 'qmz' || engine === 'bethak') && resolvedCity) {
      qmzTeams = buildDefaultTeams(resolvedCity);
    }

    const initialAssignments = engine === 'qmz' ? buildQMZNewRows(form.qmz_count, qmzTeams ?? []) : [];

    const newEvent: CityEvent = {
      id: `evt-${Date.now()}-${Math.floor(Math.random() * 9999)}`,
      name: eventCode,
      date: form.date,
      type,
      event_time_slot: form.event_time_slot,
      status: 'CREATED',
      assignment_mode: assignmentMode,
      event_ended: false,
      finalized: false,
      sequence_number: seq,
      event_code: eventCode,
      ...(engine === 'qmz' && {
        qmz_teams: qmzTeams,
        qmz_count: form.qmz_count,
      }),
      ...(engine === 'bethak' && {
        bethak_counts: [],
        qmz_teams: qmzTeams,
        bethak_individual: {
          photographer: { user_id: null, location: '' },
          videographer: { user_id: null, location: '' },
          drone: { user_id: null, location: '' },
        },
        bethak_multi_assignments: [],
      }),
      individual_assignment: {
        photographer: { user_id: null, location: '' },
        videographer: { user_id: null, location: '' },
        drone: { user_id: null, location: '' },
      },
      individual_multi_assignments: [],
    };

    const saved = await saveEventToDb(newEvent, cityId);

    if (initialAssignments.length > 0) {
      await syncAssignmentsToDb(saved.id, initialAssignments);
    }

    createdEvents.push({
      ...saved,
      city_event_assignments: initialAssignments,
    });

    seq++;
  }

  return createdEvents;
}
```

---

## 5. The Three Event Engines: Core Rules & Implementations

### 5.1 Standard Engine (`StandardUnifiedView`)
Used for `Waaz`, `Majlis`, `Namaz`, `Ziyarat`, `Isteqbal`, and `Wada`.

* **Primary Contributor Selection**: Allows picking primary Photographer, Videographer, and Drone operators directly or pulling from city Core Teams.
* **Inline Segments**: Sub-assignments nested within a Standard event (e.g., Nikah ceremony or Ziyafat visit happening during a Waaz event). These receive letter-appended sequences (e.g., `1a`, `1b`).
* **Waaz Recording Metadata**: Dedicated camera config panel recording:
  * Number of fixed cameras
  * Per-camera videographer operator assignments
  * External recorder status & audio system operator details

### 5.2 QMZ Engine (`QMZNewUnifiedView`)
Used for multi-sequence house and family visits (`Qadam`, `Majlis`, `Ziyafat`).

* **Multi-Team Round-Robin**:
  * Configures Team 1, Team 2... with primary photographer and videographer.
  * Spreads sequences round-robin: Sequence 1 -> Team 1, Sequence 2 -> Team 2, Sequence 3 -> Team 1...
* **Inline Insertion & Reordering**: Allows inserting sequences before/after any row with automatic renumbering.
* **Bulk Paste / CSV Import**:
  * Parses TSV (Excel copy-paste) or CSV into columns: `[Seq, Type, Sticker, Name, ITS, Location, Mobile]`.
  * Preserves team crew assignments while updating Mumineen recipient data.
* **Coverage Exceptions**: Supports explicitly marking a sequence as `photo_not_covered` or `video_not_covered`.

### 5.3 Bethak Engine (`BethakUnifiedView`)
Used for assembly ceremonies comprising multiple distinct ceremony segments.

* **Segment Types**:
  * `Nikah`, `Misaq`, `Haddiyat`, `Mafsuhiyat`, `Majmui Ziyafat`, `Mulaqaat`, `Aqeeqa`, `Iftetah`, `Bethak QMZ`, `Other`.
* **The `buildBethakDatabaseRows` Transformation Algorithm**:
  * **Misaq Rule**: Always creates **two photographer rows** per sequence (one per team, or second team unassigned) for dual-angle coverage. Videographer is always forced to `null`.
  * **Photographer-Only Segments**: `Haddiyat` and `Mafsuhiyat` never receive videographers (`videographer_id: null`).
  * **Bethak QMZ**: Multi-ceremony block where each item inside carries a specific sharaf (`Bethak Qadam`, `Bethak Majlis`, `Bethak Ziyafat`) using `subTypes`.

```typescript
export function buildBethakDatabaseRows(
  counts: BethakSegment[] | null | undefined,
  teams: QMZTeam[],
  existingDbRows?: QMZNewAssignment[]
): QMZNewAssignment[] {
  const segments = counts || [];
  const rows: QMZNewAssignment[] = [];
  let globalSequence = 1;

  const findExistingRow = (seq: string, segType: string, teamId: string) => {
    if (!existingDbRows) return undefined;
    return existingDbRows.find(r => r.sequence === seq && r.event_abr === segType && (r.team_id ?? '') === teamId);
  };

  const findPersonDetails = (seq: string, segType: string) => {
    if (!existingDbRows) return { its: '', name: '', sticker_name: '', mobile: '', location: '' };
    const existing = existingDbRows.find(r => r.sequence === seq && r.event_abr === segType);
    return {
      its: existing?.its ?? '',
      name: existing?.name ?? '',
      sticker_name: existing?.sticker_name ?? '',
      mobile: existing?.mobile ?? '',
      location: existing?.location ?? '',
    };
  };

  segments.forEach((seg) => {
    for (let i = 0; i < seg.count; i++) {
      const seqStr = String(globalSequence);
      const ceremonyType = seg.type === 'Bethak QMZ' && seg.subTypes?.[i] ? seg.subTypes[i] : seg.type;
      const person = findPersonDetails(seqStr, ceremonyType);

      if (seg.type === 'Misaq') {
        // Misaq requires 2 photographers (no videographer) for dual-angle coverage
        const misaqSlots = teams.length >= 2 ? [teams[0], teams[1]] : (teams.length === 1 ? [teams[0], null] : [null, null]);
        misaqSlots.forEach((team) => {
          const teamId = team?.id ?? '';
          const existing = findExistingRow(seqStr, ceremonyType, teamId);
          rows.push({
            sequence: seqStr,
            event_abr: ceremonyType,
            sticker_name: person.sticker_name,
            name: person.name,
            its: person.its,
            location: person.location,
            mobile: person.mobile,
            team_id: teamId || null,
            photographer_id: existing?.photographer_id ?? team?.photographer_id ?? null,
            videographer_id: null,
            photo_not_covered: existing?.photo_not_covered ?? false,
            video_not_covered: false,
          });
        });
      } else {
        // Standard ceremonies: exactly 1 row per sequence, distributed round-robin across teams
        const photographerOnly = ['Haddiyat', 'Mafsuhiyat'].includes(seg.type);
        const assignedTeam = teams.length > 0 ? teams[(globalSequence - 1) % teams.length] : null;
        const teamId = assignedTeam?.id ?? null;
        const existing = findExistingRow(seqStr, ceremonyType, teamId ?? '');
        rows.push({
          sequence: seqStr,
          event_abr: ceremonyType,
          sticker_name: person.sticker_name,
          name: person.name,
          its: person.its,
          location: person.location,
          mobile: person.mobile,
          team_id: existing?.team_id ?? teamId,
          photographer_id: existing?.photographer_id ?? assignedTeam?.photographer_id ?? null,
          videographer_id: photographerOnly ? null : (existing?.videographer_id ?? assignedTeam?.videographer_id ?? null),
          photo_not_covered: existing?.photo_not_covered ?? false,
          video_not_covered: photographerOnly ? false : (existing?.video_not_covered ?? false),
        });
      }
      globalSequence++;
    }
  });

  return rows;
}
```

---

## 6. Offline Architecture Guidelines

When implementing this offline:
1. **Local Storage Engine**: Use SQLite (via SQLite WASM, React Native SQLite, or Tauri SQLite) mirroring the `city_events` and `city_event_assignments` tables.
2. **Deterministic Sequence Generation**: Ensure `nextSequence` calculates $\max(\text{sequence\_number}) + 1$ scoped strictly to `date` + `slot` (`date|||slot`).
3. **Optimistic Locking**: Every local update should bump `updated_at`. When syncing later with the cloud, compare `updated_at` timestamps to avoid overwriting remote edits.
4. **Folder Structure Generation**: Export folders formatted as:
   `{Safar_Name} / {Date}_{Slot} / {EventCode} / {Seq}_{Abr}_{Name}`
