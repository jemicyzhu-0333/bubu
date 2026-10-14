#!/usr/bin/env python3
"""Reproduce the frozen observed quarter palm; never draw source pixels."""
from pathlib import Path
from PIL import Image,ImageDraw
import numpy as np,json,hashlib,argparse
H=Path(__file__).resolve().parent;O=H.parent;ROOT=H.parents[6]
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
p=argparse.ArgumentParser();p.add_argument('--check',action='store_true');args=p.parse_args()
r=json.loads((H/'approved-mask-recipe.json').read_text());master=ROOT/r['sourceRepositoryPath'];assert sha(master)==r['masterSha256'];assert sha(ROOT/r['promptRepositoryPath'])==r['promptSha256']
im=Image.open(master).convert('RGBA');mask=Image.new('L',im.size);ImageDraw.Draw(mask).polygon([tuple(x)for x in r['polygon']],fill=255);a=np.array(im);a[:,:,3]=np.array(mask);a[a[:,:,3]==0]=0;a=np.array(Image.fromarray(a).crop((199,250,277,338)));isolated=Image.fromarray(a)
c=json.loads((H/'coverage-recipe.json').read_text());assert c['scale']==9/66 and c['alphaThreshold']==.35 and c['inkThreshold']==.2 and c['sampleGrid']==32
k=c['scale'];n=c['sampleGrid'];pal=np.array([[26,27,38],[240,80,104],[248,104,120],[248,128,128]]);q=np.zeros((72,80,4),np.uint8);rows=[]
for y in range(35,48):
 for x in range(62,76):
  yy,xx=np.mgrid[:n,:n];X=x+(xx+.5)/n;Y=y+(yy+.5)/n;sx=np.floor(38.5-(X-69.375)/k).astype(int);sy=np.floor(41.5+(Y-40.75)/k).astype(int);valid=(sx>=0)&(sx<a.shape[1])&(sy>=0)&(sy<a.shape[0]);raw=np.zeros((n,n,4),np.uint8);raw[valid]=a[sy[valid],sx[valid]];live=raw[:,:,3]>=128;rgb=raw[:,:,:3].astype(float);nearest=np.array([((rgb-col)**2).sum(2)for col in pal]).argmin(0);cov=live.mean();ink=(live&(nearest==0)).mean()
  if cov<.35:continue
  idx=0 if ink>=.2 else int(np.bincount(nearest[live],minlength=4)[1:].argmax()+1);q[y,x]=[*pal[idx],255];rows.append(dict(x=x,y=y,alphaCoverage=float(cov),inkCoverage=float(ink),paletteIndex=idx))
assert rows==c['pixels'];logical=Image.fromarray(q);production=logical.resize((640,576),Image.Resampling.NEAREST)
for path,img in [(H/'approved-isolated.png',isolated),(O/'right-logical.png',logical),(O/'right-8x.png',production)]:
 if args.check:
  old=Image.open(path).convert('RGBA');assert old.size==img.size and old.tobytes()==img.tobytes(),path
 else:img.save(path)
print('Frozen master, complete observed palm inner-ink mask, uniform coverage, original palette and exact NN8x verified.')
