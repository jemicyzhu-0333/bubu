#!/usr/bin/env python3
from pathlib import Path
from PIL import Image,ImageChops,ImageDraw
import argparse,json,math,hashlib,tempfile,subprocess,sys
ROOT=Path(__file__).resolve().parents[1];p=argparse.ArgumentParser();p.add_argument('--raster-root',type=Path,default=ROOT.parents[1]);p.add_argument('--report',type=Path);p.add_argument('--rebuild',action='store_true');a=p.parse_args();R=a.raster_root.resolve();sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();cfg=json.load(open(ROOT/'frames.json'));deps=json.load(open(ROOT/'sources/dependencies.json'));rec=json.load(open(ROOT/'sources/extraction/extraction-recipe.json'));original=json.load(open(ROOT/'validation/original-evidence/sequence-data.json'));palette=[(248,104,120),(248,128,128),(240,80,104),(26,27,38)]
assert cfg['runtimeReady'] is False and cfg['action']=='hiccup'and cfg['view']=='front';assert cfg['toolRegistration']=={'key':'cup','x':22,'y':38,'rect':[0,0,22,19]}
for dep in [deps['body'],deps['approvedIdentity']]:assert sha(R/dep['src'])==dep['sha256'],dep['src']
for ref in deps['generationReferences']:assert sha(ROOT/ref['packagePath']if 'packagePath'in ref else R/ref['rasterRootPath'])==ref['sha256']
master=Image.open(ROOT/rec['source']).convert('RGBA');assert sha(ROOT/rec['source'])==rec['sourceSha256'];prov=json.load(open(ROOT/'sources/masters/hold-visible-fore-v7.json'));assert sha(ROOT/'sources/masters'/prov['prompt'])==prov['promptSha256'];body=Image.open(R/deps['body']['src']).convert('RGBA');rect=deps['body']['rect']
def body_alpha(x,y):
 u=math.floor((x-rect[0])*body.width/rect[2]);v=math.floor((y-rect[1])*body.height/rect[3]);return 0<=u<body.width and 0<=v<body.height and body.getpixel((u,v))[3]>0
