#!/usr/bin/env bash
set -euo pipefail

TARGET_ROOT="${1:-target/universal-apple-darwin/release}"
OUT_DIR="${2:-dist/tauri}"
mkdir -p "$OUT_DIR"

DMG_LIST="$(find "$TARGET_ROOT" -type f -path '*/bundle/dmg/*.dmg' -print | sort)"
DMG_COUNT="$(printf '%s\n' "$DMG_LIST" | sed '/^$/d' | wc -l | tr -d ' ')"
if [[ "$DMG_COUNT" != "1" ]]; then
  echo "Expected exactly one DMG under $TARGET_ROOT; found $DMG_COUNT" >&2
  exit 1
fi
DMG="$(printf '%s\n' "$DMG_LIST" | sed '/^$/d')"

APP_LIST="$(find "$TARGET_ROOT" -type d -path '*/bundle/macos/*.app' -print | sort)"
APP_COUNT="$(printf '%s\n' "$APP_LIST" | sed '/^$/d' | wc -l | tr -d ' ')"
if [[ "$APP_COUNT" != "1" ]]; then
  echo "Expected exactly one app bundle under $TARGET_ROOT; found $APP_COUNT" >&2
  exit 1
fi
APP="$(printf '%s\n' "$APP_LIST" | sed '/^$/d')"

DMG_OUT="$OUT_DIR/HarnessScope-0.3.0-macos-universal.dmg"
ZIP_OUT="$OUT_DIR/HarnessScope-0.3.0-macos-universal.app.zip"
cp "$DMG" "$DMG_OUT"
rm -f "$ZIP_OUT"
/usr/bin/ditto -c -k --sequesterRsrc --keepParent "$APP" "$ZIP_OUT"

test -s "$DMG_OUT"
test -s "$ZIP_OUT"
echo "Normalized Tauri macOS artifacts in $OUT_DIR"
