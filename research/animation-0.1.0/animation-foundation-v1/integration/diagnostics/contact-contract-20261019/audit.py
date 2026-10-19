import json,importlib.util,numpy as np,hashlib,time
from pathlib import Path
OUT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('collision',OUT/'triangle-collision.py');mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
d=json.load(open(OUT/'inputs/tea-keyframes.json'))
for f in d['frames']:
 for m in f['meshes']:
  if 'positionsFile' in m:m['positionsFile']=str(OUT/m['positionsFile'])
static=json.load(open(OUT/'inputs/static-cape.json'));inv=np.linalg.inv(np.array(static['sourceToWorld']).reshape(4,4).T)
parts=json.load(open(OUT/'frozen-cape.json'));cape={m['name']:m for m in parts['parts']}
proof={}
for m in static['frames'][0]['meshes']:
 if m['name'] not in cape:continue
 v=np.array(m['positions']).reshape(-1,3);v=v@inv[:3,:3].T+inv[:3,3];c=cape[m['name']]
 proof[m['name']]={'maxPositionError':float(abs(v-np.array(c['positions']).reshape(-1,3)).max()),'identicalIndices':m['indices']==c['indices']}
cs={n:mod.Triangles(np.array(m['positions']).reshape(-1,3),np.array(m['indices']).reshape(-1,3)) for n,m in cape.items()}
coarse=json.load(open(OUT/'inputs/cape-coarse.json'));pins=np.array(coarse['positions']).reshape(-1,3)[coarse['pins']]
def winding(points,tris):
 result=[]
 for p in points:
  vec=tris-p;l=np.linalg.norm(vec,axis=2);a,b,c=vec[:,0],vec[:,1],vec[:,2]
  numer=np.einsum('ij,ij->i',a,np.cross(b,c));denom=l.prod(1)+np.einsum('ij,ij->i',a,b)*l[:,2]+np.einsum('ij,ij->i',b,c)*l[:,0]+np.einsum('ij,ij->i',c,a)*l[:,1]
  result.append(float(np.arctan2(numer,denom).sum()/(2*np.pi)))
 return np.array(result)
frames=[];moving={}
for f in d['frames']:
 row={'time':f['time'],'phase':f['label'],'contacts':{},'pinsInsideHands':{}};moving[f['time']]={}
 for m0 in f['meshes']:
  m={**d['sharedMeshes'].get(m0['name'],{}),**m0};n=m['name']
  if not n.startswith(('Bubu_hand','Sip_')) or m.get('opacity',1)<=0:continue
  v=np.array(m['positions']).reshape(-1,3) if 'positions'in m else np.fromfile(m['positionsFile'],dtype='<f4').reshape(-1,3)
  tri=v[np.array(m['indices']).reshape(-1,3)];moving[f['time']][n]=tri
  for cn,c in cs.items():
   hits=c.intersections(tri)
   if len(hits):
    matched=c.t[hits[:,1]].reshape(-1,3)
    row['contacts'][n+'/'+cn]={'trianglePairs':len(hits),'garmentTriangleEnvelopeMin':matched.min(0).tolist(),'garmentTriangleEnvelopeMax':matched.max(0).tolist()}
  if n.startswith('Bubu_hand'):
   w=winding(pins,tri);inside=np.where(abs(w)>.5)[0];row['pinsInsideHands'][n]={'count':len(inside),'pinParticleIds':[coarse['pins'][i] for i in inside],'positions':pins[inside].tolist(),'maxAbsWinding':float(abs(w).max())}
 frames.append(row)
report={'units':'approved GLTF source units; no metric scale asserted','frozenCapeSHA256':parts['sha256'],'cachedStaticVsFrozenProof':proof,'frames':frames,'limitations':['Triangle-edge intersections are not penetration depth or complete containment test.','Pin winding inside assumes closed consistently wound hand surfaces; exact boundary points excluded by practical tolerance.','No continuous-time proof.']}
(OUT/'contact-report.json').write_text(json.dumps(report,indent=2))
print(json.dumps({'proof':proof,'frames':[{'t':f['time'],'contacts':{k:v['trianglePairs'] for k,v in f['contacts'].items()},'insidePins':{k:v['count'] for k,v in f['pinsInsideHands'].items()}} for f in frames]},indent=2))
