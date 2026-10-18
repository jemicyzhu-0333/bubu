import json,math,array
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent))
if "--" in sys.argv:sys.argv=[sys.argv[0],*sys.argv[sys.argv.index("--")+1:]]
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from portable_paths import P;d=json.loads((P/'reports/contact-point-classification.json').read_text());rows=[]
for row in d['rows']:
 scene=json.loads((P/f"review/contact-{row['kind']}-{row['phase']}.json").read_text());vertices=[];faces=[];names=[]
 for m in scene['frames'][0]['meshes']:
  if m.get('opacity',1)<=0:continue
  if 'positions'in m:p=m['positions']
  else:p=array.array('f');p.frombytes(Path(m['positionsFile']).read_bytes())
  offset=len(vertices);vertices.extend([p[i:i+3] for i in range(0,len(p),3)]);ind=m['indices'];faces.extend([(offset+ind[i],offset+ind[i+1],offset+ind[i+2]) for i in range(0,len(ind),3)]);names.extend([m['name']]*(len(ind)//3))
 tree=BVHTree.FromPolygons(vertices,faces,all_triangles=True)
 for contact in row['contacts']:
  out={k:v for k,v in contact.items() if k!='points'};out.update({'kind':row['kind'],'phase':row['phase'],'time':row['time'],'views':{}})
  for yaw in [0,45]:
   direction=Vector((math.sin(math.radians(yaw)),0,math.cos(math.radians(yaw))));visible=0;blocked={}
   for point in contact['points']:
    hit,normal,index,distance=tree.ray_cast(Vector(point)+direction*.0002,direction,20)
    if hit is None:visible+=1
    else:blocked[names[index]]=blocked.get(names[index],0)+1
   out['views'][str(yaw)]={'unoccludedIntersectionSamples':visible,'occluders':blocked}
  rows.append(out)
report={'method':'Orthographic +Z front / 45deg rays from actual edge-intersection points, offset0.0002 to skip surface numerical self hit; all visible triangle meshes occlude. Visibility is sampled crossing-seam evidence, not full pixel artifact severity.','rows':rows}
(P/'reports/contact-visibility.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
