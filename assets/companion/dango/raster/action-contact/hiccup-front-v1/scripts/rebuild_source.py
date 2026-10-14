#!/usr/bin/env python3
"""Reconstruct final reviewed geometric masks from exact saved source scanlines."""
from pathlib import Path
from PIL import Image,ImageDraw,ImageChops
import argparse,json,hashlib
ROOT=Path(__file__).resolve().parents[1];p=argparse.ArgumentParser();p.add_argument('--output',required=True,type=Path);args=p.parse_args();O=args.output.resolve();O.mkdir(parents=True,exist_ok=True)
r=json.load(open(ROOT/'sources/extraction/extraction-recipe.json'));master=ROOT/r['source'];sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();assert sha(master)==r['sourceSha256'];im=Image.open(master).convert('RGBA');checks=[]
for f in r['frames']:
 b=f['cropBox'];raw=im.crop(b);mask=Image.new('L',raw.size);d=ImageDraw.Draw(mask)
 for row in f['geometricScanlines']:
  for x0,x1 in row['inclusiveSourceXRanges']:d.line((x0-b[0],row['sourceY']-b[1],x1-b[0],row['sourceY']-b[1]),fill=255)
 out=raw.copy();out.putalpha(ImageChops.multiply(raw.getchannel('A'),mask));out.save(O/f['sourceRgba']);mask.save(O/f['mask']);assert out.convert('RGB').tobytes()==raw.convert('RGB').tobytes();checks.append({'side':f['side'],'sourceRgbExact':True,'retainedSourceAlphaExact':True,'rgbaSha256':sha(O/f['sourceRgba']),'maskSha256':sha(O/f['mask'])})
(O/'extraction-recipe.json').write_text(json.dumps(r,indent=2)+'\n');(O/'verification.json').write_text(json.dumps({'sourceSha256':sha(master),'checks':checks},indent=2)+'\n');print(json.dumps({'sourceMasksRebuilt':len(checks),'sourceRGBAUnchanged':True}))
