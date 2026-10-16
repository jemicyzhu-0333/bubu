import bpy,sys
from pathlib import Path
O=Path(sys.argv[-1]).resolve()/'body'
for src,dst in [('approved05-original.blend','body-only.blend'),('approved05-original-look.blend','body-only-look.blend')]:
 bpy.ops.wm.open_mainfile(filepath=str(O/src))
 for o in list(bpy.data.objects):
  if o.name.startswith('A_eye') or o.name=='A_mouth_ring':bpy.data.objects.remove(o,do_unlink=True)
 bpy.ops.wm.save_as_mainfile(filepath=str(O/dst))
print('RESTORED exact-source body-only derivatives')
