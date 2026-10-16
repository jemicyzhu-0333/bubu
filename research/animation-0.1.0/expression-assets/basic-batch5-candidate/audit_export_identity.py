from pathlib import Path
import json,hashlib,struct,numpy as np
P=Path(__file__).parent;F=P.parent/'bubu-3d-a-face-coordinate-v2-20261016/candidate-a05-selected-faces-r6-review'
def load(path):
 b=path.read_bytes();l,_=struct.unpack_from('<II',b,12);g=json.loads(b[20:20+l]);off=20+l;bl,_=struct.unpack_from('<II',b,off);return g,b[off+8:off+8+bl]
def acc(g,b,i):
 a=g['accessors'][i];nc={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}[a['type']];dt={5120:'i1',5121:'u1',5122:'<i2',5123:'<u2',5125:'<u4',5126:'<f4'}[a['componentType']];size=np.dtype(dt).itemsize
 if 'bufferView' in a:
  v=g['bufferViews'][a['bufferView']];off=v.get('byteOffset',0)+a.get('byteOffset',0);out=np.ndarray((a['count'],nc),dtype=dt,buffer=b,offset=off,strides=(v.get('byteStride',size*nc),size)).copy()
 else:out=np.zeros((a['count'],nc),dtype=dt)
 if 'sparse' in a:
  sp=a['sparse'];ii=sp['indices'];vv=sp['values'];iv=g['bufferViews'][ii['bufferView']];vb=g['bufferViews'][vv['bufferView']];it={5121:'u1',5123:'<u2',5125:'<u4'}[ii['componentType']]
  idx=np.frombuffer(b,dtype=it,count=sp['count'],offset=iv.get('byteOffset',0)+ii.get('byteOffset',0));vals=np.frombuffer(b,dtype=dt,count=sp['count']*nc,offset=vb.get('byteOffset',0)+vv.get('byteOffset',0)).reshape(-1,nc);out[idx]=vals
 return out
def meshes(g):return {n['name']:g['meshes'][n['mesh']] for n in g['nodes'] if 'mesh' in n}
a,ab=load(F/'bubu-a05-selected-faces.glb');c,cb=load(P/'bubu-a05-basic-batch5.glb');ma,mc=meshes(a),meshes(c);checks={}
for n,m in ma.items():
 checks[n]={}
 for ip,(pa,pc) in enumerate(zip(m['primitives'],mc[n]['primitives'])):
  for sem,i in pa['attributes'].items():
   x,y=acc(a,ab,i),acc(c,cb,pc['attributes'][sem]);checks[n][sem]={'exact':bool(np.array_equal(x,y)),'maxDifference':float(np.abs(x.astype(float)-y.astype(float)).max())}
  checks[n]['indices']={'exact':bool(np.array_equal(acc(a,ab,pa['indices']),acc(c,cb,pc['indices'])))}
allbase=all(v['exact'] for name,row in checks.items() for k,v in row.items() if k!='NORMAL');maxnorm=max(row.get('NORMAL',{}).get('maxDifference',0) for row in checks.values());finite=all(np.isfinite(acc(c,cb,i)).all() for i,x in enumerate(c['accessors']) if x['componentType']==5126)
na={n.get('name'):n for n in a['nodes']};nc={n.get('name'):n for n in c['nodes']};bones={n:all(na[n].get(k)==nc[n].get(k) for k in ['translation','rotation','scale','matrix']) for n in ['Body','Shoulder_L','Shoulder_R','Hip_L','Hip_R','HeadTouch','AccessoryAnchor']};skinbind=all(np.array_equal(acc(a,ab,x['inverseBindMatrices']),acc(c,cb,y['inverseBindMatrices'])) for x,y in zip(a['skins'],c['skins']))
r={'allBasePositionsWeightsColorsAndIndicesExactlyEqual':allbase,'maxNormalExportRoundoff':maxnorm,'allFloatAccessorsFinite':bool(finite),'sparseAccessorsChecked':sum('sparse' in x for x in c['accessors']),'baseOmittedAccessorsChecked':sum('bufferView' not in x for x in c['accessors']),'bonesRestExactlyEqual':bones,'inverseBindsExactlyEqual':skinbind,'meshChecks':checks};assert allbase and finite and all(bones.values()) and skinbind;r['passed']=True;(P/'export-identity-audit.json').write_text(json.dumps(r,indent=2));print('EXPORT_IDENTITY',r['passed'],maxnorm)

oldTargets={}
for name,m in ma.items():
 if name=='A_mochi_skin':continue
 oldNames=m['extras']['targetNames'];newNames=mc[name]['extras']['targetNames'];pa=m['primitives'][0];pc=mc[name]['primitives'][0];oldTargets[name]={}
 for target in oldNames:
  ta=pa['targets'][oldNames.index(target)];tc=pc['targets'][newNames.index(target)];oldTargets[name][target]=all(np.array_equal(acc(a,ab,index),acc(c,cb,tc[key])) for key,index in ta.items())
r['historicalTargetsExactlyEqual']=all(v for row in oldTargets.values() for v in row.values());r['oldTargetChecks']=oldTargets;r['assetSHA256']=hashlib.sha256((P/'bubu-a05-basic-batch5.glb').read_bytes()).hexdigest();assert r['historicalTargetsExactlyEqual'];(P/'export-identity-audit.json').write_text(json.dumps(r,indent=2));print('OLD_TARGETS',r['historicalTargetsExactlyEqual'])
