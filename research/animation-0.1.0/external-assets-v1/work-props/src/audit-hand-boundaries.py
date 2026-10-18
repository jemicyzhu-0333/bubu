import argparse,sys
p=argparse.ArgumentParser()
for k in ['repo-root','reference-root','cache-root']:p.add_argument('--'+k,required=True)
a=p.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else sys.argv[1:])
import json,collections
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
root=Path(a.cache_root)/'work-props';mapping=json.loads((Path(a.reference_root)/'research/animation-0.1.0/original-parts-hybrid-v1/geometry/binding-manifest.json').read_text())['sourceVertexIds'];hands=json.loads((root/'reports/source-hands.json').read_text());reports=[]
for id in ['keyboard','laptop','microphone','drum']:
 meshes=json.loads((root/'review'/f'{id}-static.json').read_text())['frames'][0]['meshes'];body=next(m for m in meshes if m['name']=='Bubu_body');bp=body['positions'];bv=[Vector(bp[i:i+3]) for i in range(0,len(bp),3)];bi=body['indices'];bvh=BVHTree.FromPolygons(bv,[bi[i:i+3] for i in range(0,len(bi),3)],all_triangles=True)
 for source in hands:
  if id=='microphone' and source['name'].endswith('right'):continue
  m=next(m for m in meshes if m['name']==source['name']);pos=m['positions'];vs=[Vector(pos[i:i+3]) for i in range(0,len(pos),3)];idx=source['indices'];edges=collections.Counter(tuple(sorted((t[a],t[(a+1)%3]))) for t in [idx[i:i+3] for i in range(0,len(idx),3)] for a in range(3));new={i for i,v in enumerate(mapping[source['name']]) if v<0};boundary=sorted({v for t in [idx[i:i+3] for i in range(0,len(idx),3)] if any(i in new for i in t) for v in t});signed=[]
  for i in boundary:
   p,n,_,d=bvh.find_nearest(vs[i]);signed.append((vs[i]-p).dot(n))
  reports.append({'id':id,'hand':source['name'],'boundaryVertexCount':len(boundary),'boundaryVertexIds':boundary,'maxSignedDistance':max(signed) if signed else None,'outsideBoundaryCount':sum(d>0 for d in signed),'allBoundaryBuried':bool(boundary) and max(signed)<0})
(root/'reports'/'hand-boundary-audit.json').write_text(json.dumps(reports,indent=2));print(json.dumps([{k:v for k,v in x.items() if k!='boundaryVertexIds'} for x in reports],indent=2))
