#!/usr/bin/env bash
set -euo pipefail

# Resolve paths from this script, so it also works from another directory.
project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd -- "$project_dir"

if [[ "$(uname -s)" != "Linux" ]]; then
  printf 'AppImages must be built on Linux.\n' >&2
  exit 1
fi
for command_name in node npm; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf 'Missing %s. Install Node.js and npm, then run this script again.\n' "$command_name" >&2
    exit 1
  fi
done

if [[ ! -x node_modules/.bin/electron-builder || ! -x node_modules/electron/dist/electron ]]; then
  printf 'Installing project dependencies from package-lock.json…\n'
  npm ci --include=dev
fi

target_arch="$(node -p 'process.arch')"
case "$target_arch" in
  x64|arm64|armv7l|ia32) ;;
  *) printf 'Unsupported Linux architecture: %s\n' "$target_arch" >&2; exit 1 ;;
esac
app_version="$(node -p 'require("./package.json").version')"
artifact_name="Nova-${app_version}-${target_arch}.AppImage"
appimage_path="$project_dir/dist/$artifact_name"

printf 'Building %s…\n' "$artifact_name"
./node_modules/.bin/electron-builder \
  --linux AppImage "--$target_arch" \
  --publish never \
  --config.directories.output=dist \
  "--config.linux.artifactName=$artifact_name"

if [[ ! -s "$appimage_path" ]]; then
  printf 'The build did not produce the expected AppImage: %s\n' "$appimage_path" >&2
  exit 1
fi
chmod a+x -- "$appimage_path"
printf '\nAppImage ready:\n  %s\n\nRun Nova with:\n  %q' "$appimage_path" "$appimage_path"
if [[ ! -e /dev/fuse ]]; then
  printf ' --appimage-extract-and-run'
fi
printf '\n'
