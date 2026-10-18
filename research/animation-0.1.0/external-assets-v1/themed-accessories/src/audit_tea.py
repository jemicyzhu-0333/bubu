import json,sys,importlib.util,hashlib
from pathlib import Path
import numpy as np
from portable_paths import P,R,ASSET,COLLISION;spec=importlib.util.spec_from_file_location('collision',COLLISION);mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
asset_hashes={f.name:hashlib.sha256(f.read_bytes()).hexdigest() for f in (ASSET/'models').glob('*.glb') if 'before-' not in f.name};clear_only='--clear-items-only' in sys.argv;full='--full' in sys.argv;d=json.loads((R/('tea/reports/normal-30fps-compact.json' if full else 'tea/reports/keyframes-compact.json')).read_text());sd=json.loads((P/'review/combined-static.json').read_text());static=sd['frames'][0]['meshes'];acc=[m for m in static if m['name'].startswith(('cap_','fin_','wings_','plum_'))];inverse=np.linalg.inv(np.array(sd['sourceToWorld']).reshape(4,4).T);
for m in acc:
 v=np.array(m['positions']).reshape(-1,3);m['positions']=(v@inverse[:3,:3].T+inverse[:3,3]).ravel().tolist()
capes=[m for m in acc if m['name'].startswith(('cap_','fin_','wings_') if clear_only else ('cap_','fin_','wings_','plum_'))];colliders=[(m['name'],mod.Triangles(np.array(m['positions']).reshape(-1,3),np.array(m['indices']).reshape(-1,3))) for m in capes];report=[];frames=[]
for f in d['frames']:
 item={'time':f['time'],'phase':f['label'],'intersections':{}};meshes=[]
 for m0 in f['meshes']:
  m={**d['sharedMeshes'].get(m0['name'],{}),**m0};
  meshes.append(m)
  if m['name'].startswith(('Bubu_hand','Sip_')) and m.get('opacity',1)>0:
   v=np.array(m['positions']).reshape(-1,3) if 'positions' in m else np.fromfile(m['positionsFile'],dtype='<f4').reshape(-1,3);t=v[np.array(m['indices']).reshape(-1,3)]
   for name,c in colliders:
    count=len(c.intersections(t))
    if count:item['intersections'][m['name']+'/'+name]=count
 report.append(item)
 if f['time'] in [0,1.5,2,3.4,4.8,6.2,7.5]:frames.append({**f,'meshes':meshes+acc})
(P/('reports/tea-collision-full-clear-items.json' if clear_only else 'reports/tea-collision-full.json' if full else 'reports/tea-collision.json')).write_text(json.dumps({'accessoryModelSHA256':asset_hashes,'testedKinds':['cap','fin','wings'] if clear_only else ['cap','fin','wings','plum'],'coordinateProof':'reports/tea-coordinate-proof.json','scope':'Actual tea '+str(len(d['frames']))+' sampled frames; triangle edge intersections, not continuous collision or cloth simulation','frames':report,'allSampledClear':all(not r['intersections'] for r in report)},indent=2));(P/'review/tea-combined.json').write_text(json.dumps({'sourceGLB':d['sourceGLB'],'frames':frames}));print(json.dumps(report,indent=2))
