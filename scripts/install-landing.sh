#!/bin/sh
set -eu
node ../../scripts/install-secure-node.mjs /tmp/quillium-secure-node
export PATH="/tmp/quillium-secure-node/bin:$PATH"
node ../../scripts/install-secure-bun.mjs /tmp/quillium-secure-bun
/tmp/quillium-secure-bun/bun install --cwd ../.. --frozen-lockfile
