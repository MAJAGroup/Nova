#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
APPIMAGE="$PROJECT_DIR/dist/ORBIT-$(node -p 'require(process.argv[1]).version' "$PROJECT_DIR/package.json").AppImage"

cd "$PROJECT_DIR"
npm run dist -- --linux AppImage
chmod +x "$APPIMAGE"

# AppImage extraction mode also works on Linux systems without FUSE support.
export APPIMAGE_EXTRACT_AND_RUN="${APPIMAGE_EXTRACT_AND_RUN:-1}"
exec "$APPIMAGE" "$@"
