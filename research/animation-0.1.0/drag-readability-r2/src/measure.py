import json,struct,hashlib,sys,numpy as np
from pathlib import Path
P=Path(__file__).resolve().parents[1];data=json.loads((P/'evidence/poses.json').read_text());meta=json.loads((P/'evidence/poses-metadata.json').read_text());result=[]
for start,yaw in [(0,10),(6,52)]:
 frames=data['frames'][start:start+6];skins=[next(m for m in f['meshes'] if m['name']=='A_mochi_skin') for f in frames];rest=np.array(skins[2]['positions']).reshape(-1,3);R=np.array(meta[start+2]['snapshot']['actorMatrix']).reshape(4,4).T;local=(np.c_[rest,np.ones(len(rest))]@np.linalg.inv(R).T)[:,:3];ids=np.array(skins[2]['indices']).reshape(-1,3)
 groups={'nearHand':(local[:,0]<-.92)&(local[:,1]>.55)&(local[:,1]<1),'farHand':(local[:,0]>.92)&(local[:,1]>.55)&(local[:,1]<1),'nearFoot':(local[:,0]<-.1)&(local[:,1]<.15),'farFoot':(local[:,0]>.1)&(local[:,1]<.15)}
 area=lambda v:np.linalg.norm(np.cross(v[ids[:,1]]-v[ids[:,0]],v[ids[:,2]]-v[ids[:,0]]),axis=1);baseArea=area(rest);edges=np.unique(np.sort(np.concatenate([ids[:,[0,1]],ids[:,[1,2]],ids[:,[2,0]]]),axis=1),axis=0);baseEdge=np.linalg.norm(rest[edges[:,0]]-rest[edges[:,1]],axis=1)
 row={'yaw':yaw,'pairExcursions':{},'deformation':[]}
 for label,a,b in [('v1',0,1),('r2',4,5)]:
  A=np.array(skins[a]['positions']).reshape(-1,3);B=np.array(skins[b]['positions']).reshape(-1,3);row['pairExcursions'][label]={}
  for name,mask in groups.items():
   d=(A[mask]-B[mask]).mean(axis=0);row['pairExcursions'][label][name]={'centroidScreenPxAt276':float(np.linalg.norm(d[:2])*276/5),'verticalPxAt276':float(abs(d[1])*276/5),'tipMaxScreenPxAt276':float(np.linalg.norm((A[mask]-B[mask])[:,:2],axis=1).max()*276/5)}
 for i,m in enumerate(skins):
  v=np.array(m['positions']).reshape(-1,3);areas=area(v);ratios=areas[baseArea>1e-12]/baseArea[baseArea>1e-12];edge=np.linalg.norm(v[edges[:,0]]-v[edges[:,1]],axis=1);row['deformation'].append({'case':meta[start+i]['name'],'minTriangleAreaRatio':float(ratios.min()),'maxEdgeLengthRatio':float((edge[baseEdge>1e-9]/baseEdge[baseEdge>1e-9]).max()),'finite':bool(np.isfinite(v).all())})
 result.append(row)
(P/'evidence/measurements.json').write_text(json.dumps({'pixelScale':'276px fixed canvas / 5 world units; approx99px neutral body width. Measured x/y actual world projection; root fixed and body pivot zero.','comparisons':result},indent=2));print(json.dumps(result,indent=2))
# Registered full18 body retains exact older r4 bind data; face layers intentionally differ.
def glb(p):
 b=Path(p).read_bytes();n=struct.unpack_from('<I',b,12)[0];j=json.loads(b[20:20+n]);o=20+n;size=struct.unpack_from('<I',b,o)[0];return j,b[o+8:o+8+size]
def accessor(j,b,i):
 a=j['accessors'][i];v=j['bufferViews'][a['bufferView']];start=v.get('byteOffset',0)+a.get('byteOffset',0);dt={5126:'<f4',5125:'<u4',5123:'<u2',5121:'u1'}[a['componentType']];cols={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}[a['type']];return np.ndarray((a['count'],cols),dtype=dt,buffer=b,offset=start,strides=(v.get('byteStride',np.dtype(dt).itemsize*cols),np.dtype(dt).itemsize)).copy()

if len(sys.argv)<2:
 print('Historical bind parity was retained in evidence/body-bind-parity.json. Pass exact r4-frozen.glb path to recheck.');sys.exit(0)
paths=[Path(sys.argv[1]),Path(data['sourceGLB'])];parsed=[glb(p) for p in paths];prim=[]
for j,b in parsed:
 node=next(n for n in j['nodes'] if n['name']=='A_mochi_skin');prim.append(j['meshes'][node['mesh']]['primitives'][0])
checks={}
for key in prim[0]['attributes']:
 a=accessor(*parsed[0],prim[0]['attributes'][key]);b=accessor(*parsed[1],prim[1]['attributes'][key]);checks[key]={'equal':bool(np.array_equal(a,b)),'sha256':hashlib.sha256(b.tobytes()).hexdigest()}
checks['indices']={'equal':bool(np.array_equal(accessor(*parsed[0],prim[0]['indices']),accessor(*parsed[1],prim[1]['indices'])))}
checks['inverseBindMatrices']={'equal':bool(np.array_equal(accessor(*parsed[0],parsed[0][0]['skins'][0]['inverseBindMatrices']),accessor(*parsed[1],parsed[1][0]['skins'][0]['inverseBindMatrices'])))}
(P/'evidence/body-bind-parity.json').write_text(json.dumps({'sources':[str(p) for p in paths],'checks':checks},indent=2));print('PARITY',checks)
