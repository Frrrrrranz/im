#!/bin/sh
# Render every UI state of the frontend (mock backend) to build/snapshots/*.png.
# Needs the Vite dev server: `npm run dev` (port 1420). Uses headless Chrome,
# so this shows the web layer only — vibrancy and traffic lights are Tauri's.
set -eu
cd "$(dirname "$0")/.."
out=build/snapshots
mkdir -p "$out"
base="http://localhost:1420/"
flags="--proxy-server=direct:// --proxy-bypass-list=*"
shot() { # name url [size]
  scripts/shot.sh "$2" "$out/$1.png" "${3:-1100x720}" $flags >/dev/null 2>&1 && echo "$out/$1.png"
}
shot chat-light      "$base?state=chat&theme=light"
shot chat-dark       "$base?state=chat&theme=dark"
shot streaming-light "$base?state=streaming&theme=light"
shot picker-dark     "$base?state=picker&theme=dark"
shot settings-light  "$base?state=settings&theme=light"
shot empty-light     "$base?state=empty&theme=light"
shot noproviders     "$base?state=noproviders&theme=light"
shot error-dark      "$base?state=error&theme=dark"
shot edit-light      "$base?state=edit&theme=light"
shot nosidebar-light "$base?state=nosidebar&theme=light" 900x600
shot json-dark       "$base?state=json&theme=dark" 1240x760
shot inspector-light "$base?state=chat&inspector=1&theme=light" 1240x760
shot streaming-inspector "$base?state=streaming&inspector=1&theme=light" 1240x760
shot scrolled-light  "$base?state=scrolled&theme=light"
shot html-light      "$base?state=html&theme=light"
shot html-expanded-dark "$base?state=html-expanded&theme=dark"
shot streaming-html  "$base?state=streaming-html&theme=light"
shot settings-dark   "$base?state=settings&theme=dark" 1100x1500
