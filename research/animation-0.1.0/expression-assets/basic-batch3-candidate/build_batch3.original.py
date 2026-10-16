import bpy,math,json,hashlib,sys
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
P=Path(__file__).resolve().parent;sys.path.insert(0,str(P))
from round_stroke_geometry import swept_capsule
BASE=P.parent/'bubu-3d-a-face-coordinate-v2-20261016/candidate-a05-selected-faces-r6-review'
STATES=['N3','T05'];KNOTS=[i/8 for i in range(1,9)]
def ease(t):t=max(0,min(1,t));return t*t*(3-2*t)
def front(x,z):
 hit=body.ray_cast(Vector((x,-3,z)),Vector((0,1,0)),6)[0];assert hit is not None,(x,z);return hit.y
def capsule_radius(dx,dz,halfwidth,rad):
 lo=0.;hi=halfwidth+rad;L=halfwidth-rad
 for _ in range(35):
  r=(lo+hi)/2;x=r*dx;z=r*dz
  if max(0,abs(x)-L)**2+z*z<=rad*rad:lo=r
  else:hi=r
 return lo

def mouth(st,x,y,z,t):
 r=math.hypot(x,z-.695);a=math.atan2(z-.695,x);rr=max(0,min(1,(r-.026)/.023));u=math.cos(a);v=math.sin(a);rr=0. if rr<1e-4 else 1. if rr>1-1e-4 else rr
 if st=='T05':
  ri=capsule_radius(u,v,.080,.025);ro=capsule_radius(u,v,.118,.055);rho=ri+(ro-ri)*rr;nx=x*(1-t)+rho*u*t;nz=z*(1-t)+(.695+rho*v)*t
 else:
  k=ease(t);inner=.026*(1-ease(t/.375));w=.049+(.140-.049)*k;h=.049+(.157-.049)*k;cz=.695-.018*k
  nx=(inner*(1-rr)+w*rr)*u;nz=cz+(inner*(1-rr)+h*rr)*v
 ny=front(nx,nz)-.0025-.0015*math.sin(math.pi*rr)
 if st=='N3':ny-=.004*ease((rr-.88)/.12)*ease(t) # raised black outer lip occludes tongue at grazing views
 return Vector((nx,ny,nz))

def disk_topology():
 uv=[(0.,0.)]
 for ring in range(1,5):
  for i in range(64):a=2*math.pi*i/64;uv.append((ring/4*math.cos(a),ring/4*math.sin(a)))
 fs=[(0,1+i,1+(i+1)%64) for i in range(64)]
 for ring in range(3):
  a=1+ring*64;b=a+64
  for i in range(64):j=(i+1)%64;fs.extend([(a+i,b+i,b+j),(a+i,b+j,a+j)])
 return uv,fs

def layer(name,meshname,centre,mat):
 uv,fs=disk_topology();me=bpy.data.meshes.new(meshname);me.from_pydata([centre]*len(uv),[],fs);me.update();o=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(o);o.parent=bpy.data.objects['A_Rig05'];o.data.materials.append(mat);vg=o.vertex_groups.new(name='Body');vg.add(list(range(len(uv))),1,'REPLACE');mod=o.modifiers.new('A05 linear skin','ARMATURE');mod.object=bpy.data.objects['A_Rig05'];o.shape_key_add(name='Basis')
 for poly in me.polygons:poly.use_smooth=True
 return o,uv

def add_brows():
 out=[];mat=bpy.data.objects['A_eye_L'].data.materials[0]
 for side,label in [(-1,'L'),(1,'R')]:
  # Exact same hidden Basis/topology as frozen batch1's reusable brow layer.
  cx=side*.387;cz=1.331 if side<0 else 1.237;basis=Vector((cx,front(cx,cz)-.0025,cz));o,uv=layer('A_brow_'+label,'Batch1 brow '+label,basis,mat)
  for st in STATES:
   for ki,t in enumerate(KNOTS,1):
    key=o.shape_key_add(name=f'Basic{st}_{ki:02}');grow=ease((t-.125)/.875)
    for d,(u,v) in zip(key.data,uv):
     if st!='N3':d.co=basis;continue
     x,z=swept_capsule(u,v,.096,.0205,-.0205,.0425);tx=side*.405+x;tz=1.310-z-side*.020*x/.096
     xx=side*.405+(tx-side*.405)*grow;zz=1.310+(tz-1.310)*grow;rho=math.hypot(u,v);d.co=(xx,front(xx,zz)-.0025-.003*grow*max(0,1-rho*rho),zz)
    key.value=0
  o['layer']='shared bounded eyebrow; Body100; Basis zero area; first hidden knot relocates invisible centre before visible growth';out.append(o)
 return out

