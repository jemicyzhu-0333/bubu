from pathlib import Path
import json,hashlib,numpy as np
from glb_io import load,accessor,mesh_by_node
from compose_gold import GROUPS,FACE
P=Path(__file__).resolve().parent;spec=json.loads((P/'library-array-spec.json').read_text());report={};H=lambda x:hashlib.sha256(x).hexdigest()
sources={}
for key,(path,_,_) in GROUPS.items():g,b=load(path);sources[key]=(g,b,mesh_by_node(g))
for file in ['bubu-expression-library-v1.glb','bubu-expression-slice7.glb']:
 path=P/file;g,b=load(path);mm=mesh_by_node(g);states=g['extras']['activeSemanticStates'];out={'sha256':H(path.read_bytes()),'baseChecks':[],'targetChecks':[],'zeroFills':[],'rigChecks':{},'materialsExact':g['materials']==sources['batch3'][0]['materials']};bg,bb,bm=sources['batch3'];
 for name,m in mm.items():
  p=m['primitives'][0];bp=bm[name]['primitives'][0]
  for sem,i in {**p['attributes'],'indices':p['indices']}.items():
   j=bp['indices'] if sem=='indices' else bp['attributes'][sem];x=accessor(g,b,i);y=accessor(bg,bb,j);row={'mesh':name,'attribute':sem,'numericExact':np.array_equal(x,y),'bitExact':x.tobytes()==y.tobytes(),'sha256':H(x.tobytes())};out['baseChecks'].append(row)
  if name=='A_mochi_skin':assert not p.get('targets');continue
  assert len(m['weights'])==len(states)*8 and all(w==0 for w in m['weights']);names=m['extras']['targetNames']
  for st in states:
   sk,prefix=spec['where'][st];sg,sb,sm=sources[sk]
   for k in range(1,9):
    tn=f'{prefix}{st}_{k:02}';target=p['targets'][names.index(tn)];sourceTarget=None
    if name in sm and tn in sm[name].get('extras',{}).get('targetNames',[]):sourceTarget=sm[name]['primitives'][0]['targets'][sm[name]['extras']['targetNames'].index(tn)]
    for sem,i in target.items():
     x=accessor(g,b,i);y=accessor(sg,sb,sourceTarget[sem]) if sourceTarget and sem in sourceTarget else np.zeros_like(x);row={'state':st,'mesh':name,'target':tn,'attribute':sem,'source':sk,'numericExact':bool(np.array_equal(x,y)),'bitExact':x.tobytes()==y.tobytes(),'sourceSHA256':H(y.tobytes()),'outputSHA256':H(x.tobytes())};out['targetChecks'].append(row)
     if sourceTarget is None:out['zeroFills'].append({'state':st,'mesh':name,'target':tn,'attribute':sem,'explicitPositiveZero':bool(np.all(x.view(np.uint32)==0))})
 # The template's rig/hierarchy/transforms are preserved; metadata strings are inert and intentionally current.
 bn={n['name']:n for n in bg['nodes']};gn={n['name']:n for n in g['nodes']}
 for name,n in bn.items():
  for key in ['translation','rotation','scale','matrix','children','skin']:
   out['rigChecks'][name+':'+key]=n.get(key)==gn[name].get(key)
 for i,(s,bs) in enumerate(zip(g['skins'],bg['skins'])):
  out['rigChecks'][f'skin{i}:joints']=s['joints']==bs['joints'];out['rigChecks'][f'skin{i}:inverseBind']=accessor(g,b,s['inverseBindMatrices']).tobytes()==accessor(bg,bb,bs['inverseBindMatrices']).tobytes()
 out['allSourceArraysBitExact']=all(x['bitExact'] for x in out['baseChecks']+out['targetChecks']);out['allZeroFillExact']=all(x['explicitPositiveZero'] for x in out['zeroFills']);out['allRigExact']=all(out['rigChecks'].values());out['allAccessorsFinite']=all(np.isfinite(accessor(g,b,i)).all() for i in range(len(g['accessors'])));out['defaultsAllZero']=all(all(v==0 for v in m.get('weights',[])) for m in g['meshes']);out['passed']=all(out[k] for k in ['allSourceArraysBitExact','allZeroFillExact','allRigExact','allAccessorsFinite','defaultsAllZero','materialsExact']);assert out['passed'];report[file]=out;print(file,'BIT_EXACT',len(out['baseChecks']),len(out['targetChecks']),'ZERO_FILL',len(out['zeroFills']))
(P/'SOURCE-TO-OUTPUT-AUDIT.json').write_text(json.dumps(report,indent=2));
# Strict mapper fixtures are an oracle for the separately implemented runtime adapter.
from face_library import STATES,ROSTER,ALL_TARGETS,face_weights,names
fixtures=[]
for st in STATES:
 for i in range(257):
  a=i/256;w=face_weights(st,a);nz={k:v for k,v in w.items() if v};assert len(nz)<=2 and set(nz).issubset(names(st));assert all(0<=v<=1 for v in w.values());assert sum(w.values())<=1+1e-15
  if a==0:assert not nz
  fixtures.append({'state':st,'intensity':a,'nonzero':nz})
invalid=[]
for st,a in [(None,1),('05',1),('bogus',0),('01',float('nan')),('01',float('inf')),('01',-.01),('01',1.01),('01',True),('01','1')]:
 try:face_weights(st,a);raise AssertionError('invalid accepted')
 except ValueError:invalid.append(str((st,a)))
(P/'mapping-fixtures.json').write_text(json.dumps({'sampleCount':len(fixtures),'faceRoster':ROSTER,'allTargets':ALL_TARGETS,'fixtures':fixtures,'invalidInputsRejected':invalid,'passed':True},indent=2));print('MAPPER',len(fixtures),'PASSED')
