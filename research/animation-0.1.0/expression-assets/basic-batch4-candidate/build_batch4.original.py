import bpy, math, json, hashlib, sys
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
P=Path(__file__).resolve().parent; sys.path.insert(0,str(P))
from closed_mouth_transition import close_then_shape
from closed_mouth_boundary import rounded_pill_boundary
from round_stroke_geometry import swept_capsule
BASE=P.parent/'bubu-3d-a-face-coordinate-v2-20261016/candidate-a05-selected-faces-r6-review'
STATES=['A4','A8','D4']; KNOTS=[i/8 for i in range(1,9)]
def ease(t):
 t=max(0,min(1,t)); return t*t*(3-2*t)
def front(x,z):
 hit=body.ray_cast(Vector((x,-3,z)),Vector((0,1,0)),6)[0]; assert hit is not None,(x,z); return hit.y

def wave_stroke(u,v,width=.170,r=.021,cz=.695,amp=.035):
 # Tangent/normal capsule sweep: preserves round caps and normal stroke width.
 u=max(-1,min(1,u)); ss=math.sqrt(max(0,1-u*u)); q=max(-1,min(1,v/ss)) if ss>1e-9 else 0
 L=width-r; x=width*u; s=max(-L,min(L,x)); extra=x-s
 z=cz-amp*math.sin(math.pi*s/L); slope=-amp*math.pi/L*math.cos(math.pi*s/L); n=math.sqrt(1+slope*slope)
 h=math.sqrt(max(0,r*r-extra*extra))*q
 return s+extra/n-h*slope/n,z+extra*slope/n+h/n

def eye_xz(st,side,x,z,t):
 cx=side*.387; cz=1.021; u=max(-1,min(1,(x-cx)/.164)); v=(z-cz)/.180; ss=math.sqrt(max(0,1-u*u)); q=max(-1,min(1,v/ss)) if ss>1e-9 else 0
 if st in ['A4','A8']:
  lo=-.180*ss
  hi=.055*ss**.40 if st=='A4' else (.085-.055*(1-u*u))*ss**.40
  nz=cz+(hi+lo)/2+(hi-lo)/2*q; k=ease(t)
  return x,z*(1-k)+nz*k
 # Yawn: simple narrow closed aperture, no deep U sleep curve and no eye tail.
 k=ease(min(1,t/.625)); w=.164*(1-k)+.156*k; h=.180*(1-k)+.026*k
 nx,nz=cx+w*u,cz-.018*k+h*v
 if t>.625:
  a=ease((t-.625)/.375);xx,zz=swept_capsule(u,v,.156,.023,-.043,.011);nx=nx*(1-a)+(cx+xx)*a;nz=nz*(1-a)+(cz+zz)*a
 return nx,nz

def eye(st,side,x,y,z,t,highlight=False):
 cx=side*.387; cz=1.021
 if highlight and st=='D4':
  hx=cx-.05; hz=cz+.077; shrink=max(0,1-t/.625)**1.5; x=hx+(x-hx)*shrink; z=hz+(z-hz)*shrink
 u=(x-cx)/.164; v=(z-cz)/.180; nx,nz=eye_xz(st,side,x,z,t)
 k=ease(t); dome=.013*((1-k)+k*(.17 if st=='D4' else .75)); ny=front(nx,nz)-.0018-(.002*k if st=='D4' else 0)-dome*max(0,1-u*u-v*v)**1.3
 if highlight:
  rr=math.sqrt(((x-(cx-.05))/.041)**2+((z-(cz+.077))/.043)**2); ny-=.0010+.0007*math.sqrt(max(0,1-rr*rr))
 return Vector((nx,ny,nz))

def mouth(st,x,y,z,t):
 r=math.hypot(x,z-.695); a=math.atan2(z-.695,x); rr=max(0,min(1,(r-.026)/.023)); rr=0. if rr<1e-4 else 1. if rr>1-1e-4 else rr; u=math.cos(a); v=math.sin(a)
 if st in ['A4','A8']:
  endpoint=swept_capsule(rr*u,rr*v,.095,.020,.675,.715) if st=='A4' else wave_stroke(rr*u,rr*v)
  pill=rounded_pill_boundary(u,v)
  nx,nz=close_then_shape(rr,u,v,t,endpoint,pill)
 else:
  k=ease(t); w=.049+.010*k; h=.049+.060*k; cz=.695+.065*k; inner=.026*(1-ease(t/.375)); f=inner+(1-inner)*rr
  # Original normalized radial .049 boundary becomes a narrow filled oval;
  # the inner O boundary closes first, without ring-to-stroke bending.
  nr=(.026*(1-ease(t/.375)))/.049; rho=nr+(1-nr)*rr
  nx=w*rho*u; nz=cz+h*rho*v
 ny=front(nx,nz)-.0025-.0015*math.sin(math.pi*rr)
 return Vector((nx,ny,nz))

