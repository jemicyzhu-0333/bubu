#!/usr/bin/env python3
"""Deterministically rebuild approved umbrella source layers. --check writes nothing."""
from pathlib import Path
from io import BytesIO
import argparse, hashlib, json
import numpy as np
from PIL import Image, ImageDraw
BASE=Path(__file__).resolve().parents[1]
def digest(data):return hashlib.sha256(data).hexdigest()
def png(image):
 out=BytesIO();image.save(out,format='PNG');return out.getvalue()
def build():
 r=json.loads((BASE/'sources/recipe.json').read_text());source=(BASE/r['master']).read_bytes()
 if digest(source)!=r['masterSha256']:raise ValueError('Source master hash mismatch')
 image=Image.open(BytesIO(source)).convert('RGBA');mask=Image.new('L',image.size)
 ImageDraw.Draw(mask).polygon([tuple(p)for p in r['polygon']],fill=255)
 if digest(png(mask))!=r['sourceMaskSha256'] or (BASE/r['sourceMask']).read_bytes()!=png(mask):raise ValueError('Source mask recipe mismatch')
 rgba=np.array(image);rgba[:,:,3]=np.minimum(rgba[:,:,3],np.array(mask));crop=Image.fromarray(rgba).crop(tuple(r['crop']))
 if digest(png(crop))!=r['sourceCropSha256']:raise ValueError('Source crop recipe no longer matches')
 px=np.array(crop);w,h=r['logicalSize'];logical=np.zeros((h,w,4),dtype=np.uint8);palette=np.array(r['palette'],dtype=np.int32)
 scale=r['scaleArtPerSourcePixel'];gx,gy=r['contactWorld'];sx0,sy0=r['sourceCropGrip']
 for y in range(h):
  for x in range(w):
   sx=int(np.floor((x+.5-gx)/scale+sx0));sy=int(np.floor((y+.5-gy)/scale+sy0))
   if 0<=sx<px.shape[1] and 0<=sy<px.shape[0] and px[sy,sx,3]>=128:
    col=px[sy,sx,:3].astype(np.int32);logical[y,x,:3]=palette[np.argmin(((palette-col)**2).sum(axis=1))];logical[y,x,3]=255
 lim=Image.fromarray(logical);originalBytes=(BASE/r['propSource']).read_bytes()
 if digest(originalBytes)!=r['propSha256']:raise ValueError('Canonical umbrella changed')
 original=np.array(Image.open(BytesIO(originalBytes)).convert('RGBA'));back=original.copy();front=np.zeros_like(back)
 for x0,y0,x1,y1 in r['frontRectsSourcePixels']:
  front[y0:y1,x0:x1]=back[y0:y1,x0:x1];back[y0:y1,x0:x1]=0
 if not np.array_equal(np.where(front[:,:,3,None]>0,front,back),original):raise ValueError('Depth union changed source pixels')
 if np.any((front[:,:,3]>0)&(back[:,:,3]>0)):raise ValueError('Depth layers overlap')
 return {'right-logical.png':png(lim),'right-8x.png':png(lim.resize((w*r['unitPx'],h*r['unitPx']),Image.Resampling.NEAREST)),'umbrella-back.png':png(Image.fromarray(back)),'umbrella-front.png':png(Image.fromarray(front))}
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--check',action='store_true');args=parser.parse_args();outputs=build();bad=[]
 for name,data in outputs.items():
  if args.check:
   if (BASE/name).read_bytes()!=data:bad.append(name)
  else:(BASE/name).write_bytes(data)
 if bad:raise SystemExit('Mismatched rebuild: '+', '.join(bad))
 print(json.dumps({'checked':args.check,'files':len(outputs),'byteExact':not bad,'sha256':{name:digest(data)for name,data in outputs.items()}},indent=2))
