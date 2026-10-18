"""Recompute final garden triangle crossings and actor identity; static scope only."""
import argparse,sys,json
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
p=argparse.ArgumentParser()
for k in ['repo-root','reference-root','cache-root']:p.add_argument('--'+k,required=True)
a=p.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else sys.argv[1:]);cache=Path(a.cache_root);root=cache/'garden-props/reports'
actor=lambda ms:[m for m in ms if m['name'].startswith(('Bubu_','A_'))]
base=actor(json.loads((cache/'accessory/review/halo-static.json').read_text())['frames'][0]['meshes'])
def tree(m):
 p=m['positions'];i=m['indices'];return BVHTree.FromPolygons([Vector(p[j:j+3]) for j in range(0,len(p),3)],[i[j:j+3] for j in range(0,len(i),3)],all_triangles=True)
body=tree(next(m for m in base if m['name']=='Bubu_body'));faces=[tree(m) for m in base if m['name'].startswith('A_')];items=[]
for id,suffix in [('shovel','depth-v2'),('broom','depth-v2'),('watering-can','fixed-stage-v2'),('dirt-mound','mounted'),('plant-pot','mounted')]:
 meshes=json.loads((root/f'{id}-{suffix}.json').read_text())['frames'][0]['meshes'];props=[tree(m) for m in meshes if m not in actor(meshes)]
 items.append({'id':id,'frame':f'{id}-{suffix}.json','unchanged13ActorMeshes':len(base)==13 and actor(meshes)==base,'bodyTriangleCrossings':sum(len(t.overlap(body)) for t in props),'faceTriangleCrossings':sum(len(t.overlap(f)) for t in props for f in faces)})
for x in items:x['staticAuditPass']=x['unchanged13ActorMeshes'] and x['bodyTriangleCrossings']==0 and x['faceTriangleCrossings']==0
(root/'current-mount-audit.json').write_text(json.dumps({'items':items,'scope':'fresh final static triangle audit; animation, garments and native runtime pending'},indent=2)+'\n');print(items)
