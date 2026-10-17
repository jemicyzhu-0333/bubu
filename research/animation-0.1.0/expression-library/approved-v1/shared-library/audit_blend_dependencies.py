import bpy,json,hashlib
from pathlib import Path
P=Path(__file__).resolve().parent;f=P/'bubu-expression-library-v1-look.blend';bpy.ops.wm.open_mainfile(filepath=str(f))
libraries=[x.filepath for x in bpy.data.libraries];images=[{'name':x.name,'source':x.source,'filepath':x.filepath,'packed':bool(x.packed_file)} for x in bpy.data.images if x.source=='FILE' and x.users>0];missing=[x for x in images if not x['packed']];assert not libraries and not missing
r={'lookSHA256':hashlib.sha256(f.read_bytes()).hexdigest(),'linkedLibraries':libraries,'usedFileImages':images,'externalRequiredResources':missing,'passed':True};(P/'BLEND-DEPENDENCY-AUDIT.json').write_text(json.dumps(r,indent=2));print('SELF_CONTAINED_LOOK_PASS')
