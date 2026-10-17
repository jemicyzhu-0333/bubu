"""Reference-driven low waist-sling pouch. Uses approved torso measurement profile."""
import bpy,bmesh,math,json
from pathlib import Path
from mathutils import Matrix,Vector
P=Path(__file__).resolve().parents[1]
profile=[(.125,0),(.14,.32),(.17,.54),(.23,.69),(.32,.81),(.44,.90),(.60,.969),(.78,1.0),(.98,.985),(1.16,.935),(1.33,.82),(1.46,.71),(1.55,.60),(1.605,.46),(1.632,.28),(1.64,0)]
def radius(z):
 i=next(i for i in range(len(profile)-1) if profile[i][0]<=z<=profile[i+1][0]);x0,y0=profile[i];x1,y1=profile[i+1];t=(z-x0)/(x1-x0)
 def slope(k):
  if k==0:return 1
  if k==len(profile)-1:return 0
  a=(profile[k][1]-profile[k-1][1])/(profile[k][0]-profile[k-1][0]);b=(profile[k+1][1]-profile[k][1])/(profile[k+1][0]-profile[k][0]);return 0 if a*b<=0 else 2*a*b/(a+b)
 return (2*t**3-3*t*t+1)*y0+(t**3-2*t*t+t)*(x1-x0)*slope(i)+(-2*t**3+3*t*t)*y1+(t**3-t*t)*(x1-x0)*slope(i+1)
def mat(name,c,rough=.7,metal=0):
 m=bpy.data.materials.new(name);m.diffuse_color=(*c,1);m.use_nodes=True;b=m.node_tree.nodes.get('Principled BSDF');b.inputs['Base Color'].default_value=(*c,1);b.inputs['Roughness'].default_value=rough;b.inputs['Metallic'].default_value=metal;return m

def rounded(name,loc,size,bevel,material):
 bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object;o.name=name;o.dimensions=size;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(material);m=o.modifiers.new('soft leather rounded corners','BEVEL');m.width=bevel;m.segments=6
 for f in o.data.polygons:f.use_smooth=True
 return o

def build():
 leather=mat('caramel soft leather',(.43,.13,.028));flap=mat('caramel flap',(.49,.16,.039));edge=mat('leather seam',(.26,.085,.018));brass=mat('small brushed brass catch',(.82,.54,.12),.36,.55)
 # Continuous annular ribbon, low at front to protect all18 mouth shapes.
 N=160;vs=[];fs=[]
 for layer in [0,1]:
  for rim in [-1,1]:
   for i in range(N):
    a=2*math.pi*i/N;z=.48+.15*math.cos(a)+.07*math.sin(a)+rim*.039;rad=radius(z)+.022+layer*.016
    x=rad*math.copysign(abs(math.cos(a))**(2/2.12),math.cos(a));y=rad*.785*math.copysign(abs(math.sin(a))**(2/2.12),math.sin(a));vs.append((x,y,z))
 for layer in [0,1]:
  for i in range(N):a=layer*2*N+i;b=layer*2*N+(i+1)%N;fs.append((a,b,b+N,a+N))
 for rim in [0,1]:
  for i in range(N):a=rim*N+i;b=rim*N+(i+1)%N;fs.append((a,a+2*N,b+2*N,b))
 d=bpy.data.meshes.new('continuous fitted low ribbon');d.from_pydata(vs,[],fs);d.update();strap=bpy.data.objects.new('satchel_continuous_strap',d);bpy.context.collection.objects.link(strap);d.materials.append(leather)
 for f in d.polygons:f.use_smooth=True
 # Pouch is on the character right (viewer-left), forward of the side, below hand.
 pouch=rounded('satchel_pouch',(-.91,-.35,.32),(.58,.28,.42),.12,leather)
 # Thin flap with genuinely rounded silhouette independent of its thickness.
 outline=[];w=.58;h=.22;r=.065
 for cx,cz,start in [(w/2-r,h/2-r,0),(-w/2+r,h/2-r,90),(-w/2+r,-h/2+r,180),(w/2-r,-h/2+r,270)]:
  for k in range(9):
   a=math.radians(start+k*90/8);outline.append((cx+r*math.cos(a),cz+r*math.sin(a)))
 vs=[(-.91+x,y,.425+z) for y in [-.50,-.545] for x,z in outline];L=len(outline);fs=[tuple(range(L-1,-1,-1)),tuple(range(L,2*L))]+[(i,(i+1)%L,(i+1)%L+L,i+L) for i in range(L)]
 d=bpy.data.meshes.new('rounded flap silhouette');d.from_pydata(vs,[],fs);d.update();lid=bpy.data.objects.new('satchel_flap',d);bpy.context.collection.objects.link(lid);d.materials.append(flap);bev=lid.modifiers.new('soft flap edge','BEVEL');bev.width=.012;bev.segments=3
 for f in d.polygons:f.use_smooth=True
 catch=rounded('satchel_square_catch',(-.91,-.566,.34),(.085,.028,.085),.014,brass)
 return [strap,pouch,lid,catch]

if __name__=='__main__':
 bpy.ops.wm.read_factory_settings(use_empty=True);objects=build()
 for o in objects:
  bpy.context.view_layer.objects.active=o;o.select_set(True)
  bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(o.data);bm.free()
  for mod in list(o.modifiers):bpy.ops.object.modifier_apply(modifier=mod.name)
  if o.name!='satchel_continuous_strap':
   bpy.ops.object.transform_apply(location=True,rotation=True,scale=True);center=Vector((-.91,-.35,.32));R=Matrix.Rotation(math.radians(-35),3,'Z')
   for v in o.data.vertices:v.co=center+R@(v.co-center)
  bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-6);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(o.data);bm.free();o.location.z-=1.62766;o.select_set(False)
 bpy.ops.object.select_all(action='SELECT');bpy.ops.export_scene.gltf(filepath=str(P/'satchel.glb'),export_format='GLB',use_selection=True);bpy.ops.wm.save_as_mainfile(filepath=str(P/'satchel.blend'))
