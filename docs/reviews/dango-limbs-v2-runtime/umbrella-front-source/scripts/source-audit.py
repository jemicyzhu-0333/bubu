from PIL import Image
from pathlib import Path
import numpy as np,json,hashlib,math
import argparse
p=argparse.ArgumentParser();p.add_argument('--repo',default=str(next(q for q in Path(__file__).resolve().parents if (q/'package.json').exists() and (q/'src').exists())));p.add_argument('--out');args=p.parse_args()
root=Path(args.repo).resolve();assets=root/'assets/companion/dango/raster/action-contact/umbrella-front-v1';out=Path(args.out)if args.out else root/'meta/umbrella-front-source-qa/source';out.mkdir(parents=True,exist_ok=True)
hand=np.array(Image.open(assets/'right-logical.png').convert('RGBA'));hand8=np.array(Image.open(assets/'right-8x.png').convert('RGBA'))
original=np.array(Image.open(root/'assets/companion/dango/raster/tools/umbrella.png').convert('RGBA'));front=np.array(Image.open(assets/'umbrella-front.png').convert('RGBA'));back=np.array(Image.open(assets/'umbrella-back.png').convert('RGBA'))
def components(m):
 seen=set();out=[]
 for y,x in zip(*np.where(m)):
  if (int(x),int(y)) in seen:continue
  q=[(int(x),int(y))];seen.add(q[0]);cur=[]
  while q:
   xx,yy=q.pop();cur.append((xx,yy))
   for dx,dy in [(1,0),(-1,0),(0,1),(0,-1)]:
    nx,ny=xx+dx,yy+dy
    if 0<=nx<m.shape[1] and 0<=ny<m.shape[0] and m[ny,nx] and (nx,ny)not in seen:seen.add((nx,ny));q.append((nx,ny))
  out.append(cur)
 return out
# Production-grid source geometry with exact original tool registration.
H=np.zeros((640,800),bool);H[:576,:576]=hand8[:,:,3]>0
F=np.zeros_like(H);F[0:440,296:696]=front[88:528,:,3]>0
T=np.zeros_like(H);T[:440,296:696]=original[88:528,:,3]>0
V=F&~H;both=H|F;comps=components(both)
body=np.array(Image.open(root/'assets/companion/dango/raster/views/front/body.png').convert('RGBA'));rect=[-1.789744,8.533333,69.415385,49.066667]
def body_at(x,y):
 xx=int((x-rect[0])/rect[2]*body.shape[1]);yy=int((y-rect[1])/rect[3]*body.shape[0]);return 0<=xx<body.shape[1] and 0<=yy<body.shape[0] and body[yy,xx,3]>0
handcoords=[(int(x),int(y))for y,x in zip(*np.where(hand[:,:,3]>0))]
rootcoords=[(x,y)for x,y in handcoords if x<=57]
# Contact region excludes the umbrella canopy and tests connected upper shaft / paw / J-hook pixels.
cy,cx=np.where(F&H);overlapBounds=[int(cx.min())/8,int(cy.min())/8,(int(cx.max())+1)/8,(int(cy.max())+1)/8]
# The front prop and hand can be tested as a single source-alpha component.
rootSame=all(body_at(x+.5,y+.5)for x,y in rootcoords)
legacyArea=65360/(354*258)*9.2*6.705084745762711
report={'schema':'dango-umbrella-source-audit/1','masterSha256':'f483e75f8b1ca5045b5ba9393ccf33a17260216a4df8aef566282adbd9f1f9a3','hashes':{p.name:hashlib.sha256(p.read_bytes()).hexdigest()for p in assets.glob('*.png')},'hand':{'logical':[72,72],'exactNearest8x':bool(np.array_equal(np.repeat(np.repeat(hand,8,0),8,1),hand8)),'palette':np.unique(hand.reshape(-1,4),axis=0).tolist(),'binaryAlpha':bool(set(np.unique(hand[:,:,3]))<={0,255}),'components4':len(components(hand[:,:,3]>0)),'alphaArea':int((hand[:,:,3]>0).sum()),'bounds':list(Image.fromarray(hand).getbbox()),'distalPalmBounds':[58,31,66,40],'distalPalmSize':[8,9],'nativeLegacyRect':[9.2,6.705084745762711],'nativeLegacyAlphaArea':legacyArea,'genericRejectedPalmBoundsSize':[13,13],'rootPxCount':len(rootcoords),'rootPixelsInsideCanonicalBody':rootSame,'visibleRootRegistration':[55.68,35.75],'rootIsAnatomicalShoulder':False},'prop':{'complementUnionExact':bool(np.array_equal(np.where(front[:,:,3,None]>0,front,back),original)),'alphaIntersectionPixels':int(((front[:,:,3]>0)&(back[:,:,3]>0)).sum()),'foregroundSourceRects':[[187,248,213,389],[177,389,221,410],[177,410,272,477]],'sourceRegistration':[37,-11],'foregroundReason':'Same original gold shaft, ring, complete mint J handle in front of body and behind palm; canopy remains behind body. No coordinates or colors changed.','contactAxis':[0,1],'contactWorld':[61.875,35.75],'contactPointCoveredByPalm':bool(H[round(35.75*8),round(61.875*8)]),'shaftPalmAlphaOverlapProductionPixels':int((H&F).sum()),'overlapBoundsArt':overlapBounds,'handAndShaftAndHookComponents4':len(comps),'componentsAreasProductionPixels':[len(c)for c in comps]},'runtimeReport':'runtime/report.json','limitations':['Offscreen production renderer, not native window/GPU validation.','No global generic bone/paw or non-front action readiness changes.','Approved generation master, mask and recipe are retained in the source package; runtime screenshot references stay local-only.']}
assert report['hand']['exactNearest8x'] and report['hand']['binaryAlpha'] and report['hand']['components4']==1
assert rootSame and report['prop']['complementUnionExact'] and report['prop']['alphaIntersectionPixels']==0
assert report['prop']['contactPointCoveredByPalm'] and report['prop']['handAndShaftAndHookComponents4']==1
(out/'source-audit.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
