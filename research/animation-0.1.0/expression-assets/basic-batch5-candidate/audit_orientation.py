import bpy,json,sys,hashlib,numpy as np
from pathlib import Path
P=Path(__file__).parent;sys.path.insert(0,str(P));from basic_face_utils import apply_basic,STATES
bpy.ops.wm.open_mainfile(filepath=str(P/'bubu-a05-basic-batch5.blend'))
faces=[o for o in bpy.data.objects if o.name.startswith('A_eye') or o.name.startswith('A_brow') or o.name in ['A_mouth_ring','A_tongue']];R={'assetSHA256':hashlib.sha256((P/'bubu-a05-basic-batch5.glb').read_bytes()).hexdigest(),'samples':{},'expectedDegeneracy':'Hidden brow Basis/non-S3/S5 and closed mouth inner boundaries are intentionally collapsed. Raw collapse roundoff retained.'}
def triinfo(o):
 ev=o.evaluated_get(bpy.context.evaluated_depsgraph_get());m=ev.to_mesh();m.calc_loop_triangles();v=np.array([p.co[:] for p in m.vertices]);t=np.array([p.vertices[:] for p in m.loop_triangles]);a=v[t[:,1]]-v[t[:,0]];b=v[t[:,2]]-v[t[:,0]];cross=a[:,0]*b[:,2]-a[:,2]*b[:,0];emin=np.min(np.stack([np.linalg.norm(a,axis=1),np.linalg.norm(b,axis=1),np.linalg.norm(a-b,axis=1)]),axis=0);sv=np.array([p.co[:] for p in o.data.vertices]);sa=sv[t[:,1]]-sv[t[:,0]];sb=sv[t[:,2]]-sv[t[:,0]];smin=np.min(np.stack([np.linalg.norm(sa,axis=1),np.linalg.norm(sb,axis=1),np.linalg.norm(sa-sb,axis=1)]),axis=0);ev.to_mesh_clear();return cross,emin,smin
def tris(o):return triinfo(o)[0]
apply_basic('T5',0);sourcePole={o.name:((triinfo(o)[1]<1e-6) if 'highlight' in o.name else np.zeros(len(tris(o)),dtype=bool)) for o in faces}
sign={}
for o in faces:
 apply_basic('S3' if o.name.startswith('A_brow') else 'T5',1); sign[o.name]=np.sign(tris(o)[np.argmax(abs(tris(o)))])
for st in STATES:
 for i in range(65):
  t=i/64;apply_basic(st,t);row={}
  for o in faces:
   a,emin,smin=triinfo(o);negative=a*sign[o.name]<-1e-10;pole=(smin<1e-6) & (emin<1e-6) & (abs(a)<5e-10) & ('highlight' in o.name);row[o.name]={'reversedProjectedTriangles':int(np.sum(negative & (emin>2e-7) & ~pole)),'originalHighlightPoleRoundoffTriangles':int(np.sum(negative & pole)),'originalHighlightPoleRoundoffMaxEdge':float(max(emin[negative & pole],default=0)),'rawNegativeIncludingCollapsedRoundoff':int(np.sum(negative)),'collapsedEdgeRoundoffTriangles':int(np.sum(negative & (emin<=2e-7))),'collapsedProjectedTriangles':int(np.sum(abs(a)<1e-12)),'minOrientedProjectedDoubleArea':float(min(a*sign[o.name]))}
  R['samples'][f'{st}-{t:.6f}']=row
R['originalHighlightPoleRule']={'basisMinEdgeBelow':1e-6,'currentMinEdgeBelow':1e-6,'absoluteProjectedDoubleAreaBelow':5e-10,'purpose':'Narrow classification of inherited near-coincident highlight pole topology during shrink; raw negatives retained.'};R['numericalCollapseEdgeTolerance']=2e-7
R['passNoProjectedReversal']=all(a['reversedProjectedTriangles']==0 for row in R['samples'].values() for a in row.values());R['neutralBrowsCollapsed']=all(all(tuple(v.co)==tuple(o.data.vertices[0].co) for v in o.data.vertices) for o in faces if o.name.startswith('A_brow'))
(P/'projected-orientation-audit.json').write_text(json.dumps(R,indent=2));print('PROJECTED_ORIENTATION',R['passNoProjectedReversal'])
