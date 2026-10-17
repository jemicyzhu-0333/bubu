import bpy,sys,json,argparse
from pathlib import Path
P=Path(__file__).resolve().parents[1];ap=argparse.ArgumentParser();ap.add_argument('--body',required=True);ap.add_argument('--mapper',required=True);a=ap.parse_args(sys.argv[sys.argv.index('--')+1:]);sys.path.insert(0,str(Path(a.mapper).parent));from face_library import STATES,apply_blender
bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=a.body);result=[]
for state in STATES:
 apply_blender(state,1);bpy.context.view_layer.update();dg=bpy.context.evaluated_depsgraph_get();maxz=-999
 for name in ['A_eye_L','A_eye_R','A_brow_L','A_brow_R','A_eye_highlight_L','A_eye_highlight_R']:
  o=bpy.data.objects[name].evaluated_get(dg);m=o.to_mesh()
  if len(m.vertices):maxz=max(maxz,max((o.matrix_world@v.co).z for v in m.vertices))
  o.to_mesh_clear()
 result.append({'state':state,'maxFaceFeatureZ':maxz,'conservativeBrimMinZ':1.432,'verticalClearance':1.432-maxz})
(P/'review/all18-face-clearance.json').write_text(json.dumps(result,indent=2));print('MIN_CLEARANCE',min(r['verticalClearance'] for r in result));print(result)
assert all(r['verticalClearance']>0 for r in result)
