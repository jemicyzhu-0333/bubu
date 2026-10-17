from pathlib import Path
import sys,types,importlib.util,json,hashlib
P=Path(__file__).resolve().parent;sys.path.insert(0,str(P));from face_library import face_weights;from compose_gold import GROUPS
sys.modules['bpy']=types.SimpleNamespace()
rows=[]
for group,(glb,states,prefix) in GROUPS.items():
 path=glb.parent/('selected_face_utils.py' if group=='r6' else'basic_face_utils.py');spec=importlib.util.spec_from_file_location('source_'+group,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);fn=m.selected_weights if group=='r6' else m.basic_weights
 for state in states:
  for i in range(257):
   t=i/256;a={k:v for k,v in fn(state,t).items() if v};b={k:v for k,v in face_weights(state,t).items() if v};assert a==b,(state,t,a,b)
  rows.append({'state':state,'sourceMapper':str(path),'sourceSHA256':hashlib.sha256(path.read_bytes()).hexdigest(),'validIntensitySamples':257,'weightsExact':True})
(P/'MAPPER-SOURCE-PARITY.json').write_text(json.dumps({'validInputSamples':sum(r['validIntensitySamples'] for r in rows),'states':rows,'passed':True,'intentionalValidationChange':'new strict mapper rejects nonfinite/out-of-range/type-invalid values rather than old clamping; valid0..1 weights remain exact'},indent=2));print('SOURCE_MAPPER_PARITY',len(rows)*257)
