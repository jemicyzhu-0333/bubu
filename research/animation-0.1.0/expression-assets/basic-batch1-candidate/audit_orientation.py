import bpy,json,sys,hashlib,numpy as np
from pathlib import Path
P=Path(__file__).parent;sys.path.insert(0,str(P));from basic_face_utils import apply_basic,STATES
bpy.ops.wm.open_mainfile(filepath=str(P/'_restored/bubu-a05-basic-batch1.blend'))
faces=[o for o in bpy.data.objects if o.name.startswith('A_eye') or o.name.startswith('A_brow') or o.name=='A_mouth_ring'];R={'assetSHA256':hashlib.sha256((P/'bubu-a05-basic-batch1.glb').read_bytes()).hexdigest(),'samples':{},'expectedDegeneracy':'Brows collapse completely in Basis and every non-N2 face; closed highlights collapse after P2 .625; mouth inner vertices may coalesce to a closed stroke. These are explicitly allowed zero-area geometry, not zero degenerate triangles.'}
def triinfo(o):
 ev=o.evaluated_get(bpy.context.evaluated_depsgraph_get());m=ev.to_mesh();m.calc_loop_triangles();v=np.array([p.co[:] for p in m.vertices]);t=np.array([p.vertices[:] for p in m.loop_triangles]);a=v[t[:,1]]-v[t[:,0]];b=v[t[:,2]]-v[t[:,0]];cross=a[:,0]*b[:,2]-a[:,2]*b[:,0];emin=np.min(np.stack([np.linalg.norm(a,axis=1),np.linalg.norm(b,axis=1),np.linalg.norm(a-b,axis=1)]),axis=0);ev.to_mesh_clear();return cross,emin
def tris(o):return triinfo(o)[0]
apply_basic('N2',1);sign={o.name:np.sign(tris(o)[np.argmax(abs(tris(o)))]) for o in faces}
for st in STATES:
 for i in range(65):
  t=i/64;apply_basic(st,t);row={}
  for o in faces:
   a,emin=triinfo(o);negative=a*sign[o.name]<-1e-10;row[o.name]={'reversedProjectedTriangles':int(np.sum(negative & (emin>2e-7))),'rawNegativeIncludingCollapsedRoundoff':int(np.sum(negative)),'collapsedEdgeRoundoffTriangles':int(np.sum(negative & (emin<=2e-7))),'collapsedProjectedTriangles':int(np.sum(abs(a)<1e-12)),'minOrientedProjectedDoubleArea':float(min(a*sign[o.name]))}
  R['samples'][f'{st}-{t:.6f}']=row
R['numericalCollapseEdgeTolerance']=2e-7
R['passNoProjectedReversal']=all(a['reversedProjectedTriangles']==0 for row in R['samples'].values() for a in row.values());R['neutralBrowsCollapsed']=all(all(tuple(v.co)==tuple(o.data.vertices[0].co) for v in o.data.vertices) for o in faces if o.name.startswith('A_brow'))
R['singleStateNonN2BrowsCollapsed']=all(row[n]['collapsedProjectedTriangles']==len(bpy.data.objects[n].data.polygons) for k,row in R['samples'].items() if not k.startswith('N2-') for n in ['A_brow_L','A_brow_R'])
(P/'projected-orientation-audit.json').write_text(json.dumps(R,indent=2));print('PROJECTED_ORIENTATION',R['passNoProjectedReversal'],R['neutralBrowsCollapsed'],R['singleStateNonN2BrowsCollapsed'])
