# AIN53 Data Management — System Architecture & Developer Guide

A high-performance desktop application for tabular event data extraction, hierarchical directory generation, multi-cameraman media sorting, and drive inventory gap verification.

---

## 🏛️ Directory & Codebase Architecture

```text
AIN53 Data Management/
├── main.py                     # Main PyWebView entrypoint & RPC gateway API wrapper
├── requirements.txt            # Python dependencies (pdfplumber, pandas, pywebview, openpyxl)
├── app_settings.json           # User configuration & state persistence
├── version.txt                 # Current system build version tag
│
├── backends/                   # Core Data Science & Processing Engines
│   ├── __init__.py
│   ├── pdf_to_csv.py           # PDF Table extraction, fuzzy mapping & sub-sequence event splitter
│   ├── csv_to_folders.py       # Hierarchical directory system generator
│   ├── sorting.py              # Media sorter, file boundary scanner & ripple sequence shifter
│   ├── drive_inventory.py      # Drive gap verification & Excel report generator
│   └── updater.py              # GitHub auto-updater state machine
│
├── frontend/                   # User Interface & Design System
│   ├── index.html              # Core HTML shell grid & main viewport
│   ├── ICON.png                # High-res application brand logo
│   │
│   ├── css/                    # Modular CSS Subdirectories
│   │   ├── core/               # Theme & Core Layout
│   │   │   ├── theme.css       # Tokens, typography & high-contrast Light/Dark theme overrides
│   │   │   └── layout.css      # Main shell grid, responsive breakpoints & viewport scaling
│   │   ├── components/         # Reusable UI Primitives & Modals
│   │   │   ├── components.css  # Reusable primitives (buttons, inputs, glass cards, toasts)
│   │   │   └── modals.css      # User Guide modal, release notes modal & drag-drop overlays
│   │   └── views/              # View-Specific Stylesheets
│   │       ├── view-pdf.css    # PDF Extractor dropzone, mapping cards & table preview styles
│   │       ├── view-sorting.css # Media Sorter workspace, scan ring & shift modals
│   │       ├── view-sorting-dragdrop.css    # Media Sorter tile drag-drop workspace styles
│   │       ├── view-sorting-contextmenu.css # Media Sorter context menu floating popup styles
│   │       └── view-settings.css # Settings cards, theme selection grid & toggle switches
│   │
│   ├── js/                     # Modular JavaScript Subdirectories
│   │   ├── core/               # Application Lifecycle & System Loaders
│   │   │   ├── app.js          # App lifecycle, theme persistence & PyWebView RPC bridge
│   │   │   ├── boot_loader.js  # Startup progress animation controller
│   │   │   └── view_loader.js  # HTML partial importer helper
│   │   ├── components/         # Reusable UI Components & Modals
│   │   │   ├── react_components.js # React 18 top header bar & floating live dock
│   │   │   ├── guide_modal.js  # User Guide modal navigation controller
│   │   │   └── drag_drop.js    # Global drag-and-drop import overlay controller
│   │   └── views/              # View Controllers & Module Handlers
│   │       ├── 001_pdf.js      # PDF Extractor frontend controller & mapping grid
│   │       ├── 002_csv.js      # CSV to Folders frontend controller & path pickers
│   │       ├── 003_sorting.js  # Media Sorter dashboard & shift controller
│   │       ├── 003_sorting_drag_drop.js    # Media Sorter tile drag-and-drop controller
│   │       ├── 003_sorting_context_menu.js # Media Sorter context menu handler
│   │       └── 004_inventory.js # Drive Inventory frontend controller & launcher
│   │
│   └── views/                  # Modular HTML Page Partials
│       ├── view-pdf.html       # PDF to CSV view template
│       ├── view-csv.html       # CSV to Folders view template
│       ├── view-sorting.html   # Media Sorting view template & workspace modals
│       ├── view-inventory.html # Drive Inventory view template
│       ├── view-settings.html  # Application Settings view template
│       └── modals.html         # Global progress, release notes & lightbox modals
│
├── docs/                       # Documentation & User Guides
│   └── readers_guide.html      # Comprehensive end-user documentation
│
├── build_scripts/              # Automated Build & Installer Pipeline
│   ├── bundle_win.py           # Automated PyInstaller executable bundling script
│   ├── installer.py            # Standalone PyWebView setup installer bootstrapper
│   └── installer.html          # HTML setup wizard UI template
│
├── icon.ico                    # Windows application launcher icon
└── ICON.png                    # Brand master logo asset
```

---

## ⚡ Core Processing Pipelines

### 1. PDF to CSV Extraction Pipeline (`backends/pdf_to_csv.py`)
- **Table Detection**: Vector-based cell parsing via `pdfplumber`.
- **Fuzzy Synonym Header Mapping**: Maps source headers (`Sr`, `Sharaf`, `ITS ID`, `Address`, `Contact`) to standard target schema keys (`Seq`, `Event`, `Sticker`, `Name`, `ITS`, `Location`, `Mobile`, `Mauze`, `Sub Event`).
- **Multi-Event Splitting (`Z+N`, `Q+N`, `N+H+MF`)**: Parses composite event codes.
- **Sub-Sequence `Seq` Formatting**: Formats sequence suffixes (`10`, `10a`, `10b`) in the `Seq` column while keeping plain numeric sticker IDs (`10`, `10`) in the `Sticker` column.
- **Smart Text-Wrap Protection**: Re-combines single-person names wrapped across linebreaks inside PDF cells without creating artificial sub-rows.

### 2. Media Sorting & Sequence Shifting Engine (`backends/sorting.py`)
- **Media Boundary Analysis**: Scans raw media folders for photos and videos, matching file series against cameramen prefix ranges.
- **Floating Action Dock**: Top-centered floating selection dock for quick bulk operations (`Don't Copy`, `Edit Shift / Move`, `Deselect`).
- **Ripple Sequence Shift vs. Isolated Move**:
  - *Cascade Shift*: Shifts target item and all subsequent items up/down.
  - *Isolated Move*: Moves only selected items without affecting surrounding files.

### 3. Drive Inventory Engine (`backends/drive_inventory.py`)
- **Gap Verification Scan**: Analyzes target drive structures for missing numerical sequence gaps.
- **Excel Report Generator**: Generates formatted `.xlsx` reports with color-coded gap alerts (red for missing sequences, blue for non-standard files, yellow for totals).

---

## 🎨 Theme & Persistence System
- **Default Startup Theme**: **Light Mode (`Imperial Alabaster`)** on initial launch.
- **Persistent State**: Theme choice (`'light'` or `'dark'`) is saved to `localStorage` and synchronized with the backend settings store.
- **Responsive Layout**: Scales fluidly across laptop screens, 1080p, 1440p, and 4K displays with automated full-screen initialization.

---

## 🛠️ Development & Execution

```bash
# Install dependencies
pip install -r requirements.txt

# Run desktop application
python main.py

# Package Windows Portable Executable & Installer
python bundle_win.py
```
