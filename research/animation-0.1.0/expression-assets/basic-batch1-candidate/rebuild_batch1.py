import bpy,math,json,hashlib,sys
from pathlib import Path
from functools import lru_cache
from mathutils import Vector
from mathutils.bvhtree import BVHTree
ROOT=Path(__file__).resolve().parent
P=ROOT/'_rebuilt';P.mkdir(exist_ok=True)
sys.path.insert(0,str(ROOT))
from closed_mouth_transition import close_then_shape
BASE=ROOT/'_restored'
STATES=['D1','N2','P2'];KNOTS=[i/8 for i in range(1,9)]

def sd(x,z,a,b):
 dx=b[0]-a[0];dz=b[1]-a[1];t=max(0,min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz)));return math.hypot(x-a[0]-t*dx,z-a[1]-t*dz)
def radius(dx,dz,anchor,inside):
 lo=0.;hi=.5
 for _ in range(30):
  q=(lo+hi)/2
  if inside(anchor[0]+dx*q,anchor[1]+dz*q):lo=q
  else:hi=q
 return lo
@lru_cache(maxsize=100000)
def stroke_xy(which,u,v):
 if which=='P2':pts=[(.153*s,-.015+.033*(1-s*s)) for s in [-1+2*i/32 for i in range(33)]];r=.033;anchor=(0,.018)
 elif which=='mouthP2':pts=[(.084*math.sin(a),.802-.026*math.cos(a)) for a in [-math.pi/2+math.pi*i/32 for i in range(33)]];r=.018;anchor=(0,.776)
 elif which=='mouthPill':pts=[(-.038,.695),(.038,.695)];r=.023;anchor=(0,.695)
 elif which=='mouthN2':pts=[(.065*s,.695+.018*s+.012*(1-s*s)) for s in [-1+2*i/32 for i in range(33)]];r=.023;anchor=(0,.707)
 elif which=='browL':pts=[(-.387+.085*s,1.325+.042*s+.006*(1-s*s)) for s in [-1+2*i/16 for i in range(17)]];r=.026;anchor=(-.387,1.331)
 else:pts=[(.387+.090*s,1.255-.016*s-.018*(1-s*s)) for s in [-1+2*i/16 for i in range(17)]];r=.026;anchor=(.387,1.237)
 rho=min(1,math.hypot(u,v))
 if rho<1e-9:return anchor
 dx=u/math.hypot(u,v);dz=v/math.hypot(u,v);q=radius(dx,dz,anchor,lambda x,z:min(sd(x,z,a,b) for a,b in zip(pts[:-1],pts[1:]))<=r)
 return anchor[0]+rho*q*dx,anchor[1]+rho*q*dz

def eye_xz(st,side,x,z,t):
 cx=side*.387;cz=1.021;u=(x-cx)/.164;v=(z-cz)/.180;ss=math.sqrt(max(0,1-u*u));q=max(-1,min(1,v/ss)) if ss>1e-7 else 0
 if st in ['D1','N2']:
  lo=-.180*ss
  hi=.055*(ss**.40) if st=='D1' else (.180 if side<0 else .155)*ss
  nx=x;nz=cz+(hi+lo)/2+(hi-lo)/2*q
  return x*(1-t)+nx*t,z*(1-t)+nz*t
 # Rounded aperture closes along one shallow arch before reaching the round-ended stroke.
 phase=min(1,t/.625);k=phase*phase*(3-2*phase);anchor=(0,.018*k);rho=min(1,math.hypot(u,v))
 if rho<1e-9:return cx+anchor[0],cz+anchor[1]
 dx=u*(.164+(1-.164)*phase);dz=v*(.180+(1-.180)*phase);ll=math.hypot(dx,dz);dx/=ll;dz/=ll;w=.164*(1-k)+.153*k;h=.180*(1-k)+.033*k
 def inside(xx,zz):
  xx/=w
  if abs(xx)>1:return False
  mid=k*(-.015+.033*(1-xx*xx));return abs(zz-mid)<=h*math.sqrt(max(0,1-xx*xx))
 rad=radius(dx,dz,anchor,inside)
 if t>.625:
  blend=(t-.625)/.375;blend=blend*blend*(3-2*blend);xx,zz=stroke_xy('P2',dx,dz);rad=rad*(1-blend)+math.hypot(xx-anchor[0],zz-anchor[1])*blend
 return cx+rho*rad*dx,cz+anchor[1]+rho*rad*dz

