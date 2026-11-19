# AIN53 Standalone File Viewer

An independent, zero-dependency viewer application for `.AIN53` Safar synchronization files.

## Features
- **Drag & Drop:** Drop any `.AIN53` (or `.json`) file directly onto the screen.
- **Complete Overview:** Shows total days, events, sequences, crew members, and coverage percentage.
- **Date & Slot Filtering:** Filter sequences by Hijri date, morning (`01M`) / evening (`02E`) slots, or event type.
- **Live Search:** Search by host name, ITS ID, sticker number, location, photographer, or videographer.
- **Crew Roster:** View all camera crew with their assigned series (A, B, C...) and assignment count.
- **Export to CSV:** Export the currently filtered sequence view into a standard CSV file.
- **Raw JSON Inspector:** View and copy the full underlying JSON structure.
- **Completely Independent:** Runs directly in any web browser without needing Python, Node.js, or any backend server.

## Showing Official AIN53 Logo on .AIN53 Files

### On macOS (Mac Client):
To display the official AIN53 camera shield logo on all `.AIN53` files in Finder:
1. Double-click **`setup_mac_icon.command`** in this folder.
   - It automatically installs **`AIN53 Viewer.app`** to `/Applications/` and registers the `.AIN53` document type with Apple LaunchServices.
   - Restarts Finder so all `.AIN53` files across your entire Mac immediately show the official AIN53 logo icon.
2. Double-clicking any `.AIN53` file in Finder will automatically open it in `AIN53 Viewer`!

### On Windows (PC Client):
- Simply launch the AIN53 desktop app (or run **`register_ain53_icon.bat`** in this folder).
- Windows automatically associates the `.AIN53` file extension and assigns the high-resolution logo (`icon.ico`).
- Press **F5** in Windows Explorer to refresh.

---

## How to Run the Viewer

### On Windows:
1. Double-click `run_viewer.bat` (or open `index.html` directly in any web browser).
2. Click **"Open .AIN53 File"** or drag-and-drop a `.AIN53` file into the window.

### On macOS:
1. Double-click **`AIN53 Viewer.app`** or `run_viewer.command` in Finder (or open `index.html` directly in Safari/Chrome).
2. Drag-and-drop any `.AIN53` file or click **"Open .AIN53 File"**.

### Shortcuts:
- **`Cmd + O`** (Mac) / **`Ctrl + O`** (Windows): Open `.AIN53` file dialog.
- **`Cmd + F`** (Mac) / **`Ctrl + F`** (Windows): Jump to sequence search box.
- **`Cmd + P`** (Mac) / **`Ctrl + P`** (Windows): Print / Save as PDF.
- **`Esc`**: Close Raw JSON Inspector.
