#!/bin/bash
set -euo pipefail
ASSET="$(cd "$(dirname "$0")/.." && pwd)"
: "${CACHE_ROOT:?Set CACHE_ROOT to the host output cache}"
P="$CACHE_ROOT/existing-wearables"
for kind in satchel scarf; do
 for phase in first max raised_cup; do
  for yaw in 0 45; do
   blender -b -t 2 --python-exit-code 1 --python "$ASSET/src/render_actual.py" -- --input "$P/review/contact-$kind-$phase.json" --out "$P/review/contact-renders/$kind-$phase-$yaw" --angle "$yaw" --span 3.0 --size 512 --samples 64 > "$P/reports/render-contact-$kind-$phase-$yaw.log" 2>&1
  done
 done
done
