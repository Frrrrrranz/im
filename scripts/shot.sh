#!/bin/sh
# Render a URL (or local HTML file) to PNG with headless Chrome.
#   scripts/shot.sh <url> <out.png> [WxH] [extra chrome flags…]
# Chrome does not exit cleanly in this sandbox, so we poll for the file and kill it.
set -eu
url=$1; out=$2; size=${3:-1100x720}; shift 3 2>/dev/null || shift $#
chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
profile=$(mktemp -d /tmp/im-chrome.XXXXXX)
rm -f "$out"
"$chrome" --headless=new --disable-gpu --hide-scrollbars --no-first-run \
  --default-background-color=00000000 --force-device-scale-factor=2 \
  --window-size="${size%x*},${size#*x}" --screenshot="$out" \
  --user-data-dir="$profile" "$@" "$url" >/dev/null 2>&1 &
pid=$!
for _ in $(seq 1 60); do
  [ -s "$out" ] && break
  sleep 0.5
done
sleep 0.5
kill "$pid" 2>/dev/null || true
pkill -f "user-data-dir=$profile" 2>/dev/null || true
rm -rf "$profile"
[ -s "$out" ] && echo "$out" || { echo "no screenshot produced" >&2; exit 1; }
