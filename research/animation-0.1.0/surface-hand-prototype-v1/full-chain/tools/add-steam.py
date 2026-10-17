"""Deterministic 3D vapor tubes from the same supplied scene time. No clock."""
import json,numpy as np,math
from pathlib import Path
P=Path(__file__).resolve().parent;segments=14;radial=6
ENABLED=False # rejected black-speck vapor; clean prototype omits steam
indices=[]
for i in range(segments):
 for k in range(radial):
  a=i*radial+k;b=i*radial+(k+1)%radial;c=(i+1)*radial+k;d=(i+1)*radial+(k+1)%radial;indices.extend([a,b,c,b,d,c])
for filename in json.loads((P/'geometry-manifests.json').read_text()):
 file=Path(filename);j=json.loads(file.read_text())
 if not ENABLED:
  for f in j['frames']:f['meshes']=[m for m in f['meshes'] if not m['name'].startswith('Steam_')]
  file.write_text(json.dumps(j));print(file.stem,'steam disabled',flush=True);continue
 for frameIndex,f in enumerate(j['frames']):
  f['meshes']=[m for m in f['meshes'] if not m['name'].startswith('Steam_')];rot=np.array(f['cupRotation']);center=np.array(f['cupCenter']);H=f['cupParameters']['cupHeight'];vis=f['cue']['cupOpacity'];phase=f['time']*2.1
  for k,offset in enumerate([-.045,.012,.05]):
   origin=center+rot@np.array([offset,H-.04,0]);pts=[];length=.17+.03*math.sin(phase+k*1.3)
   for i in range(segments+1):
    u=i/segments;p=origin+np.array([.014*math.sin(phase+k+u*5)*u,length*u,.03*u]);radius=.006*(1-u*.65)
    for r in range(radial):
     a=2*math.pi*r/radial;pts.append(p+np.array([radius*math.cos(a),0,radius*math.sin(a)]))
   name='Steam_'+str(k);out=file.parent/f'{file.stem}-{frameIndex:03}-{name}.bin';np.array(pts,dtype='<f4').tofile(out);m={'name':name,'positionsFile':str(out.resolve()),'opacity':.16*vis*(.70+.30*math.sin(phase+k)) *float(np.clip((f['cue']['cupScale']-.8)/.2,0,1))**2,'castsShadow':False}
   if frameIndex==0:m.update(indices=indices,materialColor=[.92,.97,1.0])
   f['meshes'].append(m)
 file.write_text(json.dumps(j));print(file.stem,flush=True)
