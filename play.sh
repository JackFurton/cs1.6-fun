#!/usr/bin/env bash
# Build and serve the game, then open it in a browser.
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-4173}"
URL="http://localhost:$PORT"

if [ ! -d node_modules ] || [ package-lock.json -nt node_modules ]; then
  npm ci
fi
npm run build

open_browser() {
  sleep 1
  # On WSL the Windows browser gets real GPU access; WSLg does not.
  if grep -qi microsoft /proc/version 2>/dev/null; then
    cmd.exe /c start "" "$URL" >/dev/null 2>&1 || true
  elif command -v xdg-open >/dev/null; then
    xdg-open "$URL" >/dev/null 2>&1 || true
  elif command -v open >/dev/null; then
    open "$URL"
  fi
}

echo "Serving on $URL (Ctrl+C to stop)"
open_browser &
exec npx vite preview --port "$PORT" --strictPort
