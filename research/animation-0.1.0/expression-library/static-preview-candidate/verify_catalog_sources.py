"""Read-only catalog/identity check of independently reviewed expression sources.
Does not merge meshes, rewrite source assets, or enable runtime.
"""
from pathlib import Path
import json,struct,hashlib,os,numpy as np
P=Path(__file__).resolve().parent
ROOT=Path(os.environ['BUBU_ARCHIVE_ROOT']).resolve()
R6=ROOT/'approved-assets/r6'
sources={'r6':(R6/'bubu-a05-selected-faces.glb',['01','04','07','08'],'Face')}
for i,states in enumerate([['D1','N2','P2'],['R0','A7','S2'],['N3','T05'],['A4','A8','D4'],['T5','S3','S5']],1):sources[f'batch{i}']=(ROOT/'expression-assets'/f'basic-batch{i}-candidate'/f'bubu-a05-basic-batch{i}.glb',states,'Basic')
def load(p):
 b=p.read_bytes();n=struct.unpack_from('<I',b,12)[0];g=json.loads(b[20:20+n]);off=20+n;ln=struct.unpack_from('<I',b,off)[0];return g,b[off+8:off+8+ln]
def array(g,b,i):
 a=g['accessors'][i];n={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}[a['type']];dt={5120:'i1',5121:'u1',5122:'<i2',5123:'<u2',5125:'<u4',5126:'<f4'}[a['componentType']];size=np.dtype(dt).itemsize
 if 'bufferView' in a:
  v=g['bufferViews'][a['bufferView']];x=np.ndarray((a['count'],n),dtype=dt,buffer=b,offset=v.get('byteOffset',0)+a.get('byteOffset',0),strides=(v.get('byteStride',size*n),size)).copy()
 else:x=np.zeros((a['count'],n),dtype=dt)
 if 'sparse' in a:
  s=a['sparse'];ii=s['indices'];vv=s['values'];iv=g['bufferViews'][ii['bufferView']];vb=g['bufferViews'][vv['bufferView']];it={5121:'u1',5123:'<u2',5125:'<u4'}[ii['componentType']];ix=np.frombuffer(b,dtype=it,count=s['count'],offset=iv.get('byteOffset',0)+ii.get('byteOffset',0));vals=np.frombuffer(b,dtype=dt,count=s['count']*n,offset=vb.get('byteOffset',0)+vv.get('byteOffset',0)).reshape(-1,n);x[ix]=vals
 return x
base={};catalog={};batches={};allExact=True
for key,(path,states,prefix) in sources.items():
 g,b=load(path);sha=hashlib.sha256(path.read_bytes()).hexdigest();meshes={n['name']:g['meshes'][n['mesh']] for n in g['nodes'] if 'mesh' in n};checks={}
 for name,m in meshes.items():
  p=m['primitives'][0];data={k:array(g,b,i) for k,i in p['attributes'].items()};data['indices']=array(g,b,p['indices'])
  if name not in base:base[name]=data
  checks[name]=set(data)==set(base[name]) and all(np.array_equal(v,base[name][k]) for k,v in data.items());allExact &= checks[name]
 assert not meshes['A_mochi_skin']['primitives'][0].get('targets')
 if key=='r6':common=set(meshes)
 else:assert common.issubset(meshes)
 for st in states:
  targetNames=[f'{prefix}{st}_{i:02}' for i in range(1,9)];affected={}
  for name,m in meshes.items():
   names=m.get('extras',{}).get('targetNames',[]);found=[n for n in targetNames if n in names]
   if not found:continue
   assert found==targetNames,(key,st,name,'missing knot')
   p=m['primitives'][0];affected[name]={}
   for n in targetNames:
    t=p['targets'][names.index(n)];affected[name][n]={k:hashlib.sha256(array(g,b,i).tobytes()).hexdigest() for k,i in t.items()}
  assert all(n in affected for n in ['A_eye_L','A_eye_R','A_eye_highlight_L','A_eye_highlight_R','A_mouth_ring'])
  assert st not in catalog
  catalog[st]={'source':key,'sourceSHA256':sha,'targetNames':targetNames,'meshTargetAttributeHashes':affected,'mapping':'single semantic face, at most two adjacent authored knots; all inactive targets/layers reset to Basis'}
 batches[key]={'path':str(path.relative_to(ROOT)),'sha256':sha,'states':states,'sharedBaseExactByMesh':checks}
assert allExact and len(catalog)==18
assert len({n for r in catalog.values() for n in r['targetNames']})==144
coverage=json.loads((P/'coverage.json').read_text());rows={r['assetStateID']:r for r in coverage['rows']};assert set(catalog)==set(rows)
for st,row in catalog.items():row.update({'referenceID':rows[st]['referenceID'],'meaning':rows[st]['meaning'],'approvalStatus':rows[st]['status']})
manifest={'version':'static-library-catalog-candidate-1','runtimeEnabled':False,'mergedAssetCreated':False,'semanticSlots':18,'authoredKnotsPerFace':8,'sharedBaseExact':allExact,'bodyStoredOnceInFutureBank':True,'bodyHasMorph':False,'basisPolicy':'original approved05/r6 O-mouth neutral remains unchanged; R0 independent variant','historicalFace05':'preserved in originals, superseded by T05 for current direction','gazeImplemented':False,'crossFaceMixingApproved':False,'allMeshRoster':list(base),'faceRoster':[n for n in base if n!='A_mochi_skin'],'sources':batches,'faces':catalog,'excludedGaps':['unapproved half-awake Q1','convincing shyness','gaze','cross-face timing/interaction']}
(P/'_verification').mkdir(exist_ok=True)
(P/'_verification/source-catalog.json').write_text(json.dumps(manifest,indent=2));print('SHARED_BASE_EXACT',allExact,'STATES',len(catalog),'ROSTER',list(base))
