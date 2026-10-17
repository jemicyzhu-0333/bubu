"""Reference-driven lavender/mint cloth with separate bounded-flex tail."""
import bpy,bmesh,math,sys
from pathlib import Path
P=Path(__file__).resolve().parents[1];sys.path.insert(0,str(P.parent/'03-satchel/src'));from build_satchel import radius,mat

def mesh(name,vs,fs,materials):
 d=bpy.data.meshes.new(name);d.from_pydata(vs,[],fs);d.update();o=bpy.data.objects.new(name,d);bpy.context.collection.objects.link(o)
 for m in materials:d.materials.append(m)
 uv=d.uv_layers.new(name='Cloth UV')
 for loop in d.loops:
  co=d.vertices[loop.vertex_index].co;uv.data[loop.index].uv=(co.x*10,co.z*10)
 for f in d.polygons:f.use_smooth=True
 return o

def build():
 lavender=mat('soft lavender cloth',(.45,.32,.68),.92);mint=mat('pale mint cloth stripe',(.53,.80,.65),.92)
 for material,color in [(lavender,(.70,.60,.84)),(mint,(.76,.90,.81))]:
  image=bpy.data.images.new(material.name+' woven',width=128,height=128,alpha=True);pixels=[]
  for y in range(128):
   for x in range(128):
    u=(x%16)/16;v=(y%16)/16;vertical=(x//16+y//16)%2==0;c=u if vertical else v
    factor=.97+.025*math.cos(c*math.pi*2)+.012*math.sin(x*13+y*7)
    pixels.extend([q*factor for q in color]+[1])
  image.pixels=pixels;image.filepath_raw=str(P/(material.name.replace(' ','-')+'.png'));image.file_format='PNG';image.save();image.pack();node=material.node_tree.nodes.new('ShaderNodeTexImage');node.image=image;material.node_tree.links.new(node.outputs['Color'],material.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
 N=160;M=32;vs=[];fs=[]
 for i in range(N):
  a=2*math.pi*i/N;center=.32+.61*math.cos(a)**2+.30*max(0,math.sin(a))**2;half=.13-.075*abs(math.cos(a))**6
  for j in range(M):
   b=2*math.pi*j/M;v=half*math.copysign(abs(math.cos(b))**.8,math.cos(b));th=.026*math.copysign(abs(math.sin(b))**.8,math.sin(b));z=center+v
   rad=radius(z)+.035+th+.004*math.sin(a*3+v*9)
   x=rad*math.copysign(abs(math.cos(a))**(2/2.12),math.cos(a));y=rad*.785*math.copysign(abs(math.sin(a))**(2/2.12),math.sin(a));vs.append((x,y,z))
 for i in range(N):
  for j in range(M):fs.append((i*M+j,((i+1)%N)*M+j,((i+1)%N)*M+(j+1)%M,i*M+(j+1)%M))
 collar=mesh('scarf_collar',vs,fs,[lavender,mint])
 for i,f in enumerate(collar.data.polygons):
  j=i%M;half=.13-.075*abs(math.cos(2*math.pi*(i//M)/N))**6;v1=half*math.copysign(abs(math.cos(2*math.pi*j/M))**.8,math.cos(2*math.pi*j/M));v2=half*math.copysign(abs(math.cos(2*math.pi*(j+1)/M))**.8,math.cos(2*math.pi*(j+1)/M));f.material_index=1 if abs((v1+v2)/2)<half*.52 else 0
 # Root is tucked into back-right collar; front view tail is on viewer right.
 N=40;M=16;vs=[];fs=[]
 for layer in [-1,1]:
  for i in range(N+1):
   t=i/N;cx=1.00+.15*math.sin(t*math.pi/2);cy=.28+.07*math.sin(t*math.pi/2);cz=.88-.56*t
   width=.13*(1 if t<.85 else math.sqrt(max(.04,1-((t-.85)/.17)**2)))
   for j in range(M+1):
    u=-1+2*j/M;vs.append((cx+width*u,cy+.018*u*u+.018*layer,cz+.008*math.sin(t*math.pi*2)*u))
 count=(N+1)*(M+1)
 for layer in [0,1]:
  for i in range(N):
   for j in range(M):
    a=layer*count+i*(M+1)+j;face=(a,a+1,a+M+2,a+M+1);fs.append(face if layer else face[::-1])
 for i in range(N):
  for j in [0,M]:a=i*(M+1)+j;b=(i+1)*(M+1)+j;fs.append((a,b,b+count,a+count))
 for i in [0,N]:
  for j in range(M):a=i*(M+1)+j;fs.append((a,a+count,a+1+count,a+1))
 tail=mesh('scarf_tail',vs,fs,[lavender,mint])
 for f in tail.data.polygons:
  z=sum(tail.data.vertices[i].co.z for i in f.vertices)/len(f.vertices);f.material_index=1 if .47<z<.65 else 0
 return [collar,tail]
if __name__=='__main__':
 bpy.ops.wm.read_factory_settings(use_empty=True);objects=build()
 for o in objects:
  bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-6);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(o.data);bm.free();o.location.z-=1.62766
 bpy.ops.object.select_all(action='SELECT');bpy.ops.export_scene.gltf(filepath=str(P/'scarf.glb'),export_format='GLB',use_selection=True);bpy.ops.wm.save_as_mainfile(filepath=str(P/'scarf.blend'))
