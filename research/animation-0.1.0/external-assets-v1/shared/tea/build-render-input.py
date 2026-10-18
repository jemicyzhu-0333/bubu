import json,hashlib,argparse
from pathlib import Path
import numpy as np
from scipy.spatial.transform import Rotation
parser=argparse.ArgumentParser();parser.add_argument('--reference-root',type=Path,required=True);parser.add_argument('--cache-root',type=Path,required=True);args=parser.parse_args();args.hybrid=True;P=args.cache_root.resolve()/'tea';S=args.cache_root.resolve()/'hybrid-inputs';package=args.reference_root.resolve()/'research/animation-0.1.0/original-parts-hybrid-v1';asset=package/'geometry/bubu-hybrid-binding.glb';I=package/'tea/inputs';O=P/'reports/frames';O.mkdir(parents=True,exist_ok=True)
samples=json.loads((P/'reports/samples.json').read_text())['normal'];face=json.loads((P/'reports/face-sequence.json').read_text())['frames'];names={'body':'Bubu_body','handL':'Bubu_hand-left','handR':'Bubu_hand-right','footL':'Bubu_foot-left','footR':'Bubu_foot-right'};parts={}
for name,mname in names.items():
 d=np.load(S/((mname if args.hybrid else name)+'.npz'));color=d['COLOR_0'];color=np.c_[color,np.ones(len(color))] if color.shape[1]==3 else color
 parts[name]=(d,{'name':mname,'indices':d['triangles'].ravel().tolist(),'colors':color.ravel().tolist()})
 if name not in ['handL','handR']:
  for key,label in [('POSITION','positionsFile'),('NORMAL','normalsFile')]:
   path=O/f'{name}-{key}.bin';d[key].astype('<f4').tofile(path);parts[name][1][label]=str(path)
sip=json.loads((I/'sip-fit.json').read_text());cup=json.loads((I/'sip-cup-meshes.json').read_text());local=[]
for mesh in cup['meshes']:
 v=(np.array(mesh['positions']).reshape(-1,3)-sip['cupCenter'])@np.array(sip['cupRotation']);template={k:value for k,value in mesh.items() if k!='positions'};local.append((v,template))
frames=[]
for i,s in enumerate(samples):
 meshes=[]
 for name,(d,template) in parts.items():
  m=template.copy()
  if name in s['matrices']:
   mat=np.array(s['matrices'][name]).reshape(4,4).T
   for key,label in [('POSITION','positionsFile'),('NORMAL','normalsFile')]:
    v=d[key]@mat[:3,:3].T+(mat[:3,3] if key=='POSITION' else 0);path=O/f'{name}-{i:03}-{key}.bin';v.astype('<f4').tofile(path);m[label]=str(path)
  meshes.append(m)
 meshes.extend(face[i]['meshes']);r=Rotation.from_quat(s['cup']['quaternion']).as_matrix();c=np.array(s['cup']['center'])
 for v,template in local:
  m=template.copy();w=v*s['cup']['scale']@r.T+c;path=O/f'{m["name"]}-{i:03}.bin';w.astype('<f4').tofile(path);m['positionsFile']=str(path);m['opacity']=s['cup']['opacity'];meshes.append(m)
 frames.append({'time':s['time'],'label':s['phase'],'meshes':meshes,'faceState':face[i]['faceState']})
source=str((args.reference_root.resolve()/'research/animation-0.1.0/runtime-facepath05/fixtures/face-d2/asset.glb').resolve());common={'sourceGLB':source,'candidateSHA256':hashlib.sha256(asset.read_bytes()).hexdigest(),'asset':str(asset),'binding':'hybrid source-native body/feet at stationary rest; rigid source hands' if args.hybrid else 'static five-part baseline','scope':'Actual immutable source hand vertices under rigid matrices; approved existing face owner; candidate body/feet at stationary rest; no heightfield reconstruction'}
# Shared immutable index/color arrays keep renderer input small.
shared={}
for frame in frames:
 for mesh in frame['meshes']:
  shared.setdefault(mesh['name'],{k:v for k,v in mesh.items() if k in ['name','indices','colors','materialColor']})
compact=[{**frame,'meshes':[{k:v for k,v in mesh.items() if k not in ['indices','colors','materialColor']} for mesh in frame['meshes']]} for frame in frames]
for file,selected in [('normal-30fps-compact.json',compact),('keyframes-compact.json',[compact[i] for i in [0,18,36,45,60,81,102,123,144,165,186,198,207,225,243,270]])]:
 with (P/'reports'/file).open('w') as f:json.dump({**common,'sharedMeshes':shared,'frames':selected},f,separators=(',',':'))
print('Prepared',len(frames),'frames and 16 keyframes with shared mesh attributes')
