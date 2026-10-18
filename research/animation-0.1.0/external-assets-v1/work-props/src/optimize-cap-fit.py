# Historical research optimizer; never used by the final fixed-fit acceptance pipeline.
import argparse,sys
p=argparse.ArgumentParser()
for k in ['repo-root','reference-root','cache-root']:p.add_argument('--'+k,required=True)
a=p.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else sys.argv[1:])
import json,math,random
from pathlib import Path
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
root=Path(a.cache_root)/'work-props';mapping=json.loads((Path(a.reference_root)/'research/animation-0.1.0/original-parts-hybrid-v1/geometry/binding-manifest.json').read_text())['sourceVertexIds'];placements=json.loads((root/'reports/static-placements.json').read_text());rng=random.Random(8412);report=[]
def rotation(x,y,z):
 cx,sx=math.cos(x),math.sin(x);cy,sy=math.cos(y),math.sin(y);cz,sz=math.cos(z),math.sin(z)
 return np.array([[cy*cz,-cy*sz,sy],[sx*sy*cz+cx*sz,-sx*sy*sz+cx*cz,-sx*cy],[-cx*sy*cz+sx*sz,cx*sy*sz+sx*cz,cx*cy]])
def tree(m):
 vs=np.array(m['positions']).reshape(-1,3);idx=np.array(m['indices']).reshape(-1,3);return vs,BVHTree.FromPolygons([Vector(v) for v in vs],idx.tolist(),all_triangles=True)
for id in ['keyboard','laptop','microphone','drum']:
 path=root/'review'/f'{id}-static.json';data=json.loads(path.read_text());meshes=data['frames'][0]['meshes'];bm=next(m for m in meshes if m['name']=='Bubu_body');_,body=tree(bm);props=[tree(m)[1] for m in meshes if not m['name'].startswith(('Bubu_','A_','Diagnostic'))];placement=next(x for x in placements if x['id']==id)
 for trans in placement['handTransforms']:
  name=trans['mesh'];m=next(m for m in meshes if m['name']==name);vs=np.array(m['positions']).reshape(-1,3);idx=np.array(m['indices']).reshape(-1,3);new={i for i,v in enumerate(mapping[name]) if v<0};cap=sorted({int(v) for t in idx if any(int(i) in new for i in t) for v in t});capvs=vs[cap]
  distances=[min(p.find_nearest(Vector(v))[3] for p in props) for v in vs];pi=int(np.argmin(distances));pivot=vs[pi];best=None;side=-1 if name.endswith('left') else 1
  for iteration in range(2200):
   angles=[rng.uniform(0,.95),side*rng.uniform(-.1,.75),rng.uniform(-.45,.45)] if iteration else [0,0,0];R=rotation(*angles);test=(capvs-pivot)@R.T+pivot;maxsigned=-1
   for v in test[::5]:
    p,n,_,d=body.find_nearest(Vector(v));signed=float((Vector(v)-p).dot(n));maxsigned=max(maxsigned,signed)
    if maxsigned>.0:break
   if maxsigned>0:continue
   signs=[]
   for v in test:
    p,n,_,d=body.find_nearest(Vector(v));signs.append(float((Vector(v)-p).dot(n)))
   score=sum(a*a for a in angles)
   if max(signs)<-.002 and (best is None or score<best[0]):best=(score,R,angles,max(signs))
  if not best:report.append({'id':id,'hand':name,'status':'NO_RIGID_SOLUTION_FOUND'});continue
  _,R,angles,maximum=best;m['positions']=((vs-pivot)@R.T+pivot).reshape(-1).tolist();oldR=rotation(*trans['rotation']);newR=R@oldR;delta=R@(np.array(trans['translation'])-pivot)+pivot;trans['matrix3']=newR.tolist();trans['translation']=delta.tolist();trans['root']=(R@(np.array(trans['root'])-pivot)+pivot).tolist();trans['extraRotationAboutContact']=angles;trans['contactPivot']=pivot.tolist();trans['contactVertex']=pi
  report.append({'id':id,'hand':name,'status':'CAP_BURIED','maxCapSigned':maximum,'pivotVertex':pi,'originalContactDistance':distances[pi],'extraRotation':angles})
 path.write_text(json.dumps(data))
(root/'reports/static-placements.json').write_text(json.dumps(placements,indent=2));(root/'reports/cap-optimization.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
