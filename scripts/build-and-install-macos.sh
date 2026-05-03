#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="D2 Desk.app"
INSTALL_DIR="${INSTALL_DIR:-/Applications}"
APP_PATH="$ROOT_DIR/src-tauri/target/release/bundle/macos/$APP_NAME"
DEST_PATH="$INSTALL_DIR/$APP_NAME"
TAURI_TARGET_DIR="$ROOT_DIR/src-tauri/target"
TAURI_BUILD_ARGS=("$@")

clean_stale_tauri_target() {
  [[ -d "$TAURI_TARGET_DIR" ]] || return 0

  local stale_path
  stale_path="$(
    find "$TAURI_TARGET_DIR" -type f \( \
      -name root-output -o \
      -name output -o \
      -name '*.d' -o \
      -name '*permission-files' \
    \) -print0 |
      xargs -0 grep -aEho '/[^[:space:]",]*d2-desk/src-tauri/target[^[:space:]",]*' 2>/dev/null |
      awk -v current="$TAURI_TARGET_DIR" 'index($0, current) != 1 { print; exit }' ||
      true
  )"

  if [[ -n "$stale_path" ]]; then
    echo "Detected stale Tauri build artifacts for a different checkout:"
    echo "  $stale_path"
    echo "Cleaning $TAURI_TARGET_DIR before building..."
    rm -rf "$TAURI_TARGET_DIR"
  fi
}

cd "$ROOT_DIR"

clean_stale_tauri_target

if [[ " $* " != *" --bundles "* && " $* " != *" -b "* && " $* " != *" --no-bundle "* ]]; then
  TAURI_BUILD_ARGS=(--bundles app "${TAURI_BUILD_ARGS[@]}")
fi

npm run tauri -- build "${TAURI_BUILD_ARGS[@]}"

if [[ ! -d "$APP_PATH" ]]; then
  echo "error: built app was not found at: $APP_PATH" >&2
  exit 1
fi

mkdir -p "$INSTALL_DIR"
rm -rf "$DEST_PATH"
ditto "$APP_PATH" "$DEST_PATH"
xattr -dr com.apple.quarantine "$DEST_PATH" 2>/dev/null || true

echo "Installed $APP_NAME to $DEST_PATH"
