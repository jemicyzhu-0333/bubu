"""Rebuild the approved fixed area projection into a NEW output directory."""
from pathlib import Path
from PIL import Image
import argparse,json,hashlib
import numpy as np
parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,required=True);args=parser.parse_args()
B=Path(__file__).parent;D=args.output;D.mkdir(parents=True,exist_ok=False)
PAL=np.array([[26,27,38],[240,80,104],[248,104,120],[248,128,128]],dtype=np.int16)
S=80/1254;RECT=[-12,-1,90,81];coverage_threshold=.25
raw=B/'generated-v1.png'
assert hashlib.sha256(raw.read_bytes()).hexdigest()=='d53f342877cc1a14ed04cb90c769d51074eaa7a22fb2c71029daa2f211cf8061', 'Original source hash changed'
master=Image.open(raw).convert('RGBA');assert master.size==(1254,1254), 'Original source dimensions changed'
for side,sx,target in [('left',286,6.5),('right',340,59.5)]:
 src=np.array(master.crop((0,0,627,1254) if side=='left' else (627,0,1254,1254)));H,W=src.shape[:2]
 alpha=src[:,:,3].astype(float)/255;cls=((src[:,:,:3].astype(float)[:,:,None,:]-PAL[None,None,:,:])**2).sum(3).argmin(2)
 tx=target-sx*S;ty=64-1006*S;out=np.zeros((RECT[3],RECT[2],4),np.uint8)
 for gy in range(RECT[3]):
  ya,yb=(gy+RECT[1]-ty)/S,(gy+RECT[1]+1-ty)/S;y0=max(0,int(np.floor(ya)));y1=min(H,int(np.ceil(yb)))
  if y1<=y0:continue
  ys=np.arange(y0,y1);wy=np.maximum(0,np.minimum(yb,ys+1)-np.maximum(ya,ys))
  for gx in range(RECT[2]):
   xa,xb=(gx+RECT[0]-tx)/S,(gx+RECT[0]+1-tx)/S;x0=max(0,int(np.floor(xa)));x1=min(W,int(np.ceil(xb)))
   if x1<=x0:continue
   xs=np.arange(x0,x1);wx=np.maximum(0,np.minimum(xb,xs+1)-np.maximum(xa,xs))
   weighted=alpha[y0:y1,x0:x1]*wy[:,None]*wx[None,:]*S*S;classes=cls[y0:y1,x0:x1]
   weights=np.array([weighted[classes==k].sum() for k in range(4)])
   if weights.sum()>=coverage_threshold:out[gy,gx,:3]=PAL[weights.argmax()];out[gy,gx,3]=255
 logical=Image.fromarray(out);logical.save(D/f'{side}-logical.png')
 logical.resize((RECT[2]*8,RECT[3]*8),Image.Resampling.NEAREST).save(D/f'{side}-8x.png')
hashes={q.name:hashlib.sha256(q.read_bytes()).hexdigest() for q in sorted(D.glob('*.png'))}
(D/'FILES.sha256.json').write_text(json.dumps(hashes,indent=2));print(json.dumps(hashes,indent=2))
