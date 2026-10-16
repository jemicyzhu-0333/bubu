"""Reconstruct omitted look/body-only derivatives from retained editable sources."""
import bpy,json,sys
from pathlib import Path
P=Path(sys.argv[-3]).resolve();O=Path(sys.argv[-2]).resolve();kind=sys.argv[-1]
folder=O/kind;name='approved05-original' if kind=='body' else 'bubu-a05-selected-faces'
bpy.ops.wm.open_mainfile(filepath=str(folder/(name+'.blend')))
s=bpy.context.scene
if kind=='body':
 for o in list(bpy.data.objects):
  if o.name.startswith('A_eye') or o.name=='A_mouth_ring':bpy.data.objects.remove(o,do_unlink=True)
 bpy.ops.wm.save_as_mainfile(filepath=str(folder/'body-only.blend'))
 bpy.ops.wm.open_mainfile(filepath=str(folder/(name+'.blend')));s=bpy.context.scene
conf=json.loads((P/('body/look-settings.json' if kind=='body' else 'look/look-settings.json')).read_text())
with bpy.data.libraries.load(str(P/'look/look-environment.blend'),link=False) as (src,dst):
 dst.objects=conf['objects'];dst.worlds=[conf['world']]
for o in dst.objects:
 if o is not None:s.collection.objects.link(o)
s.world=dst.worlds[0];s.camera=next(o for o in dst.objects if o.type=='CAMERA')
for key in ['render','cycles','view_settings','display_settings','image_settings']:
 ob=s.render.image_settings if key=='image_settings' else getattr(s,key)
 for k,v in conf[key].items():setattr(ob,k,v)
bpy.ops.wm.save_as_mainfile(filepath=str(folder/(name+'-look.blend')))
if kind=='body':
 for o in list(bpy.data.objects):
  if o.name.startswith('A_eye') or o.name=='A_mouth_ring':bpy.data.objects.remove(o,do_unlink=True)
 bpy.ops.wm.save_as_mainfile(filepath=str(folder/'body-only-look.blend'))
print('RESTORED',kind)
