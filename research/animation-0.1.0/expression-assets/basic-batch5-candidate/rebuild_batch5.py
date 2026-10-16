import bpy, math, json, hashlib, sys
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
ROOT=Path(__file__).resolve().parent
P=ROOT/'_rebuilt';P.mkdir(exist_ok=True)
sys.path.insert(0,str(ROOT))
from closed_mouth_transition import close_then_shape
from closed_mouth_boundary import rounded_pill_boundary
from round_stroke_geometry import swept_capsule
BASE=ROOT/'_restored'
STATES=['T5','S3','S5']; KNOTS=[i/8 for i in range(1,9)]
def ease(t):
 t=max(0,min(1,t)); return t*t*(3-2*t)
def front(x,z):
 hit=body.ray_cast(Vector((x,-3,z)),Vector((0,1,0)),6)[0]; assert hit is not None,(x,z); return hit.y

def custom_stroke(u,v,width,r,cz,kind,side=1):
 u=max(-1,min(1,u));ss=math.sqrt(max(0,1-u*u));q=max(-1,min(1,v/ss)) if ss>1e-9 else 0
 L=width-r;x=width*u;s=max(-L,min(L,x));extra=x-s
 if kind=='double':z=cz-.008*math.cos(2*math.pi*s/L);slope=.008*2*math.pi/L*math.sin(2*math.pi*s/L)
 else:z=cz-side*.45*s-.009*(1-(s/L)**2);slope=-side*.45+2*.009*s/(L*L)
 n=math.sqrt(1+slope*slope);h=math.sqrt(max(0,r*r-extra*extra))*q
 return s+extra/n-h*slope/n,z+extra*slope/n+h/n

def eye_xz(st,side,x,z,t):
 cx=side*.387;cz=1.021;u=max(-1,min(1,(x-cx)/.164));v=(z-cz)/.180;ss=math.sqrt(max(0,1-u*u));q=max(-1,min(1,v/ss)) if ss>1e-9 else 0
 if st in ['S3','S5']:
  lo=-.180*ss+(.020*ss**3 if st=='S3' else 0)
  hi=.180*ss if st=='S3' else (.105-side*.050*u)*ss**.30
  nz=cz+(hi+lo)/2+(hi-lo)/2*q;k=ease(t);return x,z*(1-k)+nz*k
 phase=min(1,t/.625);k=ease(phase);w=.164*(1-k)+.172*k;cap=math.sqrt(max(0,.031**2-max(0,abs(.172*u)-.141)**2));h=.180*ss*(1-k)+cap*k
 nx=cx+w*u;nz=cz-.043*k+h*q
 if t>.625:
  a=ease((t-.625)/.375);xx,zz=swept_capsule(u,v,.172,.031,-.108,.020);nx=nx*(1-a)+(cx+xx)*a;nz=nz*(1-a)+(cz+zz)*a
 return nx,nz

def eye(st,side,x,y,z,t,highlight=False):
 cx=side*.387;cz=1.021
 if highlight and st=='T5':
  hx=cx-.05;hz=cz+.077;shrink=max(0,1-t/.625)**1.5;x=hx+(x-hx)*shrink;z=hz+(z-hz)*shrink
 u=(x-cx)/.164;v=(z-cz)/.180;nx,nz=eye_xz(st,side,x,z,t);k=ease(t);dome=.013*((1-k)+k*(.17 if st=='T5' else .75));ny=front(nx,nz)-.0018-(.002*k if st=='T5' else 0)-dome*max(0,1-u*u-v*v)**1.3
 if highlight:
  rr=math.sqrt(((x-(cx-.05))/.041)**2+((z-(cz+.077))/.043)**2);ny-=.0010+.0007*math.sqrt(max(0,1-rr*rr))
 return Vector((nx,ny,nz))

