#!/usr/bin/env python3
"""Build the opt-in run body's 24 poses from retained, canonical PNG layers.

python tools/dango-run-build/build.py
python tools/dango-run-build/build.py --check
python tools/dango-run-build/build.py --output /tmp/dango-run --proof-output /tmp/dango-run-proof

Requires the existing baseline's Pillow 12.3.0, NumPy and SciPy 1.17.0;
does not install software, access a network, or run native/memory tests.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys
import tempfile

import numpy as np
from PIL import Image, ImageDraw
sys.dont_write_bytecode = True
from contours import ContourCycle, LOOP_MS, LEAN_DEGREES, LEAN_CENTER, STANCE, rotate, translated

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
BASELINE = ROOT / 'tools/pet-sequence-prototype/experiments/controlled-run-v2'
RASTER = ROOT / 'assets/companion/dango/raster'
DEFAULT_OUTPUT = ROOT / 'assets/companion/dango/clips/run'
K = 64 / 390
FRAME_COUNT = 24
# Fixed two-source-pixel framing adjustment fits the immutable production cache
# [-4, -1, 75, 66]. It is shared by all poses/layers, never normalization.
FRAME_OFFSET_Y = 2 * K
SOURCE_POINT = lambda x, y: [33 + (x - 256) * K, 64 + (y - 448) * K]
POINT = lambda x, y: [33 + (x - 256) * K, 64 + (y - 448) * K + FRAME_OFFSET_Y]
SPRITE_RECT = [*POINT(0, 0), 512 * K, 512 * K]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n')


def canonical_layers():
    pins = json.loads((HERE / 'source-pins.json').read_text())
    for path, expected in pins.items():
        if digest(ROOT / path) != expected:
            raise ValueError(f'Pinned source mismatch: {path}')
    source = Image.open(BASELINE / 'references/three-quarter-right.png').convert('RGBA')
    data = json.loads((RASTER / 'source-specs/body.json').read_text())['views']['three-quarter-right']
    body = Image.new('RGBA', (512, 512))
    face = Image.new('RGBA', (512, 512))
    pieces = [data['parts'][part] for part in ['ear-left', 'ear-right', 'foot-left', 'foot-right']] + [data['body']]
    for layer, sprites in [(body, pieces), (face, data['face']['eyes']['neutral'] + [data['face']['mouth']['neutral']])]:
        for sprite in sprites:
            x, y, _, _ = sprite['rect']
            offset = (round((x - 33) / K + 256), round((y - 64) / K + 448))
            layer.alpha_composite(Image.open(RASTER / sprite['src']), offset)
    if not np.array_equal(np.array(Image.alpha_composite(body, face)), np.array(source)):
        raise ValueError('Canonical layers do not exactly reconstruct the frozen reference')
    return source, body, face, data, pins


def face_transform(lift):
    angle = math.radians(LEAN_DEGREES)
    cosine, sine = math.cos(angle), math.sin(angle)
    x, y = SOURCE_POINT(*LEAN_CENTER)
    return [cosine, sine, -sine, cosine, x - cosine * x + sine * y,
            y - sine * x - cosine * y + lift * K + FRAME_OFFSET_Y]


def transform_point(matrix, point):
    a, b, c, d, e, f = matrix
    x, y = point
    return [a * x + c * y + e, b * x + d * y + f]


def alpha_bounds(image):
    x0, y0, x1, y1 = image.getbbox()
    return [*POINT(x0 * 2, y0 * 2), (x1 - x0) * 2 * K, (y1 - y0) * 2 * K]


def union_bounds(rects):
    x = min(rect[0] for rect in rects)
    y = min(rect[1] for rect in rects)
    right = max(rect[0] + rect[2] for rect in rects)
    bottom = max(rect[1] + rect[3] for rect in rects)
    return [x, y, right - x, bottom - y]


def save_sprite(image, output, relative, asset_id):
    target = output / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    image.save(target)
    return {'id': asset_id, 'src': relative, 'sha256': digest(target)}


def build(output, proof_output=None):
    source, body, face, face_data, pins = canonical_layers()
    full_cycle, body_cycle = ContourCycle(source), ContourCycle(body)
    rotated_face = np.array(rotate(face))
    output.mkdir(parents=True, exist_ok=True)
    assets, poses, frames, face_transforms = [], [], [], {}
    proofs, checks = [], []
    for index in range(FRAME_COUNT):
        pose_id = f'run-{index:02d}'
        image, meta = body_cycle.pose(index / FRAME_COUNT)
        original, original_meta = full_cycle.pose(index / FRAME_COUNT)
        baseline = Image.open(BASELINE / 'frames' / f'{pose_id}.png').convert('RGBA')
        overlay = Image.fromarray(translated(rotated_face, meta['bodyY'])).resize((256, 256), Image.Resampling.NEAREST)
        restored = Image.alpha_composite(image, overlay)
        checks.append({'poseId': pose_id,
                       'baselineReproduced': np.array_equal(np.array(original), np.array(baseline)),
                       'neutralRecompositionExact': np.array_equal(np.array(restored), np.array(baseline)),
                       'silhouetteUnchanged': np.array_equal(np.array(image)[:, :, 3], np.array(baseline)[:, :, 3]),
                       'trajectoryUnchanged': meta == original_meta})
        if not all(value for key, value in checks[-1].items() if key != 'poseId'):
            raise ValueError(f'Layer separation changed frozen baseline: {checks[-1]}')
        # Material provenance is the authored BODY layer, never RGB thresholding.
        # This naked sample has no garment pixels; its entire alpha is body material.
        mask = Image.new('RGBA', image.size, (255, 255, 255, 0))
        mask.putalpha(image.getchannel('A'))
        frame_asset = save_sprite(image, output, f'body/{pose_id}.png', f'{pose_id}-body')
        mask_asset = save_sprite(mask, output, f'mask/{pose_id}.png', f'{pose_id}-mask')
        assets.extend([frame_asset, mask_asset])
        matrix = face_transform(meta['bodyY'])
        face_transforms[pose_id] = matrix
        far, near = meta['feet']
        face_anchor = transform_point(matrix, face_data['face']['mouth']['neutral']['pivot'])
        anchors = {'foot-left': POINT(far['x'], far['y']), 'foot-right': POINT(near['x'], near['y']), 'face': face_anchor}
        bounds = alpha_bounds(image)
        pose = {'id': pose_id, 'at': meta['phase'], 'frame': frame_asset['id'],
                'bodyRecolorMask': mask_asset['id'], 'bounds': bounds, 'semanticAnchors': anchors,
                'contacts': {'left': 'support' if far['support'] else 'swing', 'right': 'support' if near['support'] else 'swing'},
                'occlusionPlan': ['body', 'face']}
        poses.append(pose)
        frames.append({**pose, 'spriteRect': SPRITE_RECT, 'faceTransform': matrix,
                       'bodyYSourcePx': meta['bodyY'], 'feetSourcePx': meta['feet']})
        proofs.append((image, restored))
    bounds = union_bounds([pose['bounds'] for pose in poses])
    # All sampled geometry shares one envelope; the full PNG rect includes transparent margin.
    for pose in poses:
        pose['bounds'] = bounds
    poses.append({**poses[0], 'id': 'run-seam', 'at': 1})
    face_transforms['run-seam'] = face_transforms['run-00']
    identity = pins[str((BASELINE / 'references/three-quarter-right.png').relative_to(ROOT))]
    manifest = {'schemaVersion': 1, 'contentVersion': 'dango-run-v1', 'characterId': 'dango',
                'clipId': 'controlled-run', 'actionId': 'chase-laser', 'view': 'three-quarter',
                'identityRefSha256': identity, 'designUnits': 66, 'artBounds': bounds,
                'groundAnchor': POINT(256, 448), 'durationMs': LOOP_MS, 'loop': True,
                'rootTravelPerLoop': 120 / STANCE * K, 'faceMode': 'overlay',
                'resourceGroups': [{'id': 'bare', 'assets': assets, 'poses': poses, 'staticPose': 'run-00'}],
                'wardrobeCompatibility': [{'wardrobeIds': [], 'status': 'supported', 'resourceGroup': 'bare'}]}
    payload = {'manifest': manifest, 'expectedAssetHashes': {asset['src']: asset['sha256'] for asset in assets},
               'identityRefSha256': identity, 'spriteRect': SPRITE_RECT, 'faceTransforms': face_transforms}
    module = "// Generated by tools/dango-run-build/build.py; edit the builder, not this file.\n"
    module += "const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };\n"
    module += 'const data = ' + json.dumps(payload, indent=2) + ';\n'
    module += "const DANGO_RUN = freeze({ ...data, baseUrl: new URL('./', import.meta.url).href });\nexport { DANGO_RUN };\n"
    (output / 'dango-run.mjs').write_text(module)
    record = {'schemaVersion': 1, 'method': 'Existing canonical faceless PNG layers recomposed before the frozen contour builder; no per-frame erasure or new art',
              'sourceView': 'three-quarter-right', 'runtimeView': 'three-quarter', 'sourceHashes': pins,
              'unitsPerSourcePixel': K, 'sourceSize': [512, 512], 'outputSize': [256, 256],
              'spriteRect': SPRITE_RECT, 'artBounds': bounds, 'groundAnchor': POINT(256, 448),
              'durationMs': LOOP_MS, 'phaseCount': FRAME_COUNT, 'faceMode': 'overlay',
              'faceSource': 'Existing production canonical eye/mouth sprite descriptors',
              'leanDegreesClockwise': LEAN_DEGREES, 'leanPivot': SOURCE_POINT(*LEAN_CENTER),
              'fixedFrameOffset': [0, FRAME_OFFSET_Y],
              'maskPolicy': 'Separate white RGBA mask from authored BODY alpha; no clothing in this resource group',
              'coordinatePolicy': 'K=64/390; canonical x33 at source256 and y64 at source448; fixed +2 source pixels Y on every output layer; no per-frame normalization',
              'rootTravelPerLoop': manifest['rootTravelPerLoop'], 'footMapping': {'left': 'far', 'right': 'near'},
              'checks': checks, 'frames': frames,
              'limits': ['Naked chase-laser, three-quarter only; other combinations must use existing fallback',
                         'Exact neutral recomposition proves extraction identity, not native renderer sampling or visual acceptance',
                         'No native desktop, long memory, or wardrobe adaptation checks performed']}
    write_json(output / 'build-record.json', record)
    if proof_output:
        proof_output.mkdir(parents=True, exist_ok=True)
        for column, name in [(0, 'body-only'), (1, 'neutral-recomposed')]:
            sheet = Image.new('RGB', (1560, 1200), '#f1eee7')
            draw = ImageDraw.Draw(sheet)
            for index, pair in enumerate(proofs):
                x, y = index % 6 * 260, index // 6 * 300
                sheet.paste(pair[column], (x, y + 20), pair[column])
                contact = frames[index]['contacts']
                draw.text((x + 8, y + 280), f'{index:02d} far={contact["left"]} near={contact["right"]}', fill='#243e49')
            sheet.save(proof_output / f'{name}-24.png')
        write_json(proof_output / 'checks.json', checks)
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument('--proof-output', type=Path)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    if args.check:
        with tempfile.TemporaryDirectory(prefix='dango-run-check-') as temporary:
            target = Path(temporary)
            build(target)
            mismatches = [str(path.relative_to(target)) for path in target.rglob('*') if path.is_file()
                          and (not (args.output / path.relative_to(target)).is_file()
                               or path.read_bytes() != (args.output / path.relative_to(target)).read_bytes())]
            expected_pngs = {str(path.relative_to(target)) for path in target.rglob('*.png')}
            current_pngs = {str(path.relative_to(args.output)) for folder in ['body', 'mask']
                            for path in (args.output / folder).rglob('*.png')}
            mismatches.extend(sorted(current_pngs - expected_pngs))
            if mismatches:
                raise ValueError(f'Generated asset drift: {mismatches}')
        print('PASS: 24 body frames, 24 masks, canonical neutral reconstruction, metadata and module reproduce byte-for-byte')
    else:
        record = build(args.output, args.proof_output)
        print(json.dumps({'output': str(args.output), 'phaseCount': record['phaseCount'], 'artBounds': record['artBounds'], 'checksPassed': True}))


if __name__ == '__main__':
    main()
