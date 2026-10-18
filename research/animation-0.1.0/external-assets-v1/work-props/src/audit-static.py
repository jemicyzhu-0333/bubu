import argparse,sys
p=argparse.ArgumentParser()
for k in ['repo-root','reference-root','cache-root']:p.add_argument('--'+k,required=True)
a=p.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else sys.argv[1:])
import json,math
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
root=Path(a.cache_root)/'work-props';reports=[];placements=json.loads((root/'reports'/'static-placements.json').read_text())
for id in ['keyboard','laptop','microphone','drum']:
 data=json.loads((root/'review'/f'{id}-static.json').read_text()); meshes={}
 for m in data['frames'][0]['meshes']:
  pos=m['positions']; vs=[Vector(pos[i:i+3]) for i in range(0,len(pos),3)];idx=m['indices'];tri=[idx[i:i+3] for i in range(0,len(idx),3)]; meshes[m['name']]=(vs,BVHTree.FromPolygons(vs,tri,all_triangles=True))
 body=meshes['Bubu_body'][1];props={k:v for k,v in meshes.items() if not k.startswith(('A_','Bubu_','Diagnostic'))};faces=[v[1] for k,v in meshes.items() if k.startswith('A_')];hands={}
 for name in ['Bubu_hand-left','Bubu_hand-right']:
  vs,bvh=meshes[name];dist=[min(p[1].find_nearest(v)[3] for p in props.values()) for v in vs];bodydist=[body.find_nearest(v)[3] for v in vs]
  placement=next(x for x in placements if x['id']==id);trans=next((x for x in placement['handTransforms'] if x['mesh']==name),None)
  rp=Vector(trans['root']) if trans else None;nearest=body.find_nearest(rp) if rp else None
  signed=(rp-nearest[0]).dot(nearest[1]) if rp else None
  hands[name]={'rootSignedBodySurfaceDistance':signed,'minimumPropSurfaceDistance':min(dist),'handVerticesWithin001':sum(d<.01 for d in dist),'propBoundaryTriangleIntersections':sum(len(bvh.overlap(p[1])) for p in props.values()),'bodyBoundaryTriangleIntersections':len(bvh.overlap(body)),'minimumBodySurfaceDistance':min(bodydist)}
 clearance={k:min(body.find_nearest(v)[3] for v in vs[::max(1,len(vs)//200)]) for k,(vs,tree) in props.items()}
 reports.append({'sampledPropVertexBodyClearance':clearance,'id':id,'hands':hands,'propBodyBoundaryTriangleIntersections':{k:len(v[1].overlap(body)) for k,v in props.items()},'propFaceBoundaryTriangleIntersections':{k:sum(len(v[1].overlap(f)) for f in faces) for k,v in props.items()},'scope':'Actual triangle BVH surfaces. Overlap alone is not a clearance pass. Clothing and action range pending.'})
(root/'reports'/'static-geometry-audit.json').write_text(json.dumps(reports,indent=2));print(json.dumps(reports,indent=2))
