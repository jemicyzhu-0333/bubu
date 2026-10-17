#!/bin/bash
set -euo pipefail
P=petting-prototype-v1
while [ ! -f "$P/preview/video/manifest.json" ]; do sleep 2; done
for input in "$P"/preview/video/chunk-*.json; do
 name=$(basename "$input" .json)
 blender -b -t 3 --python drag-body-prototype-v1/render/render_actual.py -- --input "$input" --out "$P/preview/video/$name" --size 384 --samples 12 --span 3.15 > "$P/preview/video/$name.log" 2>&1
 echo "Rendered $name"
done
