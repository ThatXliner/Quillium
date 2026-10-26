#!/usr/bin/env bash
# mas_oauth_loopback_entitlements.sh — Exercises the MAS OAuth listener permission.

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tauri_dir="$(cd "$script_dir/.." && pwd)"
entitlements="$tauri_dir/Entitlements.mas.plist"
probe_source="$script_dir/fixtures/oauth_loopback_probe.c"
client_only_profile="$script_dir/fixtures/oauth_client_only.sb"
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT

clang "$probe_source" -o "$work_dir/oauth-loopback-probe"

# Cargo tests are not App Sandboxed. Apply the equivalent bind restriction so a missing
# production entitlement reproduces the same EPERM returned inside the MAS build.
if /usr/libexec/PlistBuddy -c "Print :com.apple.security.network.server" \
    "$entitlements" 2>/dev/null | grep -qx true; then
    "$work_dir/oauth-loopback-probe"
else
    sandbox-exec -f "$client_only_profile" "$work_dir/oauth-loopback-probe"
fi
