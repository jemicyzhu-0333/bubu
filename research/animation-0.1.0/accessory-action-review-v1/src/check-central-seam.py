import bpy,json
from pathlib import Path
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
P=Path(__file__).resolve().parents[1]/'work';topo=json.loads((P/'topology.json').read_text());offsets=np.cumsum([0]+[m['count'] for m in topo]);idx=next(i for i,m in enumerate(topo) if m['name']=='satchel_continuous_strap');faces=np.array(topo[idx]['indices']).reshape(-1,3);first=np.fromfile(P/'frames/0.bin',dtype=np.float32).reshape(-1,3);a=first[offsets[idx]:offsets[idx+1]];centers=a[faces].mean(1);select=np.flatnonzero((centers[:,0]>-.15)&(centers[:,0]<.55)&(centers[:,1]>.4)&(centers[:,1]<.72)&(centers[:,2]>.5));rows=[];direction=Vector((0,0,1))
for f in json.loads((P/'manifest.json').read_text()):
 data=np.fromfile(P/('frames/'+str(f['id'])+'.bin'),dtype=np.float32).reshape(-1,3);trees=[];v=data[offsets[idx]:offsets[idx+1]]
 for i,m in enumerate(topo):
  if m['name']=='A_mochi_skin' or m['kind']!='body':trees.append(BVHTree.FromPolygons(data[offsets[i]:offsets[i+1]].tolist(),np.array(m['indices']).reshape(-1,3).tolist(),all_triangles=True))
 visible=[]
 for k in select:
  p=Vector(v[faces[k]].mean(0));origin=p+direction*1e-4
  if not any(t.ray_cast(origin,direction,10)[0] is not None for t in trees):visible.append(int(k))
 rows.append({**f,'centralFrontStrapSamples':len(select),'visibleSampleCount':len(visible),'visibleTriangleIds':visible})
(P/'central-seam-visibility.json').write_text(json.dumps(rows));print('DONE',len(rows),'samples',len(select),'range',min(r['visibleSampleCount'] for r in rows),max(r['visibleSampleCount'] for r in rows),flush=True)
