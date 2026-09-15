#!/bin/sh
# Installs im — https://github.com/yetlinghao/im — into /Applications.
#
#   curl -fsSL https://raw.githubusercontent.com/yetlinghao/im/main/install.sh | sh
#
# curl and tar don't set macOS's quarantine flag, so the app opens without the
# "unidentified developer" stop. Integrity is checked against the sha256 that
# the release workflow publishes next to the archive. Updates after this come
# from inside the app (Settings → Version).
set -eu

repo="yetlinghao/im"
base=${IM_BASE:-"https://github.com/$repo/releases/latest/download"}   # override to test against a local build
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

echo "Downloading im…"
archive=im_universal.app.tar.gz
curl -fsSL "$base/$archive" -o "$tmp/$archive"
if curl -fsSL "$base/$archive.sha256" -o "$tmp/$archive.sha256"; then
  (cd "$tmp" && shasum -a 256 -c "$archive.sha256" >/dev/null) || {
    echo "im: checksum mismatch, not installing" >&2
    exit 1
  }
fi

dest=${IM_DEST:-/Applications}
[ -w "$dest" ] || dest="$HOME/Applications"
mkdir -p "$dest"
osascript -e 'quit app "im"' >/dev/null 2>&1 || true
rm -rf "$dest/im.app"
tar -xzf "$tmp/$archive" -C "$dest"
xattr -dr com.apple.quarantine "$dest/im.app" 2>/dev/null || true

echo "Installed $dest/im.app"
open "$dest/im.app"
