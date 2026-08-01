#!/usr/bin/env bash
set -euo pipefail

export DISPLAY=:99
Xvfb :99 -screen 0 1440x900x24 -nolisten tcp &
x11vnc -display :99 -forever -shared -nopw -rfbport 5900 -localhost >/tmp/x11vnc.log 2>&1 &
websockify --web=/usr/share/novnc/ 6080 localhost:5900 >/tmp/novnc.log 2>&1 &

exec node /app/content/automation/src/cli.js login --live
