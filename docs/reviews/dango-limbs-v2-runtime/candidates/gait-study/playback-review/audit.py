import os
from PIL import Image,ImageChops
from pathlib import Path
import json,math,hashlib
O=Path(__file__).resolve().parent;G=O.parent;P=Path(os.environ['DANGO_CANONICAL_PACKAGE']);ss=json.load(open(O/'samples.json'));meta=json.load(open(G/'gait-source.json'));fs={f['id']:f for f in meta['frames']}
ns={'__file__':str(G/'render_phase_set.py')};exec((G/'render_phase_set.py').read_text().split('phases=')[0],ns);base=ns['layer'](ns['d']['body'],0)
report={}
for mode,samples in ss.items():
 overlaps=[];seams=[];switches=[];worlddrift=0;last={};support={};clear=[]
 for s in samples:
  b=Image.new('RGBA',(174,86));b.alpha_composite(base,(round(s['bodyWorldX']),0));bp=b.load()
  for f in s['feet']:
   r=fs[f['frame']];im=Image.open(G/r['src']).convert('RGBA');pos=[round(f['rootWorld'][k]-r['root'][k]+[16,10][k])for k in(0,1)];pts=[(x,y)for y in range(im.height)for x in range(im.width)if im.getpixel((x,y))[3]];ov=[(x,y)for x,y in pts if bp[x+pos[0],y+pos[1]][3]];overlaps.append({'q':s['q'],'role':f['role'],'frame':f['frame'],'overlapPixels':len(ov),'footPixels':len(pts)})
   if f['support']:
    key=(f['role'],f['landingCycle']);prev=support.setdefault(key,f['soleWorld']);worlddrift=max(worlddrift,max(abs(prev[k]-f['soleWorld'][k])for k in (0,1)))
   role=f['role'];old=last.get(role)
   if old and old['frame']!=f['frame']:
    a=fs[old['frame']];ia=Image.open(G/a['src']).convert('RGBA');aligned=[]
    for rec,img in [(a,ia),(r,im)]:
     cv=Image.new('RGBA',(70,70));cv.alpha_composite(img,(round(35.5-rec['root'][0]),round(35.5-rec['root'][1])));aligned.append(cv)
    diff=sum(x!=y for x,y in zip(aligned[0].getdata(),aligned[1].getdata()));switches.append({'q':s['q'],'role':role,'from':old['frame'],'to':f['frame'],'rootAlignedChangedPixels':diff,'rootStep':max(abs(old['rootWorld'][k]-f['rootWorld'][k])for k in (0,1))})
   last[role]=f;clear.append(f['clearance'])
 report[mode]={'frames':len(samples),'qRange':[samples[0]['q'],samples[-1]['q']],'supports':sorted(set(s['supportCount']for s in samples)),'genuineFlightFrames':sum(s['flight']for s in samples),'floorPenetration':min(clear)<0,'stanceMarkerWorldDrift':worlddrift,'minimumBodyFootOverlap':min(x['overlapPixels']for x in overlaps),'maxRootAlignedSwitchPixelChange':max(x['rootAlignedChangedPixels']for x in switches),'switches':switches,'overlaps':overlaps}
old=json.load(open(P/'limbs.json'))['feet']['stand']['views'];report['bounds']={'oldQuarter':old['three-quarter-left'][0]['bounds'],'oldFront':old['front'][0]['bounds'],'candidateSupport':{k:fs[k]['bounds']for k in ['near-support','far-support']}};report['claimScope']='Offline fixed-camera fixed-world-ground replay, not DOM, cached artist, actual desktop, clothing or host integration. No source foot mask correction made.'
(O/'replay-audit.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:{a:b for a,b in v.items()if a not in ['switches','overlaps']}if isinstance(v,dict)else v for k,v in report.items()},indent=2))
for mode in ['walk','run']:
 im=Image.open(O/f'{mode}-replay-light-dark-1x-2x.gif');assert im.n_frames==120;print(mode,'GIF frame count',im.n_frames)
