"""Append-only tail asset; reads original but never re-exports its geometry."""
import sys,json,struct,hashlib,math
from pathlib import Path
import numpy as np
from scipy.spatial import cKDTree
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'bubu-recovery-20261017/split-tools'))
from split_glb import GLB
OUT=Path(__file__).resolve().parent; SOURCE=ROOT/'bubu-recovery-20261017/research/animation-0.1.0/expression-library/d2-style-variant/asset/bubu-full18-d2-static-blush.glb'
g=GLB(SOURCE);prim=g.doc['meshes'][6]['primitives'][0];a={k:g.accessor(v) for k,v in prim['attributes'].items()};v=a['POSITION'];anchor=21306; center=v[anchor];back=np.where((v[:,2]<-.45)&(abs(v[:,0])<.35)&(v[:,1]>.15)&(v[:,1]<.8))[0];tree=cKDTree(v[back,:2])
# Small rounded tail, broad buried root aligned to measured back normal. Body stays intact.
positions=[];rows=17;segments=64;radius=.15;depth=.177
normal=np.array([0,-.420294,-.907387]);normal/=np.linalg.norm(normal);up=np.array([0,-normal[2],normal[1]])
for ring in range(rows):
 angle=2.12*ring/(rows-1)
 for j in range(segments):
  theta=2*math.pi*j/segments
  point=center+normal*(.035+radius*math.cos(angle))+radius*math.sin(angle)*(np.array([1,0,0])*math.cos(theta)+up*math.sin(theta))
  positions.append(point.tolist())
indices=[]
for ring in range(rows-1):
 for j in range(segments):
  a0=ring*segments+j;b=ring*segments+(j+1)%segments;c=(ring+1)*segments+j;d=(ring+1)*segments+(j+1)%segments
  indices.extend([b,d,c] if ring==0 else [a0,b,c,b,d,c])
p=np.array(positions,dtype='<f4');idx=np.array(indices,dtype='<u2');norm=(p-(center+normal*.035)).astype('<f4');norm/=np.linalg.norm(norm,axis=1)[:,None]
color=np.tile(a['COLOR_0'][anchor],(len(p),1)).astype('<f4');joints=np.zeros((len(p),4),dtype='<u2');weights=np.tile([1,0,0,0],(len(p),1)).astype('<f4')
doc={'asset':{'version':'2.0','generator':'bubu source-surface tail restoration'},'scene':0,'scenes':[{'nodes':[0]}],'nodes':[{'name':'Bubu_round-tail','mesh':0}],'meshes':[{'name':'Bubu_round-tail','primitives':[{'attributes':{},'indices':0,'material':0}]}],'materials':[g.doc['materials'][prim['material']]],'buffers':[{'byteLength':0}],'bufferViews':[],'accessors':[]};binary=bytearray()
def add(arr,typ,component):
 while len(binary)%4:binary.append(0)
 off=len(binary);binary.extend(arr.tobytes());doc['bufferViews'].append({'buffer':0,'byteOffset':off,'byteLength':arr.nbytes});ac={'bufferView':len(doc['bufferViews'])-1,'componentType':component,'count':len(arr),'type':typ}
 if typ=='VEC3':ac.update(min=arr.min(0).tolist(),max=arr.max(0).tolist())
 doc['accessors'].append(ac);return len(doc['accessors'])-1
pr=doc['meshes'][0]['primitives'][0];pr['indices']=add(idx,'SCALAR',5123)
for name,arr,typ,comp in [('POSITION',p,'VEC3',5126),('NORMAL',norm,'VEC3',5126),('COLOR_0',color,'VEC3',5126),('JOINTS_0',joints,'VEC4',5123),('WEIGHTS_0',weights,'VEC4',5126)]:pr['attributes'][name]=add(arr,typ,comp)
doc['buffers'][0]['byteLength']=len(binary)
while len(binary)%4:binary.append(0)
j=json.dumps(doc,separators=(',',':')).encode();j+=b' '*((-len(j))%4);raw=struct.pack('<4sII',b'glTF',2,28+len(j)+len(binary))+struct.pack('<II',len(j),0x4e4f534a)+j+struct.pack('<II',len(binary),0x004e4942)+binary
(OUT/'bubu-round-tail.glb').write_bytes(raw)
record={'sourceSHA256':hashlib.sha256(g.raw).hexdigest(),'tailSHA256':hashlib.sha256(raw).hexdigest(),'sourceAnchorVertex':anchor,'anchor':center.tolist(),'skinJoint':0,'skinJointName':'Body','bounds':[p.min(0).tolist(),p.max(0).tolist()],'sourceGeometryModified':False,'sourceSurfaceEvidence':'Actual back/profile source renders show no anatomical round tail. Rear source surface is smooth. No tail node is supporting evidence only.','shape':'Small rounded .30-wide tail; tilted with measured lower-back normal, base embedded .043 into original skin. Native Body binding; no detached root.','sourceAttributesSHA256':{k:hashlib.sha256(x.tobytes()).hexdigest() for k,x in a.items()},'provenance':'New user-requested anatomical restoration; not represented as recovered original V1 geometry.'}
(OUT/'provenance.json').write_text(json.dumps(record,indent=2));(OUT/'tail-mesh.json').write_text(json.dumps({'name':'Bubu_round-tail','positions':p.ravel().tolist(),'indices':idx.tolist(),'colors':np.c_[color,np.ones(len(p))].ravel().tolist()}));print(json.dumps(record,indent=2))

# Reproducible independent root-burial measurement against actual source vertices.
gaps=[]
for pt in p[-segments:]:
 dist,ix=tree.query(pt[:2],k=12);pts=v[back[ix]];fit=np.linalg.lstsq(np.c_[pts[:,:2]-pt[:2],np.ones(12)],pts[:,2],rcond=None)[0];gaps.append(float(pt[2]-fit[2]))
assert min(gaps)>0
(OUT/'root-burial.json').write_text(json.dumps({'rimVertices':segments,'minimumInwardBurialZ':min(gaps),'maximumInwardBurialZ':max(gaps),'method':'Local least-squares plane through 12 nearest actual rear source vertices'},indent=2))
