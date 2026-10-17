from pathlib import Path
import json,hashlib,sys
import numpy as np
from PIL import Image
from face_library import STATES
P=Path(__file__).resolve().parent;ROOT=P.parent
spec=json.loads((P/'library-array-spec.json').read_text())
def source(st,t,view):
 if st=='Basis':st='01';t=0
 group,prefix=spec['where'][st]
 if group=='r6':return ROOT/'bubu-3d-a-face-coordinate-v2-20261016/candidate-a05-selected-faces-r6-review'/f'face-{st}-{t:.2f}-{view}.png'
 return ROOT/f'bubu-3d-a-basic-face-{group}-20261016'/f'basic-{st}-{t:.2f}-{view}.png'
rows=[]
for p in sorted((P/'renders').glob('*.png')):
 st,t,view=p.stem.split('-');t=float(t);s=source(st,t,view)
 if not s.is_file():raise ValueError(str(s))
 a=np.asarray(Image.open(p).convert('RGBA')).astype(int);b=np.asarray(Image.open(s).convert('RGBA')).astype(int)
 if a.shape!=b.shape:raise ValueError((p,a.shape,b.shape))
 d=np.abs(a-b);rows.append({'state':st,'intensity':t,'view':view,'render':str(p.relative_to(P)),'source':str(s.relative_to(ROOT)),'sourceSHA256':hashlib.sha256(s.read_bytes()).hexdigest(),'renderSHA256':hashlib.sha256(p.read_bytes()).hexdigest(),'pixelExact':bool(np.array_equal(a,b)),'maxChannelDifference':int(d.max()),'differentPixels':int(np.any(d,axis=2).sum()),'meanChannelDifference':float(d.mean())})
out={'scope':'actual merged Blender authoring-scene renders, fixed source look/camera/resolution/seed; canonical GLB source arrays audited separately','expectedFrames':104,'actualFrames':len(rows),'complete':len(rows)==104,'allPixelsExact':all(r['pixelExact'] for r in rows),'frames':rows}
(P/'RENDER-PARITY.json').write_text(json.dumps(out,indent=2));print({k:v for k,v in out.items() if k!='frames'});print([r for r in rows if not r['pixelExact']][:5])
