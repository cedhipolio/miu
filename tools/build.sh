#!/usr/bin/env bash
# Build dist/mark-it-up.artifact.html from src/ + template/ + vendor/rfds-artifact.html
#   tools/build.sh            (version from ./VERSION)
#   VERSION=85.0.0 tools/build.sh
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION="${VERSION:-$(cat VERSION)}"
mkdir -p build dist
python3 tools/assemble.py "$VERSION"
node --check build/pk-ws.js
(cd tools && python3 pack.py ../template/mark-it-up.template.html ../build ../dist/mark-it-up.artifact.html ../vendor/rfds-artifact.html)
echo "built dist/mark-it-up.artifact.html ($VERSION)"
