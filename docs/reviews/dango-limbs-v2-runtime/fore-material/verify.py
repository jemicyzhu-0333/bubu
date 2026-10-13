"""Reproduce forearm source, elbow, and offscreen standard-painter evidence.
Requires Python 3 + Pillow; Node and repo's pinned @napi-rs/canvas dependency.
"""
import argparse,hashlib,json,math,subprocess
from pathlib import Path
from PIL import Image,ImageDraw
ap=argparse.ArgumentParser()
for k in ('repo','baseline-package','candidate-package','out'):ap.add_argument('--'+k,required=True,type=Path)
a=ap.parse_args();R=a.repo.resolve();B=a.baseline_package.resolve();P=a.candidate_package.resolve();O=a.out.resolve();O.mkdir(parents=True,exist_ok=True)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
m=json.loads((P/'limbs.json').read_text());upper=m['segments']['arm-upper-l']['frames'];fore=m['segments']['arm-fore-l']['frames']
r={'baselineCommit':'27d9846','scope':'Offscreen Skia only; explicit preview opt-in; standard artist fallback and direct accepted-plan demonstration are separate','runtimeReady':m['extensions']['runtimeReady'],'hostAcceptsContract':None,'source':{'upperBytesIdentical':all(sha(P/f['src'])==sha(B/f['src']) for f in upper),'foreDifferentFromBaseline':sum(sha(P/f['src'])!=sha(B/f['src']) for f in fore),'foreDifferentFromUpper':sum(Image.open(P/f['src']).tobytes()!=Image.open(P/u['src']).tobytes() for f,u in zip(fore,upper)),'sourceBodyFilesIdentical':all(sha(P/s['sourceBody']['src'])==sha(B/s['sourceBody']['src']) for s in m['sockets']),'inverseSampleExact':0},'joints':{},'identity':{}}
for f in fore:
 src=Image.open(P/f['source']).convert('RGBA');im=Image.open(P/f['src']).convert('RGBA');mat=f['inverseSamplingMatrix'];expected=Image.new('RGBA',im.size);palette=[(248,104,120),(248,128,128),(240,80,104),(26,27,38)]
 for y in range(im.height):
  for x in range(im.width):
   u=math.floor(mat[0][0]*(x+.5)+mat[0][1]*(y+.5)+mat[0][2]);v=math.floor(mat[1][0]*(x+.5)+mat[1][1]*(y+.5)+mat[1][2]);q=src.getpixel((u,v)) if 0<=u<src.width and 0<=v<src.height else (0,0,0,0)
   if q[3]:expected.putpixel((x,y),(*min(palette,key=lambda c:sum((c[k]-q[k])**2 for k in range(3))),255))
 assert expected.tobytes()==im.tobytes(),f['src'];r['source']['inverseSampleExact']+=1
panel=Image.new('RGB',(720,310),(240,240,235));draw=ImageDraw.Draw(panel)
for row,(tag,p) in enumerate([('old',B),('candidate',P)]):
 manifest=json.loads((p/'limbs.json').read_text());j=json.loads((p/'joints/elbow.json').read_text());n=0
 identities=['limbs.json','joints/elbow.json']+[f['src'] for f in manifest['segments']['arm-fore-l']['frames']];r['identity'][tag]={f:sha(p/f) for f in identities};draw.text((6,row*150+2),tag,fill='black')
 for f in j['frames']:
  im=Image.new('RGBA',tuple(f['size']))
  for key,root in [('sourceUpper',f['upperRoot']),('sourceFore',f['root'])]:
   fr=next(x for seg in manifest['segments'].values() for x in seg['frames'] if x['src']==f[key]);sprite=Image.open(p/f[key]).convert('RGBA');im.alpha_composite(sprite,(round(root[0]-fr['root'][0]),round(root[1]-fr['root'][1])))
  before=im.copy();mask=Image.open(p/f['mask']).convert('RGBA');patch=Image.open(p/f['patch']).convert('RGBA');actual={};declared={tuple(e['xy']):e for e in f['changedPixels']}
  for y in range(im.height):
   for x in range(im.width):
    if mask.getpixel((x,y))[3] and im.getpixel((x,y))[3] and patch.getpixel((x,y))[3]:
     b=im.getpixel((x,y));im.putpixel((x,y),(*patch.getpixel((x,y))[:3],b[3]));after=im.getpixel((x,y))
     if b!=after:actual[(x,y)]={'xy':[x,y],'before':list(b),'after':list(after)}
  assert actual==declared,(tag,f['key']);assert im.getchannel('A').tobytes()==before.getchannel('A').tobytes();n+=1
  pairs=[(0,0),(45,45),(292.5,247.5)];pair=(f['upperAngle'],f['foreAngle'])
  if pair in pairs:
   col=pairs.index(pair);tile=Image.new('RGB',(90,90),(240,240,235));td=ImageDraw.Draw(tile);td.text((0,0),f'{pair[0]:g}/{pair[1]:g}',fill='black');crop=im.crop((5,5,44,44)).resize((78,78),Image.Resampling.NEAREST);tile.paste(crop,(0,12),crop);panel.paste(tile.resize((135,135),Image.Resampling.NEAREST),(col*230+60,row*150+15))
 r['joints'][tag]={'actualMaskPatchEqualsDeclaredEdits':n,'actualAlphaPreserved':n,'legalPairs':sum(f['allowedByBendLimit'] for f in j['frames'])}
panel.save(O/'representative-elbows.png')
subprocess.run(['node',str(Path(__file__).with_name('reproduce.mjs')),'--repo',str(R),'--baseline-package',str(B),'--candidate-package',str(P),'--out',str(O)],check=True)
samples=json.loads((O/'sample-records.json').read_text());r['standardArtist']={id:{side:{'actualLimbFrames':sum(any(h['side']==side and h['actualStandardLimb'] for h in row['hands']) for row in rows),'samples':len(rows)} for side in ['left','right']} for id,rows in samples['actions'].items()}
direct=json.loads((O/'direct-records.json').read_text());r['directMaterialOnly']={}
for tag in ['old','candidate']:
 for id in ['wave','high-five']:
  rows=[x for x in direct['frames'] if x['tag']==tag and x['id']==id];pairs=list(zip(rows,rows[1:]));r['directMaterialOnly'][id+'-'+tag]={'sampledFrames':len(rows),'phaseRange':[rows[0]['p'],rows[-1]['p']],'angleChanges':sum(x['angles']!=y['angles'] for x,y in pairs),'maxWristJumpArt':max(math.dist(x['wrist'],y['wrist']) for x,y in pairs),'maxContactJumpArt':max(math.dist(x['contact'],y['contact']) for x,y in pairs),'maxContactErrorArt':max(x['error'] for x in rows)}
r['boundedSourceRepair']={'status': 'No passing replacement; retain original registration', 'source': 'assets/companion/dango/raster/limbs/sources/masters/short-arm-study-v2.png', 'retainedGlobalRoot': [634.5, 305.5], 'testedRootX': [634.5, 637.5, 640.5, 643.5, 646.5], 'finding': 'First three retain bumps; 643.5 reaches palm neck and retains lower bump; 646.5 tip transparent. No alternative production set promoted.', 'evidenceScope': 'Separately reviewed bounded source experiment; not rerun by these two publication scripts'}
r['excludedReproducibleOutputs']=['standard-artist-comparison.png','sample-records.json','direct-records.json','Full 256-joint contact sheets and GIFs from the original local review are not included.'];(O/'aggregate.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps({'source':r['source'],'joints':r['joints']},indent=2))