def eye(st,side,x,y,z,t,highlight=False):
 cx=side*.387;cz=1.021
 if highlight and st=='P2':
  hx=cx-.05;hz=cz+.077;shrink=max(0,1-t/.625)**1.5;x=hx+(x-hx)*shrink;z=hz+(z-hz)*shrink
 u=(x-cx)/.164;v=(z-cz)/.180;nx,nz=eye_xz(st,side,x,z,t);dome=.013*((1-t)+t*(.17 if st=='P2' else .75));ny=front(nx,nz)-.0018-(.002*t if st=='P2' else 0)-dome*max(0,1-u*u-v*v)**1.3
 if highlight:
  rr=math.sqrt(((x-(cx-.05))/.041)**2+((z-(cz+.077))/.043)**2);ny-=.0010+.0007*math.sqrt(max(0,1-rr*rr))
 return Vector((nx,ny,nz))

def mouth(st,x,y,z,t):
 r=math.hypot(x,z-.695);a=math.atan2(z-.695,x);rr=max(0,min(1,(r-.026)/.023));u=math.cos(a);v=math.sin(a);rr=0. if rr<1e-4 else 1. if rr>1-1e-4 else rr
 if st in ['N2','P2']:
  gx,gz=stroke_xy('mouthN2' if st=='N2' else 'mouthP2',rr*u,rr*v)
  nx,nz=close_then_shape(rr,u,v,t,(gx,gz),stroke_xy('mouthPill',u,v))
  return Vector((nx,front(nx,nz)-.0025-.0015*math.sin(math.pi*rr),nz))
 if st=='D1':nx=.095*rr*u;nz=.695+.0215*rr*v
 elif st=='N2':nx,nz=stroke_xy('mouthN2',rr*u,rr*v)
 else:nx,nz=stroke_xy('mouthP2',rr*u,rr*v)
 nx=x*(1-t)+nx*t;nz=z*(1-t)+nz*t;ny=front(nx,nz)-.0025-.0015*math.sin(math.pi*rr);return Vector((nx,ny,nz))

def add_brows():
 out=[];rig=bpy.data.objects['A_Rig05'];mat=bpy.data.objects['A_eye_L'].data.materials[0]
 for side,label in [(-1,'L'),(1,'R')]:
  which='brow'+label;cx,cz=stroke_xy(which,0,0);centre=Vector((cx,front(cx,cz)-.0025,cz));uv=[(0.,0.)]
  for ring in range(1,5):
   for i in range(64):a=2*math.pi*i/64;uv.append((ring/4*math.cos(a),ring/4*math.sin(a)))
  faces=[(0,1+i,1+(i+1)%64) for i in range(64)]
  for ring in range(3):
   a=1+ring*64;b=a+64
   for i in range(64):j=(i+1)%64;faces.extend([(a+i,b+i,b+j),(a+i,b+j,a+j)])
  mesh=bpy.data.meshes.new('Batch1 brow '+label);mesh.from_pydata([centre]*len(uv),[],faces);mesh.update();o=bpy.data.objects.new('A_brow_'+label,mesh);bpy.context.collection.objects.link(o);o.parent=rig;o.data.materials.append(mat);vg=o.vertex_groups.new(name='Body');vg.add(list(range(len(uv))),1,'REPLACE');mod=o.modifiers.new('A05 linear skin','ARMATURE');mod.object=rig;o.shape_key_add(name='Basis')
  for poly in mesh.polygons:poly.use_smooth=True
  for st in STATES:
   for ki,t in enumerate(KNOTS,1):
    key=o.shape_key_add(name=f'Basic{st}_{ki:02}')
    for d,(u,v) in zip(key.data,uv):
     if st!='N2':d.co=centre;continue
     # Exact zero-area rest, gradual curve growth, projected final depth.
     xx,zz=stroke_xy(which,u,v);xx=cx+(xx-cx)*t;zz=cz+(zz-cz)*t;rho=math.hypot(u,v);yy=front(xx,zz)-.0025-.003*t*max(0,1-rho*rho);d.co=(xx,yy,zz)
    key.value=0
  o['layer']='bounded expression eyebrow, Body weighted; Basis zero-area';out.append(o)
 return out

