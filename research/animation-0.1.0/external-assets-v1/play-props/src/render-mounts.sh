#!/bin/bash
set -e
cd "$(dirname "$0")/.."
for id in ball energy-token treasure-chest paper-plane cardboard-box building-block; do
 for angle in 0 45 90 180; do
 blender -b -t 2 --python src/render-static-fit.py -- --input reports/$id-mounted.json --out renders/mounted-$id-$angle --angle $angle --span 5.264 --size 384 --samples 12 >> reports/mount-render-log.txt 2>&1
 done
done
