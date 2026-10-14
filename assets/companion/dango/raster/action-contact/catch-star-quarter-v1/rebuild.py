#!/usr/bin/env python3
"""Rebuild frozen catch-star source partitions using only this package's files.
Requires Python 3 and Pillow. No repository, nearest-preview, or network inputs.
"""
import argparse
from collections import Counter, defaultdict
import hashlib
import json
import math
from pathlib import Path
from PIL import Image


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def source_digest(samples):
    encoded = json.dumps(samples, separators=(',', ':'), sort_keys=True).encode()
    return hashlib.sha256(encoded).hexdigest()


def rebuild(recipe_path, output_dir, full_audit=False):
    recipe = json.loads(recipe_path.read_text())
    root = recipe_path.parent
    images = {}
    for role, spec in recipe['inputs'].items():
        path = root / spec['path']
        if digest(path) != spec['sha256']:
            raise ValueError(f'input hash mismatch: {role}')
        if role != 'prompt':
            images[role] = Image.open(path).convert('RGBA' if role == 'raw' else 'L')
    raw, mask, palm = (images[k] for k in ['raw', 'mask', 'palmOwnership'])
    if not (raw.size == mask.size == palm.size):
        raise ValueError('source/mask dimensions differ')
    rule = recipe['rule']
    palette = rule['palette']
    sx0, sy0 = rule['sourceOrigin']
    lx0, ly0 = rule['logicalOrigin']
    scale, area = rule['uniformScale'], rule['sourceCellArea']
    x0, y0, x1, y1 = rule['sourceScanRect']
    buckets = defaultdict(list)
    for sy in range(y0, y1):
        for sx in range(x0, x1):
            rgba = raw.getpixel((sx, sy))
            if not mask.getpixel((sx, sy)) or rgba[3] < rule['alphaThreshold']:
                continue
            x = math.floor(lx0 + (sx - sx0) * scale)
            y = math.floor(ly0 + (sy - sy0) * scale)
            index = min(range(len(palette)), key=lambda k: sum((palette[k][i] - rgba[i]) ** 2 for i in range(3)))
            buckets[(x, y)].append({'xy': [sx, sy], 'rgba': list(rgba), 'paletteIndex': index})
    coverage = Image.new('RGBA', tuple(rule['logicalSize']))
    front = Image.new('RGBA', coverage.size)
    back = Image.new('RGBA', coverage.size)
    aggregates, full = [], []
    for (x, y), samples in sorted(buckets.items()):
        if not (0 <= x < coverage.width and 0 <= y < coverage.height):
            continue
        counts = Counter(s['paletteIndex'] for s in samples)
        alpha, ink = len(samples) / area, counts[0] / area
        emitted = alpha >= rule['minimumAlphaCoverage']
        palette_index = (0 if ink >= rule['minimumInkCoverage'] else max(range(1, len(palette)), key=lambda k: counts[k])) if emitted else None
        palm_count = sum(bool(palm.getpixel(tuple(s['xy']))) for s in samples)
        part = ('front' if palm_count else 'back') if emitted else None
        aggregate = {'logical': [x, y], 'sourceCount': len(samples),
                     'paletteCounts': [counts[k] for k in range(len(palette))],
                     'sourcePalmCount': palm_count, 'sourceSamplesSha256': source_digest(samples),
                     'outputPaletteIndex': palette_index, 'part': part}
        aggregates.append(aggregate)
        if full_audit:
            full.append({**aggregate, 'alphaCoverage': alpha, 'inkCoverage': ink, 'sourcePixels': samples})
        if emitted:
            pixel = tuple(palette[palette_index]) + (255,)
            coverage.putpixel((x, y), pixel)
            (front if part == 'front' else back).putpixel((x, y), pixel)
    if aggregates != recipe['cells']:
        raise ValueError('per-cell aggregate/hash differs from frozen recipe')
    if Image.alpha_composite(back, front).tobytes() != coverage.tobytes():
        raise ValueError('partition union differs from coverage')
    output_dir.mkdir(parents=True, exist_ok=True)
    result = {}
    for label, image in [('coverage', coverage), ('front', front), ('back', back)]:
        for suffix, export in [('logical', image), ('8x', image.resize(tuple(v * rule['exportScale'] for v in image.size), Image.Resampling.NEAREST))]:
            name = f'right-{label}-{suffix}.png'
            destination = output_dir / name
            export.save(destination)
            actual = digest(destination)
            if actual != recipe['outputs'][name]['sha256']:
                raise ValueError(f'output PNG bytes differ: {name}; verify Pillow/PNG encoder version')
            result[name] = actual
    if full_audit:
        (output_dir / 'full-audit.json').write_text(json.dumps({'schema': 'catch-star-full-source-audit/1',
            'recipeSha256': digest(recipe_path), 'inputs': recipe['inputs'], 'cells': full}, indent=2) + '\n')
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--recipe', type=Path, default=Path(__file__).with_name('compact-recipe.json'))
    parser.add_argument('--output-dir', type=Path)
    parser.add_argument('--full-audit', action='store_true', help='Reconstruct all owned source sample records in full-audit.json')
    args = parser.parse_args()
    print(json.dumps(rebuild(args.recipe, args.output_dir or args.recipe.parent, args.full_audit), indent=2))
