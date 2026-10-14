#!/usr/bin/env python3
"""Reproduce the one approved similarity projection. No art pixels are painted."""
import argparse, hashlib, json, pathlib, tempfile
from PIL import Image, ImageDraw, ImageChops
HERE=pathlib.Path(__file__).resolve().parent
ROOT=HERE.parent
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def build():
    recipe=json.loads((HERE/'recipe.json').read_text())
    master=HERE/recipe['source']
    if sha(master)!=recipe['sourceSha256']: raise ValueError('master identity mismatch')
    original=Image.open(master).convert('RGBA')
    mask=Image.new('L',original.size,0)
    ImageDraw.Draw(mask).polygon([tuple(v) for v in recipe['polygon']],fill=255)
    isolated=original.copy()
    isolated.putalpha(ImageChops.multiply(original.getchannel('A'),mask).point(lambda a:255 if a>=128 else 0))
    scale=recipe['scale'];tx,ty=recipe['translation']
    logical=isolated.transform((66,72),Image.Transform.AFFINE,(1/scale,0,-tx/scale,0,1/scale,-ty/scale),resample=Image.Resampling.NEAREST)
    palette=[tuple(c) for c in recipe['palette']]
    if palette!=[(248,104,120),(248,128,128),(240,80,104),(26,27,38)]: raise ValueError('source palette mismatch')
    logical.putdata([(min(palette,key=lambda c:sum((c[j]-p[j])**2 for j in range(3)))+(255,) if p[3] else (0,0,0,0)) for p in logical.getdata()])
    production=logical.resize((528,576),Image.Resampling.NEAREST)
    return recipe,logical,production,mask

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--check',action='store_true');args=parser.parse_args()
    recipe,logical,production,mask=build()
    pairs=[('near-logical.png',logical),('near-8x.png',production)]
    if args.check:
        for name,image in pairs:
            existing=Image.open(ROOT/name).convert('RGBA')
            if existing.size!=image.size or existing.tobytes()!=image.tobytes(): raise ValueError('pixel mismatch: '+name)
            if sha(ROOT/name)!=recipe['outputs'][name]: raise ValueError('delivery byte identity mismatch: '+name)
        if any(p!=(0,0,0,0) for p in logical.getdata() if p[3]==0): raise ValueError('nonzero transparent RGB')
        delivered_mask=Image.open(HERE/'mask.png').convert('L')
        if delivered_mask.tobytes()!=mask.tobytes(): raise ValueError('mask mismatch')
        print('Approved master SHA, mask, logical pixels, exact nearest 8x and delivered byte identities verified.')
    else:
        for name,image in pairs:image.save(ROOT/name)
        mask.save(HERE/'mask.png')
        print('Rebuilt approved logical and nearest-8x PNGs. Re-run --check before changing any descriptor hash.')
if __name__=='__main__':main()
