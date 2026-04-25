#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="D2 Desk.app"
INSTALL_DIR="${INSTALL_DIR:-/Applications}"
APP_PATH="$ROOT_DIR/src-tauri/target/release/bundle/macos/$APP_NAME"
DEST_PATH="$INSTALL_DIR/$APP_NAME"

cd "$ROOT_DIR"

npm run tauri -- build "$@"

if [[ ! -d "$APP_PATH" ]]; then
  echo "error: built app was not found at: $APP_PATH" >&2
  exit 1
fi

mkdir -p "$INSTALL_DIR"
rm -rf "$DEST_PATH"
ditto "$APP_PATH" "$DEST_PATH"
xattr -dr com.apple.quarantine "$DEST_PATH" 2>/dev/null || true

echo "Installed $APP_NAME to $DEST_PATH"
