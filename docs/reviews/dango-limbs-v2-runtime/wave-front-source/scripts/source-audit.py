#!/usr/bin/env python3
"""Read the integrated source package; write JSON only. Never edits its images."""
from pathlib import Path
import argparse,hashlib,json,math
import numpy as np
from PIL import Image
parser=argparse.ArgumentParser();parser.add_argument('--repo',default='.');parser.add_argument('--out',required=True);args=parser.parse_args()
repo=Path(args.repo).resolve();out=Path(args.out).resolve();out.mkdir(parents=True,exist_ok=True)
assets=repo/'assets/companion/dango/raster/action-contact/wave-front-v1';r=json.loads((assets/'sources/recipe.json').read_text())
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
failures=[];frames=[]
for source_path,expected in [(repo/r['master'],r['masterSha256']),(repo/r['sourcePrompt'],r['sourcePromptSha256']),(assets/'sources'/r['mask'],r['maskSha256'])]:
 if sha(source_path)!=expected:failures.append('Source hash: '+str(source_path))
raw=np.array(Image.open(repo/r['master']).convert('RGBA'));body=np.array(Image.open(repo/'assets/companion/dango/raster/views/front/body.png').convert('RGBA'))
bx,by,bw,bh=[-1.789744,8.533333,69.415385,49.066667]
def body_at(x,y):
 xx=int((x-bx)/bw*body.shape[1]);yy=int((y-by)/bh*body.shape[0]);return 0<=xx<body.shape[1] and 0<=yy<body.shape[0] and body[yy,xx,3]>=128
def components(a):
 live=set(map(tuple,np.argwhere(a)));sizes=[]
 while live:
  todo=[live.pop()];size=0
  while todo:
   y,x=todo.pop();size+=1
   for point in [(y-1,x),(y+1,x),(y,x-1),(y,x+1)]:
    if point in live:live.remove(point);todo.append(point)
  sizes.append(size)
 return sizes
x0,y0,x1,y1=r['crop'];crop=raw[y0:y1,x0:x1];edges={'top':int((crop[0,:,3]>=128).sum()),'right':int((crop[:,-1,3]>=128).sum()),'bottom':int((crop[-1,:,3]>=128).sum()),'proximal':int((crop[:,0,3]>=128).sum())}
if any(edges[k] for k in ['top','right','bottom']):failures.append('Outer crop edge intersects source alpha')
for i,deg in enumerate(r['angles']):
 lo=np.array(Image.open(assets/f'wave-{i:02d}-logical.png').convert('RGBA'));hi=np.array(Image.open(assets/f'wave-{i:02d}-8x.png').convert('RGBA'))
 colors=np.unique(lo[lo[:,:,3]>0,:3],axis=0).tolist();binary=set(np.unique(lo[:,:,3]))<={0,255};clear=not lo[lo[:,:,3]==0].any();nearest=np.array_equal(hi,np.repeat(np.repeat(lo,8,axis=0),8,axis=1));pieces=components(lo[:,:,3]>0)
 angle=math.radians(deg);c=math.cos(angle);s=math.sin(angle);uncovered=[];cut_count=0
 for y in range(y0,y1):
  if raw[y,x0,3]<128:continue
  dx=(x0+.5-r['root'][0])*r['scaleArtPerSourcePixel'];dy=(y+.5-r['root'][1])*r['scaleArtPerSourcePixel'];xw=r['fixedShoulder'][0]+c*dx-s*dy;yw=r['fixedShoulder'][1]+s*dx+c*dy;cut_count+=1
  if not body_at(xw,yw):uncovered.append([xw,yw])
 if not binary or not clear or not nearest or len(pieces)!=1 or any(v not in r['palette'] for v in colors) or uncovered:failures.append(f'Frame {i} pixel/root contract')
 frames.append({'index':i,'angleDegrees':deg,'size':[lo.shape[1],lo.shape[0]],'opaquePixels':int((lo[:,:,3]>0).sum()),'components':pieces,'palette':colors,'binaryAlpha':binary,'transparentRGBZero':clear,'exactNearest8x':nearest,'rootCutSamples':cut_count,'uncoveredRootSamples':uncovered,'runtimeSha256':sha(assets/f'wave-{i:02d}-8x.png')})
report={'evidence':'Read-only source alpha/ink crop and unchanged canonical body audit. No source injection or generated approximation. Native desktop/GPU validation is separate.','sourceCropEdgeAlphaHits':edges,'frames':frames,'runtimeDecodeBytes':sum(Image.open(assets/f'wave-{i:02d}-8x.png').width*Image.open(assets/f'wave-{i:02d}-8x.png').height*4 for i in range(11)),'failures':failures}
(out/'source-audit.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'report':str(out/'source-audit.json'),'failures':len(failures)}));raise SystemExit(bool(failures))
