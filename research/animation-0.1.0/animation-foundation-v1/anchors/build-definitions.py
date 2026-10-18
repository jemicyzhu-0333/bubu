"""Compile finite semantic mount samples from immutable hybrid GLB vertex data."""
import json,struct,hashlib,pathlib,numpy as np
root=pathlib.Path(__file__).resolve().parent
source=root.parents[1]/'bubu-recovery-20261017/delivery-package/geometry/bubu-hybrid-binding.glb'
b=source.read_bytes();n=struct.unpack_from('<I',b,12)[0];j=json.loads(b[20:20+n]);buf=b[28+n:]
def attr(i):
 a=j['accessors'][i];v=j['bufferViews'][a['bufferView']];dtype={5126:'<f4',5123:'<u2',5125:'<u4',5121:'u1'}[a['componentType']];width={'VEC3':3,'VEC4':4,'SCALAR':1}[a['type']];return np.frombuffer(buf,dtype=dtype,count=a['count']*width,offset=v.get('byteOffset',0)+a.get('byteOffset',0)).reshape(-1,width)
meshes={m['name']:{k:attr(v) for k,v in m['primitives'][0]['attributes'].items()} for m in j['meshes']}
# Anatomical selectors in geometry-local bounds; projected to existing surface vertices.
# Front is +Z; L is source negative X, matching original joint/mesh naming.
rows=[('crown',0,.90,0,[0,1,0]),('forehead',0,.79,1,[0,0,1]),('templeL',-.65,.77,.7,[-1,0,1]),('templeR',.65,.77,.7,[1,0,1]),('neck.front',0,.47,1,[0,0,1]),('neck.back',0,.47,-1,[0,0,-1]),('neck.sideL',-1,.47,0,[-1,0,0]),('neck.sideR',1,.47,0,[1,0,0]),('shoulderL',-.94,.40,0,[-1,0,0]),('shoulderR',.94,.40,0,[1,0,0]),('back.upper',0,.65,-1,[0,0,-1]),('back.lower',0,.28,-1,[0,0,-1]),('hip.sideL',-.85,.20,0,[-1,0,0]),('hip.sideR',.85,.20,0,[1,0,0]),('tail.root',0,.20,-1,[0,0,-1])]
for side,x in [('L',-.63),('R',.63)]:
 for face,z in [('front',.16),('rear',-.16)]:rows.append((f'ear{side}.{face}',x,.96,z,[0,0,1 if z>0 else -1]))
out=[]
for row in rows+[(f'palm.grip{s}',0,.35,1,[0,0,1],f'Bubu_hand-{side}') for s,side in [('L','left'),('R','right')]]+[(f'foot{s}.top',0,1,.15,[0,1,0],f'Bubu_foot-{side}') for s,side in [('L','left'),('R','right')]]+[(f'sole{s}',0,0,0,[0,-1,0],f'Bubu_foot-{side}') for s,side in [('L','left'),('R','right')]]:
 id,x,y,z,normal,*part=row;part=part[0] if part else 'Bubu_body';a=meshes[part];p=a['POSITION'];lo=p.min(0);hi=p.max(0);q=lo+(hi-lo)*np.array([(x+1)/2,y,(z+1)/2]);nv=np.array(normal,dtype=float);nv/=np.linalg.norm(nv);norm=a['NORMAL'];score=np.sum(((p-q)/(hi-lo))**2,axis=1);score[np.sum(norm*nv,axis=1)<.25]=np.inf;idx=int(np.argmin(score));assert np.isfinite(score[idx]);nrm=norm[idx]/np.linalg.norm(norm[idx]);up=np.array([0,1,0]) if abs(nrm[1])<.9 else np.array([0,0,-1]);tx=np.cross(up,nrm);tx/=np.linalg.norm(tx);ty=np.cross(nrm,tx)
 out.append(dict(id=id,part=part,vertex=idx,position=p[idx].tolist(),normal=nrm.tolist(),tangentX=tx.tolist(),tangentY=ty.tolist(),skinIndices=a.get('JOINTS_0',np.zeros((len(p),4)))[idx].tolist(),skinWeights=a.get('WEIGHTS_0',np.zeros((len(p),4)))[idx].tolist(),offsetBounds=[[-.025,.025],[-.025,.025],[0,.04]],selection='nearest compatible surface vertex in semantic geometry-local region'))
(root/'definitions.json').write_text(json.dumps(dict(version=1,hybridSHA256=hashlib.sha256(b).hexdigest(),anchors=out),indent=2)+'\n')
(root/'definitions.mjs').write_text('export const DEFINITIONS = '+json.dumps(out,separators=(',',':'))+';\n')
print('compiled',len(out),'anchors')
