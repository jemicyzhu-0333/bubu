import bpy,sys,json,hashlib,numpy as np
from pathlib import Path
P=Path(__file__).resolve().parent;sys.path.insert(0,str(P));from face_library import STATES,ROSTER,names,apply_blender
bpy.ops.wm.open_mainfile(filepath=str(P/'bubu-expression-library-v1-look.blend'))
def verts(o):
 e=o.evaluated_get(bpy.context.evaluated_depsgraph_get());x=np.empty(len(e.data.vertices)*3,dtype='<f4');e.data.vertices.foreach_get('co',x);return x
apply_blender(None,0);baseline={n:verts(bpy.data.objects[n]).copy() for n in (*ROSTER,'A_mochi_skin')};rows=[]
for st in STATES:
 apply_blender('N3',1);apply_blender(st,1)
 active={n:[k.name for k in bpy.data.objects[n].data.shape_keys.key_blocks if k.name!='Basis' and k.value!=0] for n in ROSTER}
 assert all(v==[names(st)[-1]] for v in active.values())
 assert verts(bpy.data.objects['A_mochi_skin']).tobytes()==baseline['A_mochi_skin'].tobytes()
 apply_blender(None,0);rest={n:verts(bpy.data.objects[n]).tobytes()==baseline[n].tobytes() for n in ROSTER};assert all(rest.values())
 rows.append({'from':'N3','to':st,'allLayersOnlySelectedTarget':True,'bodyUnchanged':True,'returnToBasisBitExact':rest})
r={'lookSHA256':hashlib.sha256((P/'bubu-expression-library-v1-look.blend').read_bytes()).hexdigest(),'sequence':'N3 full -> each of18 current states full -> all-layer Basis','rows':rows,'passed':True};(P/'BLENDER-RESET-AUDIT.json').write_text(json.dumps(r,indent=2));print('ACTUAL_BLENDER_RESET_PASSED')
