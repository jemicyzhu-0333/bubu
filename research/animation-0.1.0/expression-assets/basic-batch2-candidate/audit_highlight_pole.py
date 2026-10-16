import bpy,sys,json,hashlib,numpy as np
from pathlib import Path
P=Path(__file__).parent;sys.path.insert(0,str(P));from basic_face_utils import apply_basic
bpy.ops.wm.open_mainfile(filepath=str(P/'_restored/bubu-a05-basic-batch2.blend'))
R={'assetSHA256':hashlib.sha256((P/'bubu-a05-basic-batch2.glb').read_bytes()).hexdigest(),'rule':{'onlyMeshes':['A_eye_highlight_L','A_eye_highlight_R'],'sourceMinimumEdgeBelow':1e-6,'currentMinimumEdgeBelow':1e-6,'absoluteDoubleAreaBelow':5e-10},'cases':[],'note':'An inherited near-coincident highlight pole contracts toward closure. Original geometry is retained; raw negative signs are explicitly recorded, not suppressed. This numerical exception does not authorize general triangle reversal or replace visual inspection.'}
for name in R['rule']['onlyMeshes']:
 o=bpy.data.objects[name];sv=np.array([v.co[:] for v in o.data.vertices])
 for i in range(65):
  amount=i/64;apply_basic('A7',amount);ev=o.evaluated_get(bpy.context.evaluated_depsgraph_get());m=ev.to_mesh();m.calc_loop_triangles();v=np.array([v.co[:] for v in m.vertices])
  for ti,t in enumerate(m.loop_triangles):
   ids=list(t.vertices);a,b=v[ids[1]]-v[ids[0]],v[ids[2]]-v[ids[0]];area=a[0]*b[2]-a[2]*b[0]
   if area>=-1e-10:continue
   aa,bb=sv[ids[1]]-sv[ids[0]],sv[ids[2]]-sv[ids[0]];sm=min(np.linalg.norm(aa),np.linalg.norm(bb),np.linalg.norm(aa-bb));cm=min(np.linalg.norm(a),np.linalg.norm(b),np.linalg.norm(a-b));sourcearea=aa[0]*bb[2]-aa[2]*bb[0]
   R['cases'].append({'mesh':name,'state':'A7','amount':amount,'evaluatedTriangleIndex':ti,'vertexIDs':ids,'sourcePositions':sv[ids].tolist(),'currentPositions':v[ids].tolist(),'sourceMinEdge':float(sm),'currentMinEdge':float(cm),'sourceProjectedDoubleArea':float(sourcearea),'currentProjectedDoubleArea':float(area),'withinNarrowRule':bool(sm<1e-6 and cm<1e-6 and abs(area)<5e-10),'alreadyCoveredByGeneralCollapsedEdge2e7':bool(cm<=2e-7)})
  ev.to_mesh_clear()
R['rawNegativeHighlightTriangles']=len(R['cases']);R['allWithinNarrowRule']=all(r['withinNarrowRule'] for r in R['cases']);(P/'highlight-pole-exception.json').write_text(json.dumps(R,indent=2));print('POLE',R['rawNegativeHighlightTriangles'],R['allWithinNarrowRule'])
