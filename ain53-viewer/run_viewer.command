#!/usr/bin/env bash
# AIN53 File Viewer - macOS One-Click Launcher
# Double-click this file in Finder to open the viewer in your default Mac browser

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Automatically register .AIN53 document type and official logo icon with macOS LaunchServices
APP_BUNDLE="$DIR/AIN53 Viewer.app"
if [ -d "$APP_BUNDLE" ]; then
    chmod +x "$APP_BUNDLE/Contents/MacOS/AIN53 Viewer" 2>/dev/null
    LS_REG="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
    if [ -f "$LS_REG" ]; then
        "$LS_REG" -f -r "$APP_BUNDLE" 2>/dev/null
    fi
fi

open "$DIR/index.html"
exit 0
