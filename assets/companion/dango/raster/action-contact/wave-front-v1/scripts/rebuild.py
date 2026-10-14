#!/usr/bin/env python3
"""Rebuild eleven rigid generated-source wave sprites; --check writes nothing."""
from pathlib import Path
from io import BytesIO
import argparse,hashlib,json,math
import numpy as np
from PIL import Image,ImageDraw
BASE=Path(__file__).resolve().parents[1]
def digest(data):return hashlib.sha256(data).hexdigest()
def png(image):
 out=BytesIO();image.save(out,format='PNG');return out.getvalue()
def repository_root(explicit=None):
 if explicit:return Path(explicit).resolve()
 for p in [BASE,*BASE.parents,Path.cwd(),*Path.cwd().parents]:
  if (p/'package.json').is_file() and (p/'src').is_dir():return p
 raise ValueError('Repository root not found; pass --repo=/absolute/repo for shared canonical sources')
def build(repo):
 r=json.loads((BASE/'sources/recipe.json').read_text());master=(repo/r['master']).read_bytes()
 if digest(master)!=r['masterSha256']:raise ValueError('Source master hash mismatch')
 if digest((repo/r['sourcePrompt']).read_bytes())!=r['sourcePromptSha256']:raise ValueError('Source prompt hash mismatch')
 im=Image.open(BytesIO(master)).convert('RGBA');raw=np.array(im);mask=Image.new('L',im.size);x0,y0,x1,y1=r['crop'];ImageDraw.Draw(mask).rectangle([x0,y0,x1-1,y1-1],fill=255)
 if digest(png(mask))!=r['maskSha256'] or (BASE/'sources'/r['mask']).read_bytes()!=png(mask):raise ValueError('Source mask changed')
 rgba=raw.copy();rgba[:,:,3]=np.minimum(rgba[:,:,3],np.array(mask));rgba[rgba[:,:,3]==0]=0
 if (BASE/'sources/wave-fore-palm-rgba.png').read_bytes()!=png(Image.fromarray(rgba).crop(r['crop'])):raise ValueError('Source extraction changed')
 palette=np.array(r['palette'],np.int32);scale=r['scaleArtPerSourcePixel'];root=r['root'];shoulder=r['fixedShoulder'];width,height=r['logicalSize'];rx,ry,rw,rh=r['outputRect'];outputs={}
 for i,deg in enumerate(r['angles']):
  angle=deg*math.pi/180;c=math.cos(angle);s=math.sin(angle);out=np.zeros((height,width,4),np.uint8)
  for y in range(height):
   for x in range(width):
    dx=x+.5-shoulder[0];dy=y+.5-shoulder[1];sx=math.floor((c*dx+s*dy)/scale+root[0]);sy=math.floor((-s*dx+c*dy)/scale+root[1])
    if 0<=sx<im.width and 0<=sy<im.height and rgba[sy,sx,3]>=128:
     col=rgba[sy,sx,:3].astype(np.int32);out[y,x,:3]=palette[np.argmin(((palette-col)**2).sum(axis=1))];out[y,x,3]=255
  logical=Image.fromarray(out).crop((rx,ry,rx+rw,ry+rh));outputs[f'wave-{i:02d}-logical.png']=png(logical);outputs[f'wave-{i:02d}-8x.png']=png(logical.resize((rw*8,rh*8),Image.Resampling.NEAREST))
 return outputs
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--check',action='store_true');parser.add_argument('--repo');args=parser.parse_args();target=BASE/'runtime' if (BASE/'runtime').is_dir() else BASE;outputs=build(repository_root(args.repo));bad=[]
 for name,data in outputs.items():
  if args.check:
   if not (target/name).exists() or (target/name).read_bytes()!=data:bad.append(name)
  else:(target/name).write_bytes(data)
 if bad:raise SystemExit('Byte mismatch: '+', '.join(bad))
 print(json.dumps({'checked':args.check,'files':len(outputs),'byteExact':True,'sha256':{name:digest(data) for name,data in outputs.items()}},indent=2))
