#!/usr/bin/env bash
# ./play.sh               build, serve and open the game (single player vs bots)
# ./play.sh host [map] [dm]   run a dedicated server friends can join, and open it for you too
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d node_modules ] || [ package-lock.json -nt node_modules ]; then
  npm ci
fi
npm run build

open_browser() {
  sleep 1.5
  # On WSL the Windows browser gets real GPU access; WSLg does not.
  if grep -qi microsoft /proc/version 2>/dev/null; then
    cmd.exe /c start "" "$1" >/dev/null 2>&1 || true
  elif command -v xdg-open >/dev/null; then
    xdg-open "$1" >/dev/null 2>&1 || true
  elif command -v open >/dev/null; then
    open "$1"
  fi
}

if [ "${1:-}" = "host" ]; then
  MAP="${2:-de_dust2}"
  MODE="${3:-defuse}"
  PORT="${PORT:-27015}"
  npm run build:server
  if grep -qi microsoft /proc/version 2>/dev/null; then
    echo "Note: under WSL, friends on your network can only reach this server if WSL uses mirrored"
    echo "networking (networkingMode=mirrored in %UserProfile%\\.wslconfig) or you forward port $PORT"
    echo "from Windows (netsh interface portproxy). Playing on this PC works either way."
  fi
  open_browser "http://localhost:$PORT/?connect" &
  exec node dist-server/main.js --map "$MAP" --mode "$MODE" --port "$PORT"
fi

PORT="${PORT:-4173}"
URL="http://localhost:$PORT"
echo "Serving on $URL (Ctrl+C to stop)"
open_browser "$URL" &
exec npx vite preview --port "$PORT" --strictPort
