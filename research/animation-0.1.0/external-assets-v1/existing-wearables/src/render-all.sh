#!/bin/bash
set -euo pipefail
ASSET="$(cd "$(dirname "$0")/.." && pwd)"
: "${CACHE_ROOT:?Set CACHE_ROOT to the host output cache}"
P="$CACHE_ROOT/existing-wearables"
for kind in sprout sunhat satchel scarf; do
 for yaw in 0 45 90 180; do
  blender -b -t 2 --python-exit-code 1 --python "$ASSET/src/render_actual.py" -- --input "$P/review/$kind-static.json" --out "$P/review/renders/$kind-$yaw" --angle "$yaw" --span 5.264 --size 384 --samples 12 > "$P/reports/render-$kind-$yaw.log" 2>&1
 done
done
