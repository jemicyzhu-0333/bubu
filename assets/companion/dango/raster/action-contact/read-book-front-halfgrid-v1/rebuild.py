"""Rebuild the four reading palm/root assets from original in-repository parts.

Requires Pillow. --check compares generated logical and exact NN8x bytes without
writing. No body, book, page, source part, pose, or size is changed.
"""
from collections import defaultdict
from io import BytesIO
from pathlib import Path
import argparse
import hashlib
import json
import math
from PIL import Image

base = Path(__file__).resolve().parent
raster = base.parents[1]
recipe = json.loads((base / 'sources/recipe.json').read_text())
check = argparse.ArgumentParser()
check.add_argument('--check', action='store_true')
args = check.parse_args()
grid, scale = recipe['gridArt'], recipe['sourceScale']
cell_area = grid * grid
palette = recipe['palette']
results = {}

for side, spec in recipe['parts'].items():
    source = raster / spec['sourcePath']
    assert hashlib.sha256(source.read_bytes()).hexdigest() == spec['sourceSha256'], 'Original source hash changed'
    raw = Image.open(source).convert('RGBA')
    assert list(raw.size) == spec['sourceSize']
    sp, tp = spec['sourceGrip'], spec['worldGrip']
    cells = defaultdict(lambda: {'weights': [0.0] * 4, 'palmArea': 0.0})
    total_source_pixels = 0
    for y in range(raw.height):
        for x in range(raw.width):
            rgba = raw.getpixel((x, y))
            assert rgba[3] in (0, 255)
            if not rgba[3]:
                continue
            total_source_pixels += 1
            klass = min(range(4), key=lambda k: sum((rgba[i] - palette[k][i]) ** 2 for i in range(3)))
            x0, y0 = tp[0] + scale * (x - sp[0]), tp[1] + scale * (y - sp[1])
            x1, y1 = x0 + scale, y0 + scale
            root = x <= 81 if spec['sourceSide'] == 'right' else x >= 272
            for yy in range(math.floor(y0 / grid), math.floor(y1 / grid) + 1):
                oy = max(0, min(y1, (yy + 1) * grid) - max(y0, yy * grid))
                for xx in range(math.floor(x0 / grid), math.floor(x1 / grid) + 1):
                    ox = max(0, min(x1, (xx + 1) * grid) - max(x0, xx * grid))
                    area = ox * oy
                    if area <= 1e-15:
                        continue
                    cell = cells[(xx, yy)]
                    cell['weights'][klass] += area
                    if not root:
                        cell['palmArea'] += area
    assert abs(sum(sum(c['weights']) for c in cells.values()) - total_source_pixels * scale**2) < 1e-8
    images = {role: Image.new('RGBA', tuple(recipe['logicalCanvasSize'])) for role in ['front', 'root']}
    full = Image.new('RGBA', tuple(recipe['logicalCanvasSize']))
    for xy, cell in cells.items():
        ink = cell['weights'][0] / cell_area
        alpha = sum(cell['weights']) / cell_area
        if ink < recipe['inkCoverageThreshold'] and alpha < recipe['fillCoverageThreshold']:
            continue
        klass = 0 if ink >= recipe['inkCoverageThreshold'] else max(range(1, 4), key=lambda k: cell['weights'][k])
        color = tuple(palette[klass]) + (255,)
        role = 'front' if cell['palmArea'] > 1e-14 else 'root'
        images[role].putpixel(xy, color)
        full.putpixel(xy, color)
    # Prove complementary partitions using every RGBA byte, including transparency.
    for y in range(full.height):
        for x in range(full.width):
            front, root = images['front'].getpixel((x, y)), images['root'].getpixel((x, y))
            assert not (front[3] and root[3])
            assert tuple(a + b for a, b in zip(front, root)) == full.getpixel((x, y))
    complete = spec['completeLogical']
    stream = BytesIO(); full.save(stream, format='PNG'); complete_bytes = stream.getvalue()
    assert hashlib.sha256(complete_bytes).hexdigest() == complete['sha256']
    if args.check:
        assert (base / complete['filename']).read_bytes() == complete_bytes
    else:
        (base / complete['filename']).write_bytes(complete_bytes)
    result = {}
    for role, image in images.items():
        expected = spec['outputs'][role]
        assert list(image.getbbox()) == expected['logicalBounds']
        logical = image.crop(image.getbbox())
        expanded = logical.resize((logical.width * 8, logical.height * 8), Image.Resampling.NEAREST)
        for kind, output in [('logical', logical), ('runtime', expanded)]:
            name = expected['logicalFilename'] if kind == 'logical' else expected['filename']
            stream = BytesIO(); output.save(stream, format='PNG'); data = stream.getvalue()
            if args.check:
                assert (base / name).read_bytes() == data, 'Rebuild mismatch: ' + name
            else:
                (base / name).write_bytes(data)
            digest = hashlib.sha256(data).hexdigest()
            required = expected['logicalSha256'] if kind == 'logical' else expected['sha256']
            assert digest == required, 'Registered output hash mismatch: ' + name
        result[role] = {'logicalSize': list(logical.size), 'runtimeSize': list(expanded.size), 'exactNN8x': True}
    results[side] = {'completeRgbaUnionExact': True, 'disjoint': True, 'parts': result}
print(json.dumps({'check': args.check, 'parts': results}, indent=2))
