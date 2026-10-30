"""Offline, bounded support-plane refinement near the original garment.

No uniform radius or global scale inflation. Every plane contains all source
body vertices; local garment clearance is an additional constraint, never a
replacement for the subsequent whole-triangle and maximum-error audit.
"""
import argparse,json,pathlib,numpy as np
from scipy.spatial import HalfspaceIntersection,ConvexHull
parser=argparse.ArgumentParser();parser.add_argument('--input',type=pathlib.Path,required=True);parser.add_argument('--output',type=pathlib.Path,required=True);parser.add_argument('--refine',type=pathlib.Path);args=parser.parse_args()
assert not args.output.exists()
data=json.loads(args.input.read_text());body=np.asarray(data['body']).reshape(-1,3);points=np.asarray(data['points']).reshape(-1,3);normals=np.asarray(data['normals']).reshape(-1,3)
assert len(body)<=100000 and len(points)<=50000 and np.isfinite(body).all() and np.isfinite(points).all() and np.isfinite(normals).all()
planes=[];clearance=np.full(len(points),-np.inf)
def add(normal):
 normal=np.asarray(normal);normal/=np.linalg.norm(normal);support=(body@normal).max()+2e-6
 planes.append(np.r_[normal,-support]);clearance[:]=np.maximum(clearance,points@normal-support)
# The global directions retain a bounded overall shape; local supports address
# the much tighter, measured trim clearance without inflating another region.
for i in range(256):
 z=1-2*(i+.5)/256;theta=i*np.pi*(3-np.sqrt(5));r=np.sqrt(1-z*z);add([r*np.cos(theta),r*np.sin(theta),z])
if args.refine:
 for normal in json.loads(args.refine.read_text())['refinementNormals']:add(normal)
for _ in range(1792):
 worst=clearance.argmin()
 if clearance[worst]>=.00025:break
 previous=clearance[worst];add(normals[worst]);assert clearance[worst]>previous+1e-8,'No valid local separating support'
assert clearance.min()>=.00025,'Local proxy exceeds plane budget'
assert len(planes)<=2048
planes=np.array(planes);vertices=HalfspaceIntersection(planes,body.mean(axis=0)).intersections
# Weld sub-micrometre construction artifacts before triangulating Float32
# output. Re-certify the resulting faces; rounding cannot waive containment.
vertices=np.unique((np.round(vertices/1e-6)*1e-6).astype(np.float32),axis=0)
hull=ConvexHull(vertices);tri=hull.simplices.copy()
for i,ids in enumerate(tri):
 a,b,c=vertices[ids]
 if np.dot(np.cross(b-a,c-a),hull.equations[i,:3])<0:tri[i,1],tri[i,2]=tri[i,2],tri[i,1]
# Certify actual returned Float32 geometry, independently of construction planes.
maximum=-np.inf
for start in range(0,len(hull.equations),64):
 eq=hull.equations[start:start+64];maximum=max(maximum,float((body@eq[:,:3].T+eq[:,3]).max()))
assert maximum< -1e-8
assert len(vertices)<=2048 and len(tri)<=4096
out={'schema':'bubu-local-body-proxy/1','positions':vertices.ravel().tolist(),'indices':tri.ravel().tolist(),'certificate':{'planes':len(planes),'vertices':len(vertices),'triangles':len(tri),'maximumPlaneViolation':maximum,'minimumGarmentVertexPlaneGap':float(clearance.min()),'requiredGarmentVertexGap':.00025,'globalMaximumErrorLimit':.01,'wholeTriangleClearance':'requires-independent-audit'}}
args.output.write_text(json.dumps(out,separators=(',',':')));print(out['certificate'])