def mouth(st,x,y,z,t):
 r=math.hypot(x,z-.695);a=math.atan2(z-.695,x);rr=max(0,min(1,(r-.026)/.023));rr=0. if rr<1e-4 else 1. if rr>1-1e-4 else rr;u=math.cos(a);v=math.sin(a)
 if st=='S3':endpoint=custom_stroke(rr*u,rr*v,.116,.021,.715,'double')
 else:
  args=(.120,.023,-.023,.063) if st=='T5' else (.092,.020,-.020,.055);xx,zz=swept_capsule(rr*u,-rr*v,*args);endpoint=(xx,(.770 if st=='T5' else .760)-zz)
 pill=rounded_pill_boundary(u,v);nx,nz=close_then_shape(rr,u,v,t,endpoint,pill);ny=front(nx,nz)-.0025-.0015*math.sin(math.pi*rr);return Vector((nx,ny,nz))

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
 out=[];rig=bpy.data.objects['A_Rig05'];mat=bpy.data.objects['A_eye_L'].data.materials[0]
 for side,label in [(-1,'L'),(1,'R')]:
  cx=side*.387;cz=1.331 if side<0 else 1.237;centre=Vector((cx,front(cx,cz)-.0025,cz));uv,fs=disk_topology();me=bpy.data.meshes.new('Batch1 brow '+label);me.from_pydata([centre]*len(uv),[],fs);me.update();o=bpy.data.objects.new('A_brow_'+label,me);bpy.context.collection.objects.link(o);o.parent=rig;o.data.materials.append(mat);vg=o.vertex_groups.new(name='Body');vg.add(list(range(len(uv))),1,'REPLACE');mod=o.modifiers.new('A05 linear skin','ARMATURE');mod.object=rig;o.shape_key_add(name='Basis')
  for poly in me.polygons:poly.use_smooth=True
  for st in STATES:
   for ki,t in enumerate(KNOTS,1):
    key=o.shape_key_add(name=f'Basic{st}_{ki:02}');grow=ease((t-.125)/.875)
    for d,(u,v) in zip(key.data,uv):
     if st=='T5':d.co=centre;continue
     xx,zz=custom_stroke(u,v,.063,.019,1.280,'brow',side);xx=cx+xx*grow;zz=1.280+(zz-1.280)*grow;rho=math.hypot(u,v);d.co=(xx,front(xx,zz)-.0025-.003*grow*max(0,1-rho*rho),zz)
    key.value=0
  o['layer']='Shared batch1 hidden Basis; S3/S5 symmetric worry brow arcs; all inactive face states clear this layer';out.append(o)
 return out

def build_scene(source,output,export=False):
 global body
 bpy.ops.wm.open_mainfile(filepath=str(source))
 for name in ['A_brow_L','A_brow_R']:
  old=bpy.data.objects.get(name)
  if old:
   data=old.data;bpy.data.objects.remove(old,do_unlink=True)
   if data.users==0:bpy.data.meshes.remove(data)
 for ob in bpy.data.objects:
  if ob.type=='MESH' and ob.data.shape_keys:
   for key in list(ob.data.shape_keys.key_blocks)[::-1]:
    if any(key.name.startswith('Basic'+st+'_') for st in STATES):ob.shape_key_remove(key)
  skin=bpy.data.objects['A_mochi_skin']; body=BVHTree.FromObject(skin,bpy.context.evaluated_depsgraph_get()); faces=[o for o in bpy.data.objects if o.name.startswith('A_eye') or o.name=='A_mouth_ring']
 for o in faces:
  side=-1 if o.name.endswith('_L') else 1
  for st in STATES:
   for ki,t in enumerate(KNOTS,1):
    key=o.shape_key_add(name=f'Basic{st}_{ki:02}')
    for v,d in zip(o.data.vertices,key.data):d.co=mouth(st,*v.co,t) if o.name=='A_mouth_ring' else eye(st,side,*v.co,t,'highlight' in o.name)
    key.value=0
 brows=add_brows(); root=bpy.data.objects['A_reference_root']; root['new_basic_faces']='T5/S3/S5 reference-based static candidate; closed/open sadness states plus worry'; root['gaze_status']='not implemented'; bpy.context.view_layer.update()
 if export:
  bpy.ops.object.select_all(action='DESELECT')
  for o in [root,bpy.data.objects['A_Rig05'],skin]+faces+brows:o.select_set(True)
  bpy.context.view_layer.objects.active=root; bpy.ops.export_scene.gltf(filepath=str(P/'bubu-a05-basic-batch5.glb'),export_format='GLB',use_selection=True,export_yup=True,export_skins=True,export_morph=True,export_morph_normal=True,export_animations=False,export_extras=True,export_apply=False)
 bpy.ops.wm.save_as_mainfile(filepath=str(output))
build_scene(BASE/'bubu-a05-basic-batch5.blend',P/'bubu-a05-basic-batch5.blend',True)
build_scene(BASE/'bubu-a05-basic-batch5-look.blend',P/'bubu-a05-basic-batch5-look.blend')
(P/'asset-manifest.json').write_text(json.dumps({'sourceR6SHA256':'fba41db41ecb0e0a959cd6923f55d5edbfaebf4558d79e1e9832b2a806cc5830','assetSHA256':hashlib.sha256((P/'bubu-a05-basic-batch5.glb').read_bytes()).hexdigest(),'newStates':STATES,'newTargetsPerState':8,'newLayers':['A_brow_L','A_brow_R'],'status':'candidate awaiting static review; no runtime','bodyRestChanged':False},indent=2))
