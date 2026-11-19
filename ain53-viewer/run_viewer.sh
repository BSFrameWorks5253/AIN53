#!/usr/bin/env bash
# AIN53 File Viewer - Cross-Platform Shell Launcher (macOS & Linux)

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS - register document type & icon
    APP_BUNDLE="$DIR/AIN53 Viewer.app"
    if [ -d "$APP_BUNDLE" ]; then
        chmod +x "$APP_BUNDLE/Contents/MacOS/AIN53 Viewer" 2>/dev/null
        LS_REG="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
        [ -f "$LS_REG" ] && "$LS_REG" -f -r "$APP_BUNDLE" 2>/dev/null
    fi
    open "$DIR/index.html"
elif which xdg-open > /dev/null 2>&1; then
    # Linux desktop
    xdg-open "$DIR/index.html"
else
    # Fallback to python http server
    echo "Opening local server on port 5354..."
    cd "$DIR" && python3 -m http.server 5354
fi
