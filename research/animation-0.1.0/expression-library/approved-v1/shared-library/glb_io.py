"""Minimal exact glTF2 accessor reader/writer for this audited untextured asset."""
import json,struct,copy
import numpy as np
CT={5120:'i1',5121:'u1',5122:'<i2',5123:'<u2',5125:'<u4',5126:'<f4'}
NC={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}
def load(path):
 b=path.read_bytes();assert b[:4]==b'glTF';n=struct.unpack_from('<I',b,12)[0];g=json.loads(b[20:20+n]);off=20+n;ln=struct.unpack_from('<I',b,off)[0];return g,b[off+8:off+8+ln]
def accessor(g,b,i):
 a=g['accessors'][i];nc=NC[a['type']];dt=CT[a['componentType']];sz=np.dtype(dt).itemsize
 if 'bufferView' in a:
  v=g['bufferViews'][a['bufferView']];x=np.ndarray((a['count'],nc),dtype=dt,buffer=b,offset=v.get('byteOffset',0)+a.get('byteOffset',0),strides=(v.get('byteStride',sz*nc),sz)).copy()
 else:x=np.zeros((a['count'],nc),dtype=dt)
 if 'sparse' in a:
  s=a['sparse'];ii=s['indices'];vv=s['values'];iv=g['bufferViews'][ii['bufferView']];vb=g['bufferViews'][vv['bufferView']];ix=np.frombuffer(b,dtype=CT[ii['componentType']],count=s['count'],offset=iv.get('byteOffset',0)+ii.get('byteOffset',0));val=np.frombuffer(b,dtype=dt,count=s['count']*nc,offset=vb.get('byteOffset',0)+vv.get('byteOffset',0)).reshape(-1,nc);x[ix]=val
 return x
class Writer:
 def __init__(self,template):
  self.g=copy.deepcopy(template);self.g['accessors']=[];self.g['bufferViews']=[];self.g['buffers']=[];self.bin=bytearray()
 def view(self,data,target=None):
  self.bin.extend(b'\0'*((-len(self.bin))%4));v={'buffer':0,'byteOffset':len(self.bin),'byteLength':len(data)}
  if target:v['target']=target
  self.bin.extend(data);self.g['bufferViews'].append(v);return len(self.g['bufferViews'])-1
 def add(self,x,meta,sparse=False,target=None):
  x=np.ascontiguousarray(x,dtype=CT[meta['componentType']]);a={k:copy.deepcopy(meta[k]) for k in ['componentType','type','normalized','min','max','name'] if k in meta};a['count']=len(x)
  if sparse:
   # Preserve signed zero and every authored float32 bit, not only numeric value.
   ix=np.flatnonzero(np.any(x.view(np.uint8).reshape(len(x),-1)!=0,axis=1));denseBytes=x.nbytes;it=5123 if len(x)<=65535 else 5125
   if len(ix) and len(ix)*(x.shape[1]*x.dtype.itemsize+np.dtype(CT[it]).itemsize)<denseBytes:
    a['sparse']={'count':len(ix),'indices':{'bufferView':self.view(ix.astype(CT[it]).tobytes()),'componentType':it},'values':{'bufferView':self.view(x[ix].tobytes())}}
   elif len(ix):a['bufferView']=self.view(x.tobytes(),target)
  else:a['bufferView']=self.view(x.tobytes(),target)
  self.g['accessors'].append(a);return len(self.g['accessors'])-1
 def write(self,path):
  self.g['buffers']=[{'byteLength':len(self.bin)}];js=json.dumps(self.g,separators=(',',':'),ensure_ascii=False).encode();js+=b' '*((-len(js))%4);bi=bytes(self.bin);bi+=b'\0'*((-len(bi))%4);out=struct.pack('<4sII',b'glTF',2,28+len(js)+len(bi))+struct.pack('<II',len(js),0x4e4f534a)+js+struct.pack('<II',len(bi),0x004e4942)+bi;path.write_bytes(out)
def mesh_by_node(g):return {n['name']:g['meshes'][n['mesh']] for n in g['nodes'] if 'mesh' in n}