def disk_topology():
 uv=[(0.,0.)]
 for ring in range(1,5):
  for i in range(64):
   a=2*math.pi*i/64; uv.append((ring/4*math.cos(a),ring/4*math.sin(a)))
 fs=[(0,1+i,1+(i+1)%64) for i in range(64)]
 for ring in range(3):
  a=1+ring*64; b=a+64
  for i in range(64):
   j=(i+1)%64; fs.extend([(a+i,b+i,b+j),(a+i,b+j,a+j)])
 return uv,fs

def add_brows():
 out=[]; rig=bpy.data.objects['A_Rig05']; mat=bpy.data.objects['A_eye_L'].data.materials[0]
 for side,label in [(-1,'L'),(1,'R')]:
  cx=side*.387; cz=1.331 if side<0 else 1.237; centre=Vector((cx,front(cx,cz)-.0025,cz)); uv,fs=disk_topology()
  me=bpy.data.meshes.new('Batch1 brow '+label); me.from_pydata([centre]*len(uv),[],fs); me.update(); o=bpy.data.objects.new('A_brow_'+label,me); bpy.context.collection.objects.link(o); o.parent=rig; o.data.materials.append(mat); vg=o.vertex_groups.new(name='Body'); vg.add(list(range(len(uv))),1,'REPLACE'); mod=o.modifiers.new('A05 linear skin','ARMATURE'); mod.object=rig; o.shape_key_add(name='Basis')
  for poly in me.polygons:poly.use_smooth=True
  for st in STATES:
   for ki,t in enumerate(KNOTS,1):
    key=o.shape_key_add(name=f'Basic{st}_{ki:02}'); grow=ease((t-.5)/.5)
    for d,(u,v) in zip(key.data,uv):
     if st!='A4':d.co=centre; continue
     xx,zz=swept_capsule(u,v,.175,.019,-.019,.019); xx=cx+xx*grow; zz=1.172+zz*grow; rho=math.hypot(u,v); d.co=(xx,front(xx,zz)-.0025-.003*grow*max(0,1-rho*rho),zz)
    key.value=0
  o['layer']='Shared batch1 hidden Basis; A4-only brow, grows only after upper lid is lowered; all other states remain zero area'; out.append(o)
 return out

def build_scene(source,output,export=False):
 global body
 bpy.ops.wm.open_mainfile(filepath=str(source)); skin=bpy.data.objects['A_mochi_skin']; body=BVHTree.FromObject(skin,bpy.context.evaluated_depsgraph_get()); faces=[o for o in bpy.data.objects if o.name.startswith('A_eye') or o.name=='A_mouth_ring']
 for o in faces:
  side=-1 if o.name.endswith('_L') else 1
  for st in STATES:
   for ki,t in enumerate(KNOTS,1):
    key=o.shape_key_add(name=f'Basic{st}_{ki:02}')
    for v,d in zip(o.data.vertices,key.data):d.co=mouth(st,*v.co,t) if o.name=='A_mouth_ring' else eye(st,side,*v.co,t,'highlight' in o.name)
    key.value=0
 brows=add_brows(); root=bpy.data.objects['A_reference_root']; root['new_basic_faces']='A4/A8/D4 reference-based static candidate; D4 yawn transition only'; root['gaze_status']='not implemented'; bpy.context.view_layer.update()
 if export:
  bpy.ops.object.select_all(action='DESELECT')
  for o in [root,bpy.data.objects['A_Rig05'],skin]+faces+brows:o.select_set(True)
  bpy.context.view_layer.objects.active=root; bpy.ops.export_scene.gltf(filepath=str(P/'bubu-a05-basic-batch4.glb'),export_format='GLB',use_selection=True,export_yup=True,export_skins=True,export_morph=True,export_morph_normal=True,export_animations=False,export_extras=True,export_apply=False)
 bpy.ops.wm.save_as_mainfile(filepath=str(output))
build_scene(BASE/'bubu-a05-selected-faces.blend',P/'bubu-a05-basic-batch4.blend',True)
build_scene(BASE/'bubu-a05-selected-faces-look.blend',P/'bubu-a05-basic-batch4-look.blend')
(P/'asset-manifest.json').write_text(json.dumps({'sourceR6SHA256':hashlib.sha256((BASE/'bubu-a05-selected-faces.glb').read_bytes()).hexdigest(),'assetSHA256':hashlib.sha256((P/'bubu-a05-basic-batch4.glb').read_bytes()).hexdigest(),'newStates':STATES,'newTargetsPerState':8,'newLayers':['A_brow_L','A_brow_R'],'status':'candidate awaiting static review; no runtime','bodyRestChanged':False},indent=2))
