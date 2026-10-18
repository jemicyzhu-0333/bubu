"""Approved round-five accessory silhouettes. Blender Z-up authoring, GLTF Y-up export.

Actor geometry is never loaded or modified. Fixed shoulder supports, open hand
clearance and free hems are explicit construction constraints, not cloth claims.
"""
import bpy, math, importlib.util, sys, argparse
import numpy as np
from mathutils.bvhtree import BVHTree
from mathutils import Vector
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser();parser.add_argument('--body-input',type=Path,required=True)
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:])
body=np.load(args.body_input)
# Source-native body supplies the garment surface, not an approximate ellipsoid.
body_vertices=[(float(x),float(-z),float(y)) for x,y,z in body['POSITION']]
body_bvh=BVHTree.FromPolygons(body_vertices,body['triangles'].tolist(),all_triangles=True)
def surface(angle,height):
    direction=Vector((math.cos(angle),math.sin(angle),0))
    support_height=max(.36,height)
    point,normal,index,distance=body_bvh.ray_cast(Vector((0,0,support_height)),direction,3)
    if point is None: raise ValueError(f'Missing approved body surface angle={angle} height={height}')
    point.z=height
    return point,normal

spec = importlib.util.spec_from_file_location('forms', ROOT/'themed-accessories/src/build_models.py')
forms = importlib.util.module_from_spec(spec)
spec.loader.exec_module(forms)

def cloth_point(angle, t):
    back=(math.sin(angle)+1)/2
    top=.59+.62*back+.20*math.cos(angle)**6
    low=.33-.08*back+.18*max(0,-math.sin(angle))**8
    # Open arch below each shoulder: hands exit through free side cutouts.
    q=max(0,min(1,(abs(math.sin(angle))-.35)/.35))
    opening=1-q*q*(3-2*q)
    low=low*(1-opening)+(top-.055)*opening
    z=top*(1-t)+low*t
    point,normal=surface(angle,z)
    ease=.010+.016*back+.035*back*t*t
    point+=normal*ease
    return tuple(point)


def export(path):
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True)

def cape(plum=False):
    forms.reset()
    key='plum' if plum else 'cape'
    cloth=forms.mat(key+' cloth',(.13,.003,.045) if plum else (.48,.36,.65))
    trim=forms.mat(key+' soft piping',(.22,.045,.10) if plum else (.57,.79,.66))
    clasp=forms.mat(key+' small clasp',(.90,.80,.51))
    n,m=160,18; verts=[]; faces=[]
    angles=[-math.pi/2+.055+(2*math.pi-.11)*i/n for i in range(n+1)]
    for a in angles:
        for j in range(m+1): verts.append(cloth_point(a,j/m))
    for i in range(n):
        for j in range(m):
            k=i*(m+1)+j;faces.append((k,k+m+1,k+m+2,k+1))
    mesh=bpy.data.meshes.new(key+' open shoulder drape');mesh.from_pydata(verts,[],faces);mesh.update()
    obj=bpy.data.objects.new(key+'_cloth',mesh);bpy.context.collection.objects.link(obj);forms.finish(obj,obj.name,cloth)
    solid=obj.modifiers.new('soft fabric thickness','SOLIDIFY');solid.thickness=.012
    forms.tube(key+'_back_edge',[cloth_point(a,0) for a in angles],.009,trim)
    forms.tube(key+'_hem',[cloth_point(a,1) for a in angles],.009,trim)
    for i,a in enumerate([angles[0],angles[-1]]):
        forms.tube(key+'_front_edge_'+str(i),[cloth_point(a,j/m) for j in range(m+1)],.009,trim)
    # Front closure is beneath the mouth and above the short open front flaps.
    center,normal=surface(-math.pi/2,.59)
    center+=normal*.015
    forms.ell(key+'_clasp',tuple(center),(.027,.007,.027),clasp)
    target=ROOT/('themed-accessories/models/plum-cape.glb' if plum else 'accessory-expansion/models/07-cape.glb')
    export(target)

def paired_fins():
    forms.reset()
    aqua=forms.mat('aqua satin fin membrane',(.17,.64,.68))
    edge=forms.mat('soft teal fin rim',(.12,.48,.53))
    outline=[(.79,.75),(.90,.96),(1.17,1.17),(1.31,1.18),(1.26,1.08),(1.24,.96),(1.29,.86),(1.17,.82),(1.21,.69),(1.10,.66),(.91,.71)]
    for side in [-1,1]:
        label='left' if side<0 else 'right'
        points=[(side*x,.45+.25*(x-.79),z) for x,z in forms.smooth_loop(outline)]
        forms.pillow('fin_'+label+'_membrane',points,.025,aqua)
        forms.tube('fin_'+label+'_rim',points+[points[0]],.009,edge)
    export(ROOT/'themed-accessories/models/ocean-fin.glb')

cape();cape(True);paired_fins()
