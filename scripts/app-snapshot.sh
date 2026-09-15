#!/bin/sh
# Launch the debug .app with fixture data and capture its own window to PNG.
#   scripts/app-snapshot.sh [out.png] [theme]        theme: system|light|dark
# Environment:
#   IM_SCENARIO=picker|settings|streaming|edit|error|attach|send-image   UI state to open
#   IM_AUTOSEND="text"                                  send a message on launch
#   IM_ATTACH=/path/to/photo.heic                       attach a file first (read_image → downscale), as a drop would
#   PROVIDER=mock                                       default to the local mock
#                                                       (start scripts/mock_server.py first)
#   SIDEBAR=0                                           start with the sidebar collapsed
#   INSPECTOR=1                                         start with the trajectory inspector open
#   IM_SNAPSHOT_DELAY_MS=3000                           wait before capturing
#   ACTIVATE=0                                          don't bring the app to the front first (inactive look)
# Requires `npx tauri build --debug --bundles app`. The app renders the PNG
# itself (src-tauri/src/snapshot.rs); screencapture is unavailable here.
set -eu
cd "$(dirname "$0")/.."
out=${1:-build/snapshots/app.png}
theme=${2:-system}
mkdir -p "$(dirname "$out")"
data=$(mktemp -d /tmp/im-data.XXXXXX)
cp -R scripts/fixtures/. "$data/"
sed -i '' "s/\"appearance\": \"system\"/\"appearance\": \"$theme\"/" "$data/settings.json"
if [ "${SIDEBAR:-1}" = "0" ]; then
  sed -i '' 's/"sidebar_visible": true/"sidebar_visible": false/' "$data/settings.json"
fi
if [ "${INSPECTOR:-0}" = "1" ]; then
  sed -i '' -E 's/"sidebar_visible": (true|false)/"sidebar_visible": \1, "inspector_visible": true/' "$data/settings.json"
fi
if [ "${PROVIDER:-}" = "mock" ]; then
  sed -i '' 's/"default_provider_id": "openrouter", "default_model": "anthropic\/claude-sonnet-4"/"default_provider_id": "mock", "default_model": "mock-large"/' "$data/settings.json"
  for f in "$data"/sessions/*.json; do
    sed -i '' 's/"provider_id": "openrouter"/"provider_id": "mock"/; s/"model": "anthropic\/claude-sonnet-4"/"model": "mock-large"/' "$f"
  done
fi
rm -f "$out"
bin=src-tauri/target/debug/bundle/macos/im.app/Contents/MacOS/im
IM_DATA_DIR="$data" IM_SNAPSHOT_PATH="$PWD/$out" IM_SNAPSHOT_DELAY_MS=${IM_SNAPSHOT_DELAY_MS:-3000} IM_SNAPSHOT_EXIT=1 IM_SNAPSHOT_ACTIVATE=${ACTIVATE:-1} \
  "$bin" >"$data/run.log" 2>&1 &
pid=$!
for _ in $(seq 1 60); do
  [ -s "$out" ] && break
  sleep 0.5
done
sleep 0.5
kill "$pid" 2>/dev/null || true
cat "$data/run.log"
if [ -n "${KEEP_DATA:-}" ]; then echo "data kept in $data"; else rm -rf "$data"; fi
[ -s "$out" ] && echo "$out" || { echo "no snapshot produced" >&2; exit 1; }
