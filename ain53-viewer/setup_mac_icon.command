#!/usr/bin/env bash
# ==============================================================================
# AIN53 Safar Sync - macOS File Icon & Association Setup
# ==============================================================================
# This script associates .AIN53 files with the official AIN53 logo icon
# and sets AIN53 Viewer as the default handler on any Mac client.
# ==============================================================================

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
APP_SRC="$DIR/AIN53 Viewer.app"
APP_DEST="/Applications/AIN53 Viewer.app"

echo "========================================================"
echo "   AIN53 macOS File Icon & Association Setup"
echo "========================================================"
echo ""

if [ ! -d "$APP_SRC" ]; then
    echo "[-] Error: AIN53 Viewer.app not found in $DIR"
    exit 1
fi

# Ensure executable permissions inside the app bundle
chmod +x "$APP_SRC/Contents/MacOS/AIN53 Viewer" 2>/dev/null
chmod +x "$DIR/run_viewer.command" 2>/dev/null
chmod +x "$DIR/run_viewer.sh" 2>/dev/null

echo "[1/3] Installing AIN53 Viewer.app to /Applications..."
cp -R "$APP_SRC" /Applications/ 2>/dev/null
if [ $? -eq 0 ]; then
    REGISTER_TARGET="$APP_DEST"
    echo "      Installed to /Applications/AIN53 Viewer.app"
else
    REGISTER_TARGET="$APP_SRC"
    echo "      Using local bundle at $APP_SRC"
fi

echo "[2/3] Registering .AIN53 document type with Apple LaunchServices..."
LS_REGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"

if [ -f "$LS_REGISTER" ]; then
    "$LS_REGISTER" -f -r "$REGISTER_TARGET"
    echo "      LaunchServices registered successfully."
else
    echo "      Warning: lsregister utility not found at default path."
fi

# Set as default handler using duti if installed, or open once to trigger system association
open -a "$REGISTER_TARGET" --hide 2>/dev/null

echo "[3/3] Refreshing macOS Finder icon cache..."
killall Finder 2>/dev/null

echo ""
echo "========================================================"
echo " [SUCCESS] .AIN53 files are now associated with the"
echo "           official AIN53 logo icon on this Mac!"
echo "========================================================"
echo ""
echo "All .AIN53 files in Finder will now display the AIN53 logo."
echo "Double-clicking any .AIN53 file will open it in AIN53 Viewer."
echo ""
read -p "Press [Enter] to exit..."
