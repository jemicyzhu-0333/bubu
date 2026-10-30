import json,numpy as np,importlib.util,hashlib
from pathlib import Path
from scipy.spatial.transform import Rotation
R=Path('/workspace/bubu/research/animation-0.1.0')
D=R/'animation-foundation-v1/integration/diagnostics/contact-contract-20261019'
spec=importlib.util.spec_from_file_location('collision',D/'triangle-collision.py'); col=importlib.util.module_from_spec(spec);spec.loader.exec_module(col)
data=json.loads((D/'inputs/tea-keyframes.json').read_text());motion=json.loads((D/'motion.json').read_text());config=json.loads((R/'original-parts-hybrid-v1/tea/inputs/rigid-config.json').read_text());cape=json.loads((D/'frozen-cape.json').read_text())
parts={p['name']:col.Triangles(np.array(p['positions']).reshape(-1,3),np.array(p['indices']).reshape(-1,3)) for p in cape['parts']}
rows=[]
for t in [1.5,3.4]:
 for short,name in [('handL','Bubu_hand-left'),('handR','Bubu_hand-right')]:
  f=next(f for f in data['frames'] if f['time']==t);m=next(m for m in f['meshes'] if m['name']==name);pos=np.fromfile(D/m['positionsFile'],dtype='<f4').reshape(-1,3).astype(float);idx=np.array(data['sharedMeshes'][name]['indices']).reshape(-1,3)
  matrix=np.array(next(m for m in motion if m['time']==t)['matrices'][short]).reshape(4,4).T
  root=matrix[:3,:3]@config['hands'][short]['root']+matrix[:3,3];grip=matrix[:3,:3]@config['hands'][short]['gripSource']+matrix[:3,3]
  # Hold shifts cup and both grip targets together by .012 to clear the clasp;
  # sip/lip endpoint unchanged. This is a candidate, not approved choreography.
  shift=np.array([0.,0.,.012 if t==1.5 else 0.]); tried=0;passing=[];best=None
  for rx in range(-120,121,15):
   for ry in range(-60,61,15):
    for rz in range(-90,91,15):
     rot=Rotation.from_euler('xyz',[rx,ry,rz],degrees=True).as_matrix();newroot=(root-grip)@rot.T+grip+shift
     radius=np.interp(newroot[1],config['carrier']['height'],config['carrier']['radius'])
     radial=(abs(newroot[0])**config['exponent']+abs(newroot[2]/config['depth'])**config['exponent'])**(1/config['exponent'])
     gap=radial-radius
     if not (.4<=newroot[1]<=.9 and -.1<=gap<=.015):continue
     v=(pos-grip)@rot.T+grip+shift; tri=v[idx]; tried+=1
     hits={n:len(p.intersections(tri)) for n,p in parts.items()};total=sum(hits.values())
     item={'eulerDegrees':[rx,ry,rz],'root':newroot.tolist(),'rootShift':float(np.linalg.norm(newroot-root)),'proxyRootRadialGap':float(gap),'surfacePairs':hits,'total':total}
     if best is None or total<best['total']:best=item
     if total==0:passing.append(item)
  passing.sort(key=lambda p:p['rootShift'])
  row={'time':t,'hand':name,'tried':tried,'surfaceClearCandidates':passing[:20],'clearCandidateCount':len(passing),'minimumPairs':best};rows.append(row)
  print(json.dumps(row),flush=True)
report={'scope':'Exploratory larger rigid endpoint refits preserving source grip point with coordinated .012 forward hold shift. Coarse carrier root filter only; NO anatomical, containment, full cup-contact, transition or visual approval. Grid search failure is not infeasibility proof.', 'accepted':False,'rows':rows,'sourceSHA256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
Path('/tmp/bubu-larger-endpoint-probe.json').write_text(json.dumps(report,indent=2))
