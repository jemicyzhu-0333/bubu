import argparse,sys
p=argparse.ArgumentParser()
for k in ['repo-root','reference-root','cache-root']:p.add_argument('--'+k,required=True)
a=p.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else sys.argv[1:])
from pathlib import Path
import bpy
from mathutils import Vector
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(Path(a.reference_root)/'research/animation-0.1.0/original-parts-hybrid-v1/geometry/bubu-hybrid-binding.glb'))
for o in bpy.context.scene.objects:
 if o.type=='MESH':
  cs=[o.matrix_world@Vector(v) for v in o.bound_box];print('MESH',o.name, tuple(o.location), 'CENTER',tuple(sum(v[i] for v in cs)/8 for i in range(3)), 'BOUNDS',[(min(v[i] for v in cs),max(v[i] for v in cs)) for i in range(3)])
