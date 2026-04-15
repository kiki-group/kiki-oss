#!/bin/bash
# Convert Kiki extension SVG icons to PNG.
# Chrome Web Store submission requires PNG format in the manifest "icons" field;
# SVGs are not accepted for extension icons in the manifest.
#
# Requires: librsvg (rsvg-convert) or Inkscape CLI
#   - macOS: brew install librsvg
#   - Ubuntu: apt install librsvg2-bin
#   - Or: brew install inkscape (for inkscape CLI)

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

convert_svg() {
  local svg="$1"
  local png="${svg%.svg}.png"
  local size="${png#*icon-}"
  size="${size%.png}"

  if command -v rsvg-convert &>/dev/null; then
    rsvg-convert -w "$size" -h "$size" -o "$png" "$svg"
    echo "Created $png (via rsvg-convert)"
  elif command -v inkscape &>/dev/null; then
    inkscape "$svg" -w "$size" -h "$size" -o "$png"
    echo "Created $png (via Inkscape)"
  else
    echo "Error: Neither rsvg-convert (librsvg) nor Inkscape found."
    echo "Install with: brew install librsvg   OR   brew install inkscape"
    exit 1
  fi
}

for svg in icon-16.svg icon-48.svg icon-128.svg; do
  if [[ -f "$svg" ]]; then
    convert_svg "$svg"
  else
    echo "Warning: $svg not found, skipping"
  fi
done

echo "Done. PNGs ready for manifest.json icons field."
