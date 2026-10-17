"""Hollow reference-driven straw hat; no body edits, procedural UV texture."""
import bpy,bmesh,math,json
from pathlib import Path
P=Path(__file__).resolve().parents[1]
BASE=1.43;RX=.785;RY=.615;H=.62;TH=.026;N=96

def mat(name,color):
 m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True;b=m.node_tree.nodes.get('Principled BSDF');b.inputs['Base Color'].default_value=(*color,1);b.inputs['Roughness'].default_value=.8;return m

def mesh(name,verts,faces,material):
 d=bpy.data.meshes.new(name);d.from_pydata(verts,[],faces);d.update();o=bpy.data.objects.new(name,d);bpy.context.collection.objects.link(o);d.materials.append(material)
 for f in d.polygons:f.use_smooth=True
 return o

def build():
 straw=mat('warm wheat woven straw',(.63,.405,.14));band=mat('matte warm brown ribbon',(.24,.095,.038))
 # Embedded deterministic fine woven color texture; glTF-compatible.
 image=bpy.data.images.new('woven-wheat',width=256,height=256,alpha=True);pixels=[]
 for y in range(256):
  for x in range(256):
   u=(x%32)/32;v=(y%32)/32;row=y//32;col=x//32;vertical=(row+col)%2==0
   cross=u if vertical else v;along=v if vertical else u
   groove=.12*math.exp(-((cross-.05)/.055)**2)+.07*math.exp(-((cross-.95)/.045)**2)
   rib=.035*math.cos(cross*math.pi*8)+.015*math.cos(along*math.pi*12)
   factor=1-groove+rib
   pixels.extend([min(1,c*factor) for c in (.88,.73,.48)]+[1])
 image.pixels=pixels;image.filepath_raw=str(P/'woven-wheat.png');image.file_format='PNG';image.save();image.pack();tex=straw.node_tree.nodes.new('ShaderNodeTexImage');tex.image=image;straw.node_tree.links.new(tex.outputs['Color'],straw.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
 # Open bottom double shell: shape clears original two top points.
 vs=[];fs=[];R=32
 for inner in [0,1]:
  for j in range(R+1):
   theta=(math.pi/2)*j/R
   for i in range(N):
    a=i*2*math.pi/N;r=math.cos(theta);vs.append(((RX-inner*TH)*r*math.cos(a),(RY-inner*TH)*r*math.sin(a),BASE+(H-inner*TH)*math.sin(theta)))
 count=(R+1)*N
 for layer in [0,1]:
  for j in range(R):
   for i in range(N):
    a=layer*count+j*N+i;b=layer*count+j*N+(i+1)%N;face=(a,b,b+N,a+N);fs.append(face if layer==0 else face[::-1])
 for i in range(N):fs.append((i,(i+1)%N,count+(i+1)%N,count+i))
 crown=mesh('sunhat_hollow_crown',vs,fs,straw)
 # Annular brim, top/bottom continuous with raised inner seat and softly down-curved outer edge preserving expressive brows.
 vs=[];fs=[];R=16
 for side in [-1,1]:
  for j in range(R+1):
   t=j/R
   for i in range(N):
    a=i*2*math.pi/N;seatR=math.sqrt(1-(.15/H)**2);rx=RX*seatR+(1.15-RX*seatR)*t;ry=RY*seatR+(.86-RY*seatR)*t;z=BASE+.15-.11*t*t+.015*t**8+.02*math.cos(2*a)*t+side*.018;vs.append((rx*math.cos(a),ry*math.sin(a),z))
 count=(R+1)*N
 for layer in [0,1]:
  for j in range(R):
   for i in range(N):
    a=layer*count+j*N+i;b=layer*count+j*N+(i+1)%N;f=(a,b,b+N,a+N);fs.append(f if layer else f[::-1])
 for j in [0,R]:
  for i in range(N):
   a=j*N+i;b=j*N+(i+1)%N;fs.append((a,a+count,b+count,b))
 brim=mesh('sunhat_soft_brim',vs,fs,straw)
 bevel=brim.modifiers.new('rounded 12mm brim edge','BEVEL');bevel.width=.018;bevel.segments=3;bevel.limit_method='ANGLE'
 # Brown band fits crown at 0.17..0.315 above seat, with its own shell.
 vs=[];fs=[]
 for inner in [0,1]:
  for j in range(2):
   z=.17+j*.145;r=math.sqrt(1-(z/H)**2)
   for i in range(N):
    a=i*2*math.pi/N;vs.append(((RX*r+.011-inner*.006)*math.cos(a),(RY*r+.011-inner*.006)*math.sin(a),BASE+z))
 for layer in [0,1]:
  for i in range(N):
   a=layer*2*N+i;b=layer*2*N+(i+1)%N;fs.append((a,b,b+N,a+N))
 for j in [0,1]:
  for i in range(N):a=j*N+i;b=j*N+(i+1)%N;fs.append((a,a+2*N,b+2*N,b))
 ribbon=mesh('sunhat_brown_band',vs,fs,band)
 # Small flat rear band join, no decorative bow.
 bpy.ops.mesh.primitive_cube_add(size=1,location=(0,RY*math.sqrt(1-(.2425/H)**2)+.012,BASE+.2425));join=bpy.context.object;join.name='sunhat_band_back_join';join.dimensions=(.10,.025,.13);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);join.data.materials.append(band);b=join.modifiers.new('soft join','BEVEL');b.width=.008;b.segments=3
 return [crown,brim,ribbon,join]
if __name__=='__main__':
 bpy.ops.wm.read_factory_settings(use_empty=True);objects=build()
 for o in objects:
  bpy.context.view_layer.objects.active=o;o.select_set(True)
  bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(o.data);bm.free()
  for mod in list(o.modifiers):bpy.ops.object.modifier_apply(modifier=mod.name)
  bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-6);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(o.data);bm.free();o.select_set(False)
 for o in objects:
  if o.name.startswith('sunhat_hollow') or o.name.startswith('sunhat_soft'):
   uv=o.data.uv_layers.new(name='woven_uv')
   for poly in o.data.polygons:
    angles=[]
    for li in poly.loop_indices:
     co=o.data.vertices[o.data.loops[li].vertex_index].co;angles.append((math.atan2(co.y/RY,co.x/RX)/(2*math.pi))%1)
    for li,u in zip(poly.loop_indices,angles):
     co=o.data.vertices[o.data.loops[li].vertex_index].co
     if max(angles)-min(angles)>.5 and u<.5:u+=1
     radial=math.sqrt((co.x/RX)**2+(co.y/RY)**2)
     v=(co.z-BASE)*3 if 'crown' in o.name else radial*3
     uv.data[li].uv=(u*3,v)
  o.location.z-=1.62766
 bpy.ops.object.select_all(action='SELECT');bpy.ops.export_scene.gltf(filepath=str(P/'sunhat.glb'),export_format='GLB',use_selection=True);bpy.ops.wm.save_as_mainfile(filepath=str(P/'sunhat.blend'))
