"""Compose current approved semantic targets without lossy re-export.
Frozen source GLBs are read-only. Array bundle permits standalone exact rebuild.
"""
from pathlib import Path
import sys,json,copy,hashlib,numpy as np
from glb_io import load,accessor,Writer,mesh_by_node
P=Path(__file__).resolve().parent;ROOT=P.parent
R6=ROOT/'bubu-3d-a-face-coordinate-v2-20261016/candidate-a05-selected-faces-r6-review/bubu-a05-selected-faces.glb'
GROUPS={'r6':(R6,['01','04','07','08'],'Face')}
for i,states in enumerate([['D1','N2','P2'],['R0','A7','S2'],['N3','T05'],['A4','A8','D4'],['T5','S3','S5']],1):GROUPS[f'batch{i}']=(ROOT/f'bubu-3d-a-basic-face-batch{i}-20261016'/f'bubu-a05-basic-batch{i}.glb',states,'Basic')
STATE_ORDER=['R0','D1','A7','D4','01','N2','N3','T05','07','P2','08','A4','04','A8','S2','S3','T5','S5']
SLICE=['04','N3','A7','07','S5','R0','N2']
FACE=['A_eye_L','A_eye_R','A_eye_highlight_L','A_eye_highlight_R','A_mouth_ring','A_brow_L','A_brow_R','A_tongue']
H=lambda x:hashlib.sha256(x).hexdigest()
def collect():
 sources={};where={}
 for key,(path,states,prefix) in GROUPS.items():
  g,b=load(path);sources[key]=(g,b,mesh_by_node(g));
  for st in states:where[st]=(key,prefix)
 bg,bb,bm=sources['batch3'];template=copy.deepcopy(bg);template['asset']={'version':'2.0','generator':'Bubu approved shared-basis library composer1.0.0'}
 assert not any(k in template for k in ['images','textures','animations'])
 arrays={};spec={'template':template,'states':STATE_ORDER,'sliceStates':SLICE,'faceRoster':FACE,'base':{},'skin':[],'targets':{},'sourceHashes':{k:H(p.read_bytes()) for k,(p,_,_) in GROUPS.items()},'where':where}
 for name,m in bm.items():
  assert len(m['primitives'])==1;p=m['primitives'][0];spec['base'][name]={}
  for sem,i in {**p['attributes'],'indices':p['indices']}.items():
   key=f'base__{name}__{sem}';arrays[key]=accessor(bg,bb,i);spec['base'][name][sem]={'array':key,'meta':bg['accessors'][i]}
 for j,s in enumerate(bg['skins']):
  i=s['inverseBindMatrices'];key=f'skin_{j}';arrays[key]=accessor(bg,bb,i);spec['skin'].append({'array':key,'meta':bg['accessors'][i]})
 for st in STATE_ORDER:
  sk,prefix=where[st];g,b,mm=sources[sk];spec['targets'][st]={}
  for name in FACE:
   spec['targets'][st][name]={};count=len(arrays[f'base__{name}__POSITION'])
   for ki in range(1,9):
    tn=f'{prefix}{st}_{ki:02}';target=None
    if name in mm:
     names=mm[name].get('extras',{}).get('targetNames',[])
     if tn in names:target=mm[name]['primitives'][0]['targets'][names.index(tn)]
    row={'sourceTarget':tn,'fillReason':None if target is not None else 'source layer/target absent; explicit zero-delta at shared hidden Basis','attributes':{}}
    for sem in ['POSITION','NORMAL']:
     key=f'{st}__{name}__{ki:02}__{sem}';x=accessor(g,b,target[sem]) if target is not None and sem in target else np.zeros((count,3),dtype='<f4');assert x.shape==(count,3)
     arrays[key]=x;row['attributes'][sem]={'array':key,'sha256':H(x.tobytes()),'allZero':not bool(np.any(x))}
    spec['targets'][st][name][tn]=row
 spec['template']['extras']={**spec['template'].get('extras',{}),'bubuLibrary':'approved-static-v1','semanticSlotCount':18,'approvalMessageID':'Sentinel_fa6cf24f4da88191b7c704f6355aa0a0','historicalTargets':'original archives only; current formal library excludes superseded Face05 and legacy S/B/C'}
 np.savez_compressed(P/'library-arrays.npz',**arrays);(P/'library-array-spec.json').write_text(json.dumps(spec,indent=2));return spec,arrays
def pack(spec,arrays,states,path):
 w=Writer(spec['template']);g=w.g;names=[]
 for st in states:
  prefix=spec['where'][st][1];names.extend(f'{prefix}{st}_{i:02}' for i in range(1,9))
 for node in g['nodes']:
  if 'mesh' not in node:continue
  name=node['name'];m=g['meshes'][node['mesh']];p=m['primitives'][0]
  for sem,a in spec['base'][name].items():
   i=w.add(arrays[a['array']],a['meta'],target=34963 if sem=='indices' else 34962)
   if sem=='indices':p['indices']=i
   else:p['attributes'][sem]=i
  if name in spec['faceRoster']:
   m['extras']={**m.get('extras',{}),'targetNames':names.copy()};m['weights']=[0.]*len(names);p['targets']=[]
   if 'weights' in node:node['weights']=[0.]*len(names)
   for st in states:
    for tn,row in spec['targets'][st][name].items():
     tt={}
     for sem,ar in row['attributes'].items():
      x=arrays[ar['array']];meta={'componentType':5126,'type':'VEC3'}
      if sem=='POSITION':meta.update(min=x.min(axis=0).tolist(),max=x.max(axis=0).tolist())
      tt[sem]=w.add(x,meta,sparse=True,target=34962)
     p['targets'].append(tt)
  else:assert not p.get('targets')
 for skin,a in zip(g['skins'],spec['skin']):skin['inverseBindMatrices']=w.add(arrays[a['array']],a['meta'])
 g['extras']['activeSemanticStates']=states;g['extras']['semanticSlotCount']=len(states)
 for n in g['nodes']:
  if n.get('name')=='A_reference_root':n.setdefault('extras',{})['new_basic_faces']='Current approved static library states: '+','.join(states)+'; original candidate archives preserved'
 w.write(path)
 return {'file':path.name,'sha256':H(path.read_bytes()),'bytes':path.stat().st_size,'meshes':len(g['meshes']),'accessors':len(g['accessors']),'bufferViews':len(g['bufferViews']),'morphTargetsPerFaceMesh':len(names),'scalarCount':sum(a['count']*{'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}[a['type']] for a in g['accessors']),'indicesCount':sum(a['count'] for m in g['meshes'] for p in m['primitives'] for a in [g['accessors'][p['indices']]]),'states':states}
if __name__=='__main__':
 if '--rebuild' in sys.argv:spec=json.loads((P/'library-array-spec.json').read_text());arrays=dict(np.load(P/'library-arrays.npz'))
 else:spec,arrays=collect()
 out=[pack(spec,arrays,spec['states'],P/'bubu-expression-library-v1.glb'),pack(spec,arrays,spec['sliceStates'],P/'bubu-expression-slice7.glb')];(P/'BUILD-MANIFEST.json').write_text(json.dumps(out,indent=2));print(json.dumps(out,indent=2))
