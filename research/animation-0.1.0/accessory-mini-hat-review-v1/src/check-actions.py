import bpy,json,sys,time
from pathlib import Path
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
P=Path(__file__).resolve().parents[1]/'work';topo=json.loads((P/'topology.json').read_text());results=json.loads((P/'robust-combination-results.json').read_text()) if (P/'robust-combination-results.json').exists() else [];offsets=np.cumsum([0]+[m['count'] for m in topo]);skinidx=next(i for i,m in enumerate(topo) if m['name']=='A_mochi_skin');first=np.fromfile(P/'frames/0.bin',dtype=np.float32).reshape(-1,3);skin0=first[offsets[skinidx]:offsets[skinidx+1]];earids=np.flatnonzero((skin0[:,1]>1.66)&(np.abs(skin0[:,0]*np.cos(np.radians(10))-skin0[:,2]*np.sin(np.radians(10)))>.30));tipids=set(np.flatnonzero(skin0[:,1]>1.76));limbs=set(topo[skinidx]['limbs']);dirs=[Vector((0,0,1)),Vector((-.70710678,0,.70710678)),Vector((.70710678,0,.70710678))];raydir=Vector((.932,.271,.241)).normalized()
def groupname(m):
 n=m['name']
 return 'scarf_collar' if n.startswith('scarf_collar') else 'scarf_tail' if n.startswith('scarf_tail') else n

def inside(tree,p):
 votes=0
 for dr in [(1,.137,.319),(-.421,.871,.225),(.102,-.341,.934)]:
  direction=Vector(dr).normalized();origin=Vector(p);hits=0
  for _ in range(40):
   h=tree.ray_cast(origin,direction,10)[0]
   if h is None:break
   hits+=1;origin=h+direction*1e-5
  votes+=hits%2
 return votes>=2

def process(f):
 data=np.fromfile(P/('frames/'+str(f['id'])+'.bin'),dtype=np.float32).reshape(-1,3);groups={};body=[];features=[]
 for i,m in enumerate(topo):
  a=data[offsets[i]:offsets[i+1]];faces=np.array(m['indices'],dtype=np.int32).reshape(-1,3)
  if m['kind']!='body':
   key=groupname(m);g=groups.setdefault(key,{'v':[],'f':[],'kind':m['kind']});o=len(g['v']);g['v'].extend(a.tolist());g['f'].extend((faces+o).tolist())
  elif i==skinidx:skin=a;skintree=BVHTree.FromPolygons(a.tolist(),faces.tolist(),all_triangles=True)
  else:
   p=a[faces];area=np.linalg.norm(np.cross(p[:,1]-p[:,0],p[:,2]-p[:,0]),axis=1);ids=np.unique(faces[area>1e-10]);features.extend((m['name'],Vector(a[k])) for k in ids)
 collisions=[];pairs=[];distance={}
 for name,g in groups.items():
  g['a']=np.array(g['v']);g['tree']=BVHTree.FromPolygons(g['v'],g['f'],all_triangles=True);g['lo']=g['a'].min(0);g['hi']=g['a'].max(0);ids=np.flatnonzero(np.all((skin>=g['lo'])&(skin<=g['hi']),axis=1));hits=[]
  for k in ids:
   p=Vector(skin[k]);q,n,fi,d=g['tree'].find_nearest(p)
   if d>.0005 and inside(g['tree'],p):hits.append({'vertex':int(k),'limb':int(k) in limbs,'depth':float(d)})
  if hits:collisions.append({'mesh':name,'count':len(hits),'limbCount':sum(h['limb'] for h in hits),'maxDepth':max(h['depth'] for h in hits),'examples':hits[:3]})
 for name,g in groups.items():
  for other,h in groups.items():
   if g['kind']==h['kind']:continue
   ids=np.flatnonzero(np.all((g['a']>=h['lo'])&(g['a']<=h['hi']),axis=1));hits=[]
   for k in ids:
    p=Vector(g['a'][k]);q,n,fi,d=h['tree'].find_nearest(p)
    if d>.0005 and inside(h['tree'],p):hits.append(float(d))
   if hits:pairs.append({'from':name,'inside':other,'count':len(hits),'maxDepth':max(hits)})
 occlusion=[]
 for view,direction in enumerate(dirs):
  hits={};earhits=0;tiphits=0;earVisible=0;tipVisible=0
  for name,p in features:
   if skintree.ray_cast(p+direction*1e-4,direction,10)[0] is not None:continue
   for gn,g in groups.items():
    if g['tree'].ray_cast(p+direction*1e-4,direction,10)[0] is not None:hits[gn+':'+name]=hits.get(gn+':'+name,0)+1
  for k in earids:
   p=Vector(skin[k]);
   if skintree.ray_cast(p+direction*1e-4,direction,10)[0] is not None:continue
   earVisible+=1;tipVisible+=int(k in tipids)
   if any(g['tree'].ray_cast(p+direction*1e-4,direction,10)[0] is not None for g in groups.values()):earhits+=1;tiphits+=int(k in tipids)
  occlusion.append({'view':view,'features':hits,'visibleEarVertices':earVisible,'occludedEarVertices':earhits,'visibleTipVertices':tipVisible,'occludedTipVertices':tiphits})
 return {**f,'bodyPenetrations':collisions,'accessoryPairPenetrations':pairs,'occlusion':occlusion}
while True:
 manifest=json.loads((P/'manifest.json').read_text());fresh=manifest[len(results):]
 for f in fresh:
  r=process(f);results.append(r)
  if r['bodyPenetrations'] or any(o['features'] or o['occludedTipVertices'] for o in r['occlusion']):print('FINDING',json.dumps(r),flush=True)
  if len(results)%10==0 or len(results)==1:(P/'robust-combination-results.json').write_text(json.dumps(results));print('PROGRESS',len(results),flush=True)
 if (P/'export-result.json').exists() and len(results)==len(json.loads((P/'manifest.json').read_text())):break
 time.sleep(2)
(P/'robust-combination-results.json').write_text(json.dumps(results));print('DONE',len(results),flush=True)