def build_scene(source,output,export=False):
 global body
 bpy.ops.wm.open_mainfile(filepath=str(source))
 # Remove only this batch's derived targets/brows, preserving the full retained r6 source.
 for ob in list(bpy.data.objects):
  if ob.name.startswith('A_brow'):
   mesh=ob.data;bpy.data.objects.remove(ob,do_unlink=True);bpy.data.meshes.remove(mesh);continue
  if ob.type=='MESH' and ob.data.shape_keys:
   for key in list(ob.data.shape_keys.key_blocks)[::-1]:
    if key.name.startswith('Basic'):ob.shape_key_remove(key)
 skin=bpy.data.objects['A_mochi_skin'];body=BVHTree.FromObject(skin,bpy.context.evaluated_depsgraph_get());faces=[o for o in bpy.data.objects if o.name.startswith('A_eye') or o.name=='A_mouth_ring']
 for o in faces:
  side=-1 if o.name.endswith('_L') else 1
  for st in STATES:
   for ki,t in enumerate(KNOTS,1):
    key=o.shape_key_add(name=f'Basic{st}_{ki:02}')
    for v,d in zip(o.data.vertices,key.data):d.co=mouth(st,*v.co,t) if o.name=='A_mouth_ring' else eye(st,side,*v.co,t,'highlight' in o.name)
    key.value=0
 brows=add_brows();root=bpy.data.objects['A_reference_root'];root['new_basic_faces']='D1/N2/P2 candidate, source directions accepted,3D not approved';root['gaze_status']='not implemented'
 if export:
  bpy.ops.object.select_all(action='DESELECT')
  for o in [root,bpy.data.objects['A_Rig05'],skin]+faces+brows:o.select_set(True)
  bpy.context.view_layer.objects.active=root;bpy.ops.export_scene.gltf(filepath=str(P/'bubu-a05-basic-batch1.glb'),export_format='GLB',use_selection=True,export_yup=True,export_skins=True,export_morph=True,export_morph_normal=True,export_animations=False,export_extras=True,export_apply=False)
 bpy.ops.wm.save_as_mainfile(filepath=str(output))

def front(x,z):
 hit=body.ray_cast(Vector((x,-3,z)),Vector((0,1,0)),6)[0];assert hit is not None,(x,z);return hit.y
build_scene(BASE/'bubu-a05-basic-batch1.blend',P/'bubu-a05-basic-batch1.blend',True)
build_scene(BASE/'bubu-a05-basic-batch1-look.blend',P/'bubu-a05-basic-batch1-look.blend')
(P/'asset-manifest.json').write_text(json.dumps({'sourceR6SHA256':'fba41db41ecb0e0a959cd6923f55d5edbfaebf4558d79e1e9832b2a806cc5830','assetSHA256':hashlib.sha256((P/'bubu-a05-basic-batch1.glb').read_bytes()).hexdigest(),'newStates':STATES,'newTargetsPerState':8,'browMeshes':['A_brow_L','A_brow_R'],'status':'3D candidate awaiting visual and attachment gates; no runtime','bodyRestChanged':False,'historicalR6TargetsIntendedUnchanged':True},indent=2))
