#!/bin/bash
set -e

echo "[Entrypoint] Starting GEO Harvester service..."

# Start Xvfb virtual display
export DISPLAY=:99
Xvfb :99 -screen 0 1280x800x24 -ac &
echo "[Entrypoint] Xvfb started on display :99"

# Wait for Xvfb to be ready
sleep 1

# Start fluxbox window manager
fluxbox -display :99 &
echo "[Entrypoint] Fluxbox window manager started"

sleep 0.5

# Start x11vnc server (no password for simplicity in Docker network)
x11vnc -display :99 -forever -shared -nopw -rfbport 5900 &
echo "[Entrypoint] x11vnc started on port 5900"

sleep 0.5

# Start noVNC via websockify
websockify --web /usr/share/novnc 6080 localhost:5900 &
echo "[Entrypoint] noVNC web client started on port 6080"

sleep 0.5

# Start the Node.js harvester server
echo "[Entrypoint] Starting Node.js harvester server..."
exec node server.js
