#!/usr/bin/env bash
# Run `tauri dev` with the app version set to 0.0.1 so the real updater
# finds an update from the release endpoint. Restores the original version
# on exit (Ctrl-C, crash, or normal exit).

set -euo pipefail

CONF="src-tauri/tauri.conf.json"
ORIGINAL_VERSION=$(grep -o '"version": "[^"]*"' "$CONF" | head -1 | cut -d'"' -f4)

restore() {
    echo ""
    echo "Restoring version to $ORIGINAL_VERSION..."
    # Use a temp file for portable in-place edit (works on both macOS and Linux sed)
    sed "s/\"version\": \"0.0.1\"/\"version\": \"$ORIGINAL_VERSION\"/" "$CONF" > "$CONF.tmp" \
        && mv "$CONF.tmp" "$CONF"
    echo "Done."
}
trap restore EXIT

echo "Patching version: $ORIGINAL_VERSION -> 0.0.1"
sed "s/\"version\": \"$ORIGINAL_VERSION\"/\"version\": \"0.0.1\"/" "$CONF" > "$CONF.tmp" \
    && mv "$CONF.tmp" "$CONF"

echo "Starting tauri dev (updater will see version 0.0.1)..."
bun run tauri dev
