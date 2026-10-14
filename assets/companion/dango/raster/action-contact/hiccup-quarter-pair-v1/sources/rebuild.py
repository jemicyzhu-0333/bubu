#!/usr/bin/env python3
"""Rebuild the observed quarter hand pair; never synthesize hidden anatomy."""
from pathlib import Path
from PIL import Image,ImageDraw,ImageChops
import argparse,json,hashlib
HERE=Path(__file__).resolve().parent;ROOT=HERE.parent
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def main():
 p=argparse.ArgumentParser();p.add_argument('--check',action='store_true');args=p.parse_args()
 r=json.loads((HERE/'recipe.json').read_text());master=HERE/r['source']
 if sha(master)!=r['masterSha256']:raise ValueError('source master mismatch')
 im=Image.open(master).convert('RGBA');palette=[tuple(c) for c in r['palette']]
 if palette!=[(248,104,120),(248,128,128),(240,80,104),(26,27,38)]:raise ValueError('source palette mismatch')
 for part,c in r['parts'].items():
  mask=Image.new('L',im.size,0);ImageDraw.Draw(mask).polygon([tuple(v)for v in c['polygon']],fill=255)
  isolated=im.copy();isolated.putalpha(ImageChops.multiply(im.getchannel('A'),mask).point(lambda a:255 if a>=128 else 0))
  k=r['scale'];tx,ty=c['translation'];logical=isolated.transform((66,72),Image.Transform.AFFINE,(1/k,0,-tx/k,0,1/k,-ty/k),resample=Image.Resampling.NEAREST)
  logical.putdata([min(palette,key=lambda color:sum((color[j]-px[j])**2 for j in range(3)))+(255,)if px[3]else(0,0,0,0)for px in logical.getdata()])
  for suffix,image in [('logical',logical),('8x',logical.resize((528,576),Image.Resampling.NEAREST))]:
   target=ROOT/f'{part}-{suffix}.png'
   if args.check:
    old=Image.open(target).convert('RGBA')
    if old.size!=image.size or old.tobytes()!=image.tobytes():raise ValueError('pixel mismatch: '+target.name)
    if sha(target)!=r['outputs'][target.name]:raise ValueError('byte identity mismatch: '+target.name)
   else:image.save(target)
  if args.check:
   if Image.open(HERE/f'{part}-mask.png').convert('L').tobytes()!=mask.tobytes():raise ValueError('mask mismatch')
  else:mask.save(HERE/f'{part}-mask.png')
 print('Approved master, observed masks, fixed four-color palette, clear transparent RGB, one logical projection and exact nearest 8x verified.'if args.check else 'Rebuilt both source hands; run --check before changing descriptor hashes.')
if __name__=='__main__':main()
