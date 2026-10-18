#!/bin/bash
set -e
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
: "${CACHE_ROOT:?Set CACHE_ROOT to the same output cache used for host export}"
cd "$CACHE_ROOT/headwear-expansion"
for k in forest sakura moon flame crown antenna pumpkin; do
 for a in 0 45 90 180; do
  blender -b --python "$SOURCE_DIR/render_actual.py" -- --input review/$k-static.json --out review/$k-$a --size 320 --samples 12 --angle $a --span 2.9 > reports/render-$k-$a.log 2>&1
 done
done
