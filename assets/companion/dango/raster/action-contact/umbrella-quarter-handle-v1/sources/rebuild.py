#!/usr/bin/env python3
"""Manual source reproducibility check; no application or CI Python dependency."""
from pathlib import Path
from PIL import Image, ImageDraw
import numpy as np
import argparse, hashlib, json, os
H = Path(__file__).resolve().parent
A = H.parent
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
p = argparse.ArgumentParser()
p.add_argument('--repo', default=os.environ.get('BUBU_REPO'))
p.add_argument('--out', type=Path, default=A)
p.add_argument('--check', action='store_true')
args = p.parse_args()
provenance = json.loads((H / 'provenance.json').read_text())
assert sha(H / 'master-palm-context.png') == provenance['sourceContextSha256']
assert sha(H / 'approved-mask-recipe.json') == provenance['maskRecipeSha256']
assert sha(H / 'approved-coverage-recipe.json') == provenance['coverageRecipeSha256']
mask_recipe = json.loads((H / 'approved-mask-recipe.json').read_text())
coverage = json.loads((H / 'approved-coverage-recipe.json').read_text())
raw = np.array(Image.open(H / 'master-palm-context.png').convert('RGBA'))
assert raw.shape == (88, 78, 4)
mask = Image.new('L', (78, 88))
ImageDraw.Draw(mask).polygon([(x - 199, y - 250) for x, y in mask_recipe['polygon']], fill=255)
raw[:, :, 3] = np.array(mask)
raw[raw[:, :, 3] == 0] = 0
isolated = Image.fromarray(raw)
assert isolated.tobytes() == Image.open(H / 'approved-isolated.png').convert('RGBA').tobytes()
assert sha(H / 'approved-isolated.png') == provenance['isolatedSha256']
k = 9 / 66
n = 32
assert coverage['scale'] == k and coverage['sampleGrid'] == n
assert coverage['alphaThreshold'] == .35 and coverage['inkThreshold'] == .2
palette = np.array([[26, 27, 38], [240, 80, 104], [248, 104, 120], [248, 128, 128]])
q = np.zeros((72, 80, 4), np.uint8)
rows = []
for y in range(35, 48):
    for x in range(62, 76):
        yy, xx = np.mgrid[:n, :n]
        X, Y = x + (xx + .5) / n, y + (yy + .5) / n
        sx = np.floor(38.5 - (X - 69.375) / k).astype(int)
        sy = np.floor(41.5 + (Y - 40.75) / k).astype(int)
        valid = (sx >= 0) & (sx < 78) & (sy >= 0) & (sy < 88)
        sample = np.zeros((n, n, 4), np.uint8)
        sample[valid] = raw[sy[valid], sx[valid]]
        live = sample[:, :, 3] >= 128
        rgb = sample[:, :, :3].astype(float)
        nearest = np.array([((rgb - c) ** 2).sum(2) for c in palette]).argmin(0)
        alpha, ink = live.mean(), (live & (nearest == 0)).mean()
        if alpha < .35:
            continue
        index = 0 if ink >= .2 else int(np.bincount(nearest[live], minlength=4)[1:].argmax() + 1)
        q[y, x] = [*palette[index], 255]
        rows.append(dict(x=x, y=y, alphaCoverage=float(alpha), inkCoverage=float(ink), paletteIndex=index))
assert rows == coverage['pixels']
back, front = q.copy(), q.copy()
back[:, 68:] = 0
front[:, :68] = 0
outputs = {'whole-logical.png': Image.fromarray(q)}
for label, pixels in [('right-back', back), ('right-front', front)]:
    logical = Image.fromarray(pixels)
    outputs[label + '-logical.png'] = logical
    outputs[label + '-8x.png'] = logical.resize((640, 576), Image.Resampling.NEAREST)
if args.repo:
    prop = Path(args.repo) / 'assets/companion/dango/raster/tools/umbrella.png'
else:
    prop = next((parent / 'tools/umbrella.png' for parent in H.parents if (parent / 'tools/umbrella.png').is_file()), None)
assert prop and prop.is_file(), 'Supply --repo with the complete repository root.'
assert sha(prop) == provenance['propSha256']
original = np.array(Image.open(prop).convert('RGBA'))
assert original.shape == (528, 400, 4)
b, f = original.copy(), original.copy()
b[392:] = 0
f[:392] = 0
outputs['umbrella-back.png'], outputs['umbrella-front.png'] = Image.fromarray(b), Image.fromarray(f)
for name, image in outputs.items():
    target = args.out / name
    if args.check:
        saved = Image.open(target).convert('RGBA')
        assert saved.size == image.size and saved.tobytes() == image.tobytes(), name
    else:
        args.out.mkdir(parents=True, exist_ok=True)
        image.save(target)
print('Verified complete genuine-quarter palm, original four-color one-art projection, exact NN8x, and complementary unchanged-umbrella RGBA partitions.')
