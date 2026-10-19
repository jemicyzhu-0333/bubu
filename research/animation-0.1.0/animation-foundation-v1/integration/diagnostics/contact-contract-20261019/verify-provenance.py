from pathlib import Path
exec((Path(__file__).resolve().parent/'displacement.py').read_text().split('def contact_count')[0])
from scipy.spatial.transform import Rotation
from collections import Counter
closed={}
for n in ['Bubu_hand-left','Bubu_hand-right']:
 m=mesh_at(d['frames'][0],n);ix=np.array(m['indices']).reshape(-1,3);v=vertices(m);_,vi=np.unique(v,axis=0,return_inverse=True);ix=vi[ix]
 edges=Counter(tuple(sorted(e)) for tri in ix for e in [(tri[0],tri[1]),(tri[1],tri[2]),(tri[2],tri[0])]);closed[n]=dict(Counter(edges.values()))
f0=next(f for f in d['frames'] if f['time']==1.5);s0=next(s for s in poses if s['time']==1.5);cup=[]
for f,s in zip(d['frames'],poses):
 if s['cup']['scale']<=0:continue
 for n in ['Sip_cup_shell','Sip_cup_handle','Sip_tea_surface']:
  if not any(m['name']==n for m in f['meshes']):continue
  v0=vertices(mesh_at(f0,n));v1=vertices(mesh_at(f,n));r0=Rotation.from_quat(s0['cup']['quaternion']).as_matrix();r1=Rotation.from_quat(s['cup']['quaternion']).as_matrix();calc=((v0-s0['cup']['center'])@r0)*s['cup']['scale']/s0['cup']['scale']@r1.T+s['cup']['center']
  cup.append({'time':f['time'],'name':n,'maxError':float(abs(calc-v1).max())})
out={'handRuntimeMaxError':max(r['maxPositionError'] for r in runtime),'cupRuntimeRelativeToHoldMaxError':max(r['maxError'] for r in cup),'cupChecks':cup,'handMergedEdgeIncidenceCounts':closed,'conventions':'source GLTF Y-up, +Z forward. Static sourceToWorld is a rigid 10-degree yaw with no scale; length units preserved. No SI calibration.'}
(OUT/'runtime-provenance.json').write_text(json.dumps(out,indent=2));print(json.dumps(out,indent=2))
