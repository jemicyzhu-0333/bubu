import os
from PIL import Image, ImageDraw
from pathlib import Path
import numpy as np, json
import runpy
args=runpy.run_path(str(Path(__file__).resolve().parents[2]/'shared/accessory-paths.py'))['paths'](False)
P=args.accessory
R=args.reference_root
v = np.load(args.cache_root / 'hybrid-inputs/Bubu_body.npz')['POSITION']
bodyWidth = float(np.ptp(v[:, 0]))
scale = 99 * 2.8 / bodyWidth / 320
dimension = round(320 * scale)
for item in ['halo', 'boots', 'cape', 'combined']:
    out = Image.new('RGB', (1280, 350), '#eeeeee')
    d = ImageDraw.Draw(out)
    for i, a in enumerate([0, 45, 90, 180]):
        im = Image.open(P / f'review/{item}-{a}/0000.png')
        out.paste(im, (i * 320, 25), im)
        d.text((i * 320 + 10, 8), str(a) + ' degrees', fill='black')
    out.save(P / f'review/{item}-actual-fourviews.png')
    for bg, label in [('#eee', 'light'), ('#252631', 'dark')]:
        out = Image.new('RGB', (dimension * 8, dimension * 3 + 45), bg)
        d = ImageDraw.Draw(out)
        fg = 'black' if label == 'light' else 'white'
        d.text((8, 5), '99 CSS px approved main-body width (top); 2x (bottom)', fill=fg)
        for i, a in enumerate([0, 45, 90, 180]):
            im = Image.open(P / f'review/{item}-{a}/0000.png')
            small = im.resize((dimension, dimension), Image.Resampling.LANCZOS)
            large = im.resize((dimension * 2, dimension * 2), Image.Resampling.LANCZOS)
            out.paste(small, (i * dimension * 2, 25), small)
            out.paste(large, (i * dimension * 2, dimension + 40), large)
        out.save(P / f'review/{item}-99css-{label}.png')
(P / 'reports/native-size-review.json').write_text(json.dumps({'bodyWidthInSourceUnits': bodyWidth, 'cameraOrthoSpan': 2.8, 'renderPixelSize': 320, 'cssBodyWidth': 99, 'compositeTilePixels': dimension, 'method': 'Uniform scaling from known camera projection, not alpha bounding-box equalization. Full foreground including halo is taller than 99px.', 'screenshots': 'Offscreen Blender evidence; not browser or OS screenshot'}, indent=2))