def add_tongue():
 mat=bpy.data.materials.new('N3 inner soft tongue');mat.use_nodes=True;n=mat.node_tree.nodes.get('Principled BSDF');n.inputs['Base Color'].default_value=(.77,.235,.22,1);n.inputs['Roughness'].default_value=.87
 basis=Vector((0,front(0,.695)-.0025,.695));o,uv=layer('A_tongue','N3 bounded inner tongue',basis,mat);mouth_o=bpy.data.objects['A_mouth_ring']
 for st in STATES:
  for ki,t in enumerate(KNOTS,1):
   key=o.shape_key_add(name=f'Basic{st}_{ki:02}')
   if st!='N3':
    for d in key.data:d.co=basis
    continue
   # Black mouth is already fully closed internally by .375. Tongue appears
   # only after .5, with its entire ellipse inside that actual black surface.
   for k in mouth_o.data.shape_keys.key_blocks:
    if k.name!='Basis':k.value=1 if k.name==f'Basic{st}_{ki:02}' else 0
   bpy.context.view_layer.update();mbvh=BVHTree.FromObject(mouth_o,bpy.context.evaluated_depsgraph_get());k=ease(t);w=.049+.091*k;h=.049+.108*k;cz=.695-.018*k;vis=ease((t-.5)/.5);tc=cz-.57*h
   for d,(u,v) in zip(key.data,uv):
    xx=.090*(w/.140)*vis*u;zz=tc+.040*(h/.157)*vis*v
    hit=mbvh.ray_cast(Vector((xx,-3,zz)),Vector((0,1,0)),6)[0]
    if hit is None:
     # Before black-hole closure, the zero-area tongue may sit behind skin.
     assert vis==0,(t,xx,zz);yy=front(xx,zz)+.002
    else:yy=hit.y-.0006-.0003*vis*max(0,1-u*u-v*v)
    d.co=(xx,yy,zz)
   key.value=0
 for k in mouth_o.data.shape_keys.key_blocks:
  if k.name!='Basis':k.value=0
 o['layer']='N3 inner-mouth colour surface; Body100, zero-area Basis/non-N3; aperture-bounded, actual mouth-depth projection; not an external tongue';return o

def build_scene(source,output,export=False):
 global body
 bpy.ops.wm.open_mainfile(filepath=str(source));skin=bpy.data.objects['A_mochi_skin'];body=BVHTree.FromObject(skin,bpy.context.evaluated_depsgraph_get());faces=[o for o in bpy.data.objects if o.name.startswith('A_eye') or o.name=='A_mouth_ring']
 for o in faces:
  for st in STATES:
   for ki,t in enumerate(KNOTS,1):
    key=o.shape_key_add(name=f'Basic{st}_{ki:02}')
    for v,d in zip(o.data.vertices,key.data):d.co=mouth(st,*v.co,t) if o.name=='A_mouth_ring' else v.co
    key.value=0
 extras=add_brows()+[add_tongue()];root=bpy.data.objects['A_reference_root'];root['new_basic_faces']='N3 / T05 revised05 from user-approved master02; candidate only';root['gaze_status']='not implemented'
 bpy.context.view_layer.update()
 if export:
  bpy.ops.object.select_all(action='DESELECT')
  for o in [root,bpy.data.objects['A_Rig05'],skin]+faces+extras:o.select_set(True)
  bpy.context.view_layer.objects.active=root;bpy.ops.export_scene.gltf(filepath=str(P/'bubu-a05-basic-batch3.glb'),export_format='GLB',use_selection=True,export_yup=True,export_skins=True,export_morph=True,export_morph_normal=True,export_animations=False,export_extras=True,export_apply=False)
 bpy.ops.wm.save_as_mainfile(filepath=str(output))
build_scene(BASE/'bubu-a05-selected-faces.blend',P/'bubu-a05-basic-batch3.blend',True)
build_scene(BASE/'bubu-a05-selected-faces-look.blend',P/'bubu-a05-basic-batch3-look.blend')
(P/'asset-manifest.json').write_text(json.dumps({'sourceR6SHA256':hashlib.sha256((BASE/'bubu-a05-selected-faces.glb').read_bytes()).hexdigest(),'assetSHA256':hashlib.sha256((P/'bubu-a05-basic-batch3.glb').read_bytes()).hexdigest(),'newStates':STATES,'newTargetsPerState':8,'newLayers':['A_brow_L','A_brow_R','A_tongue'],'status':'candidate awaiting static shape/attachment review; no runtime','bodyRestChanged':False,'historicalR6TargetsIntendedUnchanged':True},indent=2))