results=[]
for f in cfg['frames']:
 sf=next(x for x in rec['frames']if x['side']==f['side']);b=sf['cropBox'];raw=master.crop(b);crop=Image.open(ROOT/f['source']).convert('RGBA');mask=Image.open(ROOT/'sources/extraction'/sf['mask']);assert crop.convert('RGB').tobytes()==raw.convert('RGB').tobytes();assert crop.getchannel('A').tobytes()==ImageChops.multiply(raw.getchannel('A'),mask).tobytes();assert sha(ROOT/f['source'])==f['sourceSha256'];reMask=Image.new('L',mask.size);draw=ImageDraw.Draw(reMask)
 for row in sf['geometricScanlines']:
  for lo,hi in row['inclusiveSourceXRanges']:draw.line((lo-b[0],row['sourceY']-b[1],hi-b[0],row['sourceY']-b[1]),fill=255)
 assert reMask.tobytes()==mask.tobytes()
 im=Image.open(ROOT/f['src']).convert('RGBA');assert im.size==(66,72)and f['origin']==[0,0];assert sha(ROOT/f['src'])==f['sha256'];assert set(im.getchannel('A').getdata())<={0,255};assert{p[:3]for p in im.getdata()if p[3]}==set(palette);assert Image.open(ROOT/f['productionSrc']).convert('RGBA').tobytes()==im.resize((528,576),Image.Resampling.NEAREST).tobytes()
 expected=Image.new('RGBA',im.size);matrix=f['inverseSamplingMatrix']
 for y in range(im.height):
  for x in range(im.width):
   u=math.floor(matrix[0][0]*(x+.5)+matrix[0][1]*(y+.5)+matrix[0][2]);v=math.floor(matrix[1][0]*(x+.5)+matrix[1][1]*(y+.5)+matrix[1][2])
   if 0<=u<crop.width and 0<=v<crop.height:
    c=crop.getpixel((u,v))
    if c[3]>=240:expected.putpixel((x,y),(*min(palette,key=lambda p:sum((p[k]-c[k])**2 for k in range(3))),255))
 assert expected.tobytes()==im.tobytes()
 S=f['anatomicalShoulder'];P=f['visibleProximalCutCenter'];cut=f['worldOpenCut'];width=math.dist(*cut);dx=P[0]-S[0];dy=P[1]-S[1];length=math.hypot(dx,dy);margin=width/2+math.sqrt(.5);covered=[];outside=[]
 for y in range(math.floor(min(S[1],P[1])-margin),math.ceil(max(S[1],P[1])+margin)+1):
  for x in range(math.floor(min(S[0],P[0])-margin),math.ceil(max(S[0],P[0])+margin)+1):
   q=[x+.5,y+.5];t=((q[0]-S[0])*dx+(q[1]-S[1])*dy)/length**2
   if t<=0:continue
   if math.hypot(q[0]-S[0]-min(1,t)*dx,q[1]-S[1]-min(1,t)*dy)>margin:continue
   (covered if body_alpha(*q)else outside).append([x,y])
 n=max(2,math.ceil(width*8)+1);cutOutside=[i for i in range(n)if not body_alpha(*[cut[0][k]+(cut[1][k]-cut[0][k])*i/(n-1)for k in range(2)])];assert not outside and not cutOutside;assert covered==original['plans'][f['side']]['coverage']['covered'];assert len(covered)==(103 if f['side']=='left'else 94)
 ink=[(x,y)for y in range(im.height)for x in range(im.width)if im.getpixel((x,y))==(26,27,38,255)];runs=[]
 for y in range(im.height):
  xs=[x for x in range(im.width)if (x,y)in ink]
  if not xs:continue
  start=end=xs[0]
  for x in xs[1:]+[10000]:
   if x==end+1:end=x;continue
   if end-start+1>=2:runs.append({'y':y,'xInclusive':[start,end],'rgba':[26,27,38,255]})
   start=end=x
 xs=[x for x in range(im.width)if im.getpixel((x,48))[3]];edge=max(xs)+1 if f['side']=='left'else min(xs);gap=23.25-edge if f['side']=='left'else edge-44;assert gap==(.25 if f['side']=='left'else 0)
 results.append({'side':f['side'],'sourceRGBAndMaskedAlphaExact':True,'maskScanlinesExact':True,'binaryAlpha':True,'paletteColors':4,'exact8x':True,'inverseSamplingExact':True,'S':S,'P':P,'cut':cut,'measuredWidth':width,'positiveAxisCoveredCells':len(covered),'outsideCells':len(outside),'cutOutsideSamples':len(cutOutside),'contactBoundary':f['observedContactBoundary'],'rasterBoundaryX':edge,'signedRasterGap':gap,'inkRGBA':[26,27,38,255],'inkPixelCount':len(ink),'horizontalInkRuns':runs})
rebuilt=0
if a.rebuild:
 with tempfile.TemporaryDirectory(prefix='hiccup-front-source-')as t:
  T=Path(t);subprocess.run([sys.executable,str(ROOT/'scripts/rebuild_source.py'),'--output',str(T/'sources/extraction')],check=True);subprocess.run([sys.executable,str(ROOT/'scripts/build_pose.py'),'--source-root',str(T),'--output',str(T)],check=True)
  for f in cfg['frames']:
   for key in ['src','productionSrc','pivot']:assert (ROOT/f[key]).read_bytes()==(T/f[key]).read_bytes();rebuilt+=1
   sf=next(x for x in rec['frames']if x['side']==f['side'])
   for key in ['sourceRgba','mask']:assert(ROOT/'sources/extraction'/sf[key]).read_bytes()==(T/'sources/extraction'/sf[key]).read_bytes();rebuilt+=1
  assert json.load(open(T/'frames.json'))==cfg
  assert (ROOT/'frames.json').read_bytes()==(T/'frames.json').read_bytes()
  for name in ['extraction-recipe.json','verification.json']:assert (ROOT/'sources/extraction'/name).read_bytes()==(T/'sources/extraction'/name).read_bytes()
hashes=ROOT/'FILES.sha256.json'
if hashes.exists():
 for path,want in json.load(open(hashes)).items():assert sha(ROOT/path)==want,path
report={'packageId':'hiccup-front-v1','runtimeReady':False,'bodyDependency':deps['body'],'frames':results,'rebuildByteIdenticalPNGFiles':rebuilt,'sourceConfigAndExtractionJSONByteIdentical':a.rebuild,'sourceMasterPromptAndReferenceHashesVerified':True,'scope':'specific front hiccup continuous fore+palm source-pose; no general IK or full limbs approval'}
if a.report:a.report.parent.mkdir(parents=True,exist_ok=True);a.report.write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
