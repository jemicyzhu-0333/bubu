"""Read-only final-stage source omission checks. Never edits production artwork."""
import json, hashlib
from pathlib import Path
from PIL import Image
import numpy as np
root=Path(__file__).resolve().parents[3]/'evidence-production'
actual=json.loads((root/'actual/records.json').read_text())['records']; failures=[]; checks=[]
def data(folder,name):return np.array(Image.open(root/folder/(name+'.png')).convert('RGBA'))
for folder in sorted(root.glob('omit-*')):
 if folder.name.endswith('-dense') or '-dpr' in folder.name:continue
 payload=json.loads((folder/'records.json').read_text());target=payload['omit']; omitted={r['name']:r for r in payload['records']}
 for r in actual:
  name=r['name'];o=omitted[name];a,b=data('actual',name),data(folder.name,name)
  changed=int(np.any(a!=b,axis=2).sum());resource=r['resources'].get(target,{})
  selected=resource.get('drawCount',0)>0
  if r['inputSha256']!=o['inputSha256']:failures.append('input mismatch '+name)
  # Anatomy is legitimately fully hidden by torso, and some garment sources can be selected under an opaque body.
  subpixel_fade = name.startswith('halloween-') and name.endswith('-7199') and target in ['palm','pumpkin','ghost']
  if selected and target!='feet' and not changed and not subpixel_fade:failures.append('zero selected contribution '+target+' '+name)
  if not selected and changed:failures.append('unselected source changes output '+target+' '+name)
  checks.append({'target':target,'case':name,'changedPixels':changed,'selected':selected,'quantizedFade':subpixel_fade,'drawCount':resource.get('drawCount',0),'inputSha256':r['inputSha256'],'actualSha256':r['pngSha256'],'omittedSha256':o['pngSha256']})
feet=[];face=[]
for at in [0,1000,2400,3800,5700,6800,7199,'off']:
 bare=f'halloween-bare-front-{at}';dressed=f'halloween-dressed-front-{at}'
 a,b=data('actual',bare),data('omit-feet',bare);d,df=data('actual',dressed),data('omit-feet',dressed)
 visible=np.any(a!=b,axis=2)&(a[:,:,3]==255)
 differing=int((visible&np.any(a!=d,axis=2)).sum());contribution=int((visible&np.any(d!=df,axis=2)).sum())
 feet.append({'at':at,'bareOpaqueVisibleFootPixels':int(visible.sum()),'dressedFootContributionPixels':contribution,'differingFromBare':differing})
 if differing or contribution==0:failures.append('cape changes visible opaque feet '+str(at))
 # Protected eye/mouth rectangle (original eye-right edge 52.036 plus >1 unit clearance; cheek outside is not an eye) in canonical 66-unit art space, same final stage transform.
 g=data('omit-ghost',dressed);delta=np.any(d!=g,axis=2);protected=delta[180:261,150:280]
 face.append({'at':at,'ghostPixelsInsideProtectedFace':int(protected.sum())})
 if protected.any():failures.append('ghost intersects protected face '+str(at))
dense=[]
for r in json.loads((root/'actual-dense/records.json').read_text())['records']:
 if not r['name'].startswith('dense-'):continue
 a,b=data('actual-dense',r['name']),data('omit-ghost-dense',r['name']);delta=np.any(a!=b,axis=2);n=int(delta[180:261,150:280].sum());dense.append({'at':r['at'],'ghostPixelsInsideProtectedFace':n})
 if n:failures.append('dense ghost intersects eyes/mouth '+str(r['at']))
result={'denseFace':dense,'scope':'Actual registered application renderer, same immutable frame input, target decoded transparent at source; full final-stage PNG comparisons','cases':len(actual),'omissionChecks':len(checks),'visibleChecks':sum(x['selected'] for x in checks),'failures':failures,'feet':feet,'face':face,'checks':checks}
(root/'production-pixel-audit.json').write_text(json.dumps(result,indent=2));print(json.dumps({k:v for k,v in result.items() if k!='checks'},indent=2));raise SystemExit(bool(failures))
