#!/usr/bin/env bash
# test-everything.sh — Run the full Quillium test suite locally, mirroring
# the "Static checks" and "Cross-package tests" jobs in .github/workflows/test.yml.
#
# By default this runs typecheck + build (check:all, landing:build) and every
# unit/property/fuzz test across all packages (test:all). Playwright e2e
# suites are OFF by default: the desktop suite needs Chromium installed and
# the web-preview suite needs the Supabase CLI plus a local Supabase stack.
# Opt into them explicitly with --with-e2e / --with-web-preview.
#
# Usage:
#   ./scripts/test-everything.sh [options]
#
# Options:
#   --skip-static        Skip typecheck (check:all) and landing build
#   --skip-unit           Skip unit/property/fuzz tests (test:all)
#   --with-e2e             Also run the desktop Playwright suites (needs Chromium)
#   --with-web-preview   Also run the Web Preview e2e suite (needs the Supabase CLI
#                          and starts a local Supabase stack)
#   --install-browsers   Run `playwright install chromium --with-deps` before
#                          any requested e2e suite
#   -h, --help             Show this help
set -euo pipefail
cd "$(dirname "$0")/.."

RUN_STATIC=1
RUN_UNIT=1
RUN_E2E=0
RUN_WEB_PREVIEW=0
INSTALL_BROWSERS=0

usage() {
    sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'
}

for arg in "$@"; do
    case "$arg" in
        --skip-static) RUN_STATIC=0 ;;
        --skip-unit) RUN_UNIT=0 ;;
        --with-e2e) RUN_E2E=1 ;;
        --with-web-preview) RUN_WEB_PREVIEW=1 ;;
        --install-browsers) INSTALL_BROWSERS=1 ;;
        -h | --help)
            usage
            exit 0
            ;;
        *)
            echo "Unknown option: $arg" >&2
            usage
            exit 1
            ;;
    esac
done

# Mirror the env defaults CI uses so a missing .env doesn't block local runs.
export QUILLIUM_ALLOW_MISSING_SUPABASE_ENV="${QUILLIUM_ALLOW_MISSING_SUPABASE_ENV:-1}"
export PUBLIC_POSTHOG_HOST="${PUBLIC_POSTHOG_HOST:-http://127.0.0.1:9999}"
export PUBLIC_POSTHOG_KEY="${PUBLIC_POSTHOG_KEY:-ci-test-posthog-key}"
export PUBLIC_RELAY_URL="${PUBLIC_RELAY_URL:-ws://127.0.0.1:9998}"
export PUBLIC_SUPABASE_PUBLISHABLE_KEY="${PUBLIC_SUPABASE_PUBLISHABLE_KEY:-}"
export PUBLIC_SUPABASE_URL="${PUBLIC_SUPABASE_URL:-}"

step() {
    echo
    echo "==> $1"
}

if [[ "$RUN_STATIC" -eq 1 ]]; then
    step "Type checking every package (bun run check:all)"
    bun run check:all

    step "Building landing site (bun run landing:build)"
    bun run landing:build
fi

if [[ "$RUN_UNIT" -eq 1 ]]; then
    step "Running unit, property, and fuzz tests across all packages (bun run test:all)"
    bun run test:all
fi

if [[ "$RUN_E2E" -eq 1 ]]; then
    if [[ "$INSTALL_BROWSERS" -eq 1 ]]; then
        step "Installing Chromium for desktop Playwright"
        bun run --cwd packages/desktop playwright install chromium --with-deps
    fi

    step "Running desktop Playwright behavior suite"
    bun run --cwd packages/desktop test:e2e \
        tests/e2e/annotationLifecycle.pw.ts \
        tests/e2e/nestedEditorModal.pw.ts \
        tests/e2e/revisionInteraction.pw.ts \
        tests/e2e/versionHistory.pw.ts

    step "Running desktop Playwright visual suite (single worker, no retries)"
    bun run --cwd packages/desktop test:e2e \
        tests/e2e/annotationVisualParity.pw.ts \
        --workers=1 \
        --retries=0
fi

if [[ "$RUN_WEB_PREVIEW" -eq 1 ]]; then
    if [[ "$INSTALL_BROWSERS" -eq 1 ]]; then
        step "Installing Chromium for Web Preview e2e"
        bun run --cwd packages/e2e playwright install chromium --with-deps
    fi

    step "Running Web Preview e2e against an ephemeral local Supabase stack"
    bun run e2e:test:full
fi

step "Done."
