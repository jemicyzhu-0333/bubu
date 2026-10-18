"""Current-input geometric support audit, not force/density simulation or native acceptance."""
import bpy,json,hashlib,argparse,sys,array
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
p=argparse.ArgumentParser();p.add_argument('--cache-root',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--baseline-cache-root',type=Path,required=True)
a=p.parse_args(sys.argv[sys.argv.index('--')+1:]);c=a.cache_root;pkg=Path(__file__).resolve().parents[2]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def expand(d,f):
 out=[]
 for m in f['meshes']:
  m={**d.get('sharedMeshes',{}).get(m['name'],{}),**m}
  if 'positions' not in m:
   raw=array.array('f');raw.frombytes(Path(m['positionsFile']).read_bytes());m['positions']=list(raw)
  out.append(m)
 return out
def geo(m):
 vs=[Vector(m['positions'][i:i+3]) for i in range(0,len(m['positions']),3)];ii=m['indices'];fs=[ii[i:i+3] for i in range(0,len(ii),3)];return vs,fs,BVHTree.FromPolygons(vs,fs,all_triangles=True)
def hull(points):
 ps=sorted(set(points))
 def cross(a,b,c):return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
 if len(ps)<3:return ps
 lo=[];hi=[]
 for seq,out in [(ps,lo),(list(reversed(ps)),hi)]:
  for p in seq:
   while len(out)>1 and cross(out[-2],out[-1],p)<=0:out.pop()
   out.append(p)
 return lo[:-1]+hi[:-1]
def area(h):return abs(sum(h[i][0]*h[(i+1)%len(h)][1]-h[(i+1)%len(h)][0]*h[i][1] for i in range(len(h))))/2 if len(h)>2 else 0
floating={'butterfly':'independent flying creature','star':'intentional magic effect','ghost':'intentional supernatural hover'}
grounded={'tissue','cushion','telescope','pillow','camera','ball','treasure-chest','cardboard-box','building-block','magic-hat','yarn','pumpkin-lantern','shovel','broom','dirt-mound','plant-pot','drum','keyboard','laptop'}
items=[];inputs={}
entries=[]
for g in ['comfort-props','leisure-props','play-props','fantasy-props','garden-props']:
 ids=[x['id'] for x in json.load(open(pkg/'catalog.json'))['props'] if x['model'].startswith(g+'/')]
 if g=='comfort-props':ids+=['tissue-sheet','telescope-handheld']
 for id in ids:
  name=id+'-mounted.json'
  if id in ['shovel','broom']:name=id+'-depth-v2.json'
  if id=='watering-can':name='watering-can-fixed-stage-v2.json'
  entries.append((id,c/g/'reports'/name,0,None))
for id in ['keyboard','laptop','microphone','drum']:entries.append((id,c/'work-props/review'/f'{id}-static.json',0,None))
for id,i,prefix in [('open-book',0,'Book'),('paper-board',1,'Paper'),('pencil',1,'Pencil')]:entries.append((id,c/'prop-expansion/reports/static-render-input.json',i,prefix))
entries.append(('cup',c/'tea/reports/keyframes-compact.json',7,'Sip_'))
base=json.load(open(c/'accessory/review/halo-static.json'))['frames'][0]['meshes'];base={m['name']:m for m in base}
for id,path,index,prefix in entries:
 d=json.load(open(path));ms=expand(d,d['frames'][index]);inputs[str(path)]=sha(path)
 for m in d['frames'][index]['meshes']:
  if m.get('positionsFile'):inputs[m['positionsFile']]=sha(Path(m['positionsFile']))
 actor={m['name']:m for m in ms if m['name'].startswith(('A_','Bubu_'))};props=[m for m in ms if not m['name'].startswith(('A_','Bubu_')) and (prefix is None or m['name'].startswith(prefix))];gs=[geo(m) for m in props];vs=[v for g in gs for v in g[0]]
 if not vs:raise ValueError(id)
 body=geo(actor['Bubu_body'])[2];faces=[geo(m)[2] for n,m in actor.items() if n.startswith('A_')];hands={n:geo(m) for n,m in actor.items() if n.startswith('Bubu_hand')};contacts={}
 for name,(hv,hf,hb) in hands.items():
  ds=[min(g[2].find_nearest(v)[3] for g in gs) for v in hv];patch=0
  for f in hf:
   v0,v1,v2=[hv[i] for i in f];center=(v0+v1+v2)/3
   if min(g[2].find_nearest(center)[3] for g in gs)<.01:patch+=(v1-v0).cross(v2-v0).length/2
  contacts[name]={'minimumDistance':min(ds),'verticesWithin001':sum(x<.01 for x in ds),'triangleCentroidPatchAreaWithin001':patch,'finitePatch':patch>.00005}
 mn=min(v.y for v in vs);plane=-.034 if id=='picnic-mat' else .006;bottom=[(round(v.x,7),round(v.z,7)) for v in vs if v.y<mn+.012];h=hull(bottom)
 kind='ground' if id in grounded else ('feet-on-mat' if id=='picnic-mat' else ('scene-cutout' if id=='ground-hole' else ('intentional-flight' if id in floating else 'hand-constraint')))
 item={'id':id,'kind':kind,'input':str(path),'frame':index,'inputSha256':sha(path),'bounds':[[min(v[k] for v in vs),max(v[k] for v in vs)] for k in range(3)],'bodyTriangleCrossings':sum(len(g[2].overlap(body)) for g in gs),'faceTriangleCrossings':sum(len(g[2].overlap(f)) for g in gs for f in faces),'handContacts':contacts,'groundPlane':plane if kind in ['ground','feet-on-mat'] else None,'groundError':abs(mn-plane) if kind in ['ground','feet-on-mat'] else None,'nearBottomSupportHullArea':area(h),'supportHullTolerance':.012,'actorBodyUnchanged':actor['Bubu_body']['positions']==base['Bubu_body']['positions'],'exception':floating.get(id),'claim':'geometric support only; contact patch is not a force-closure proof'}
 if kind=='hand-constraint':item['finiteSurfaceContact']=any(x['finitePatch'] for x in contacts.values());item['graspClosure']='not certified: original fin hands retained; no invented fingers or new action'
 if id=='ground-hole':item['exception']='Requires host ground cutout; cannot be placed on opaque solid floor as a physical hole'
 if id=='picnic-mat':item['exception']='Mat thickness 0.04; its top meets original feet at 0.006, scene floor must be -0.034'
 if id=='tissue-sheet':item['gravityOrientation']='Pinned original corner; free sheet lies below grip, original ripple geometry retained'
 if id in ['open-book','paper-board','pencil']:
  delta=max(abs(x-y) for x,y in zip(actor['Bubu_body']['positions'],base['Bubu_body']['positions']))
  item['bodyMaximumCoordinateDeltaVsStaticBaseline']=delta
  item['actorBodyUnchangedWithinFloat32']=delta<1e-7
 if id=='cup':item['actorBodyUnchanged']='old tea action pose; different from idle by design, source checked separately'
 oldpath=a.baseline_cache_root/path.relative_to(c);olddata=json.load(open(oldpath));oldactor={m['name']:m for m in expand(olddata,olddata['frames'][index]) if m['name'].startswith(('A_','Bubu_'))}
 item['originalActorArraysUnchangedVsPriorPose']=all(m['positions']==oldactor[n]['positions'] and m['indices']==oldactor[n]['indices'] for n,m in actor.items())
 item['priorPoseBaseline']=str(oldpath);inputs[str(oldpath)]=sha(oldpath)
 if id in ['open-book','paper-board','pencil']:item['idleBaselineDifferenceExplanation']='Existing basic-prop workflow uses original local hybrid pose; comparison against previous same-pose export is authoritative'
 items.append(item)
for path in [Path(__file__),pkg/'prop-expansion/src/support-geometry.mjs',pkg/'prop-expansion/mount-profiles.json',pkg/'prop-expansion/src/build-static-fit.mjs',pkg/'prop-expansion/src/prepare-static-render.py',pkg/'prop-expansion/src/check-book-facing.mjs']+[f for g in ['comfort-props','leisure-props','play-props','fantasy-props','garden-props','work-props'] for f in (pkg/g/'src').glob('*.mjs')]:inputs[str(path)]=sha(path)
a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(json.dumps({'schema':'bubu-prop-support-physics/1','scope':'41 geometry families/variants, actual mounted geometry; no density/friction or full grip simulation; unchanged original body and hand sources. Static research only.','items':items,'inputs':[{'path':k,'sha256':v} for k,v in inputs.items()]},indent=2));print('Audited',len(items),'items');print([(i['id'],i['groundError'],i['bodyTriangleCrossings'],i.get('finiteSurfaceContact')) for i in items])
