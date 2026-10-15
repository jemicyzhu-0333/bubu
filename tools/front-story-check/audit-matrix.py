"""Final-stage geometry and grip contribution across supported diagnostic DPR/facing."""
from pathlib import Path
import json
import numpy as np
from PIL import Image
root=Path(__file__).resolve().parents[3]/'evidence-production';rows=[];failures=[]
def pixels(folder,name):return np.array(Image.open(root/folder/(name+'.png')).convert('RGBA'))
for folder in sorted(root.glob('actual-dpr*')):
 actual=json.loads((folder/'records.json').read_text())['records'];suffix=folder.name.removeprefix('actual')
 for a in actual:
  im=pixels(folder.name,a['name']);edge=int(sum(np.count_nonzero(x) for x in [im[0,:,3],im[-1,:,3],im[:,0,3],im[:,-1,3]]))
  if edge:failures.append('clipped stage edge '+folder.name+' '+a['name'])
  for target in ['palm','pumpkin']:
   control='omit-'+target+suffix;omitted={r['name']:r for r in json.loads((root/control/'records.json').read_text())['records']};b=omitted[a['name']]
   changed=int(np.any(im!=pixels(control,a['name']),axis=2).sum());draw=a['resources'][target]['drawCount'];hidden=a['name'].endswith('-7199')
   if a['inputSha256']!=b['inputSha256'] or a['poseSha256']!=b['poseSha256']:failures.append('input/pose mismatch')
   if draw and not hidden and not changed:failures.append('missing grip/lantern '+folder.name+' '+a['name']+' '+target)
   if not draw and changed:failures.append('inactive source changes frame')
   rows.append({'variant':suffix,'case':a['name'],'target':target,'drawCount':draw,'changedPixels':changed,'edgePixels':edge})
result={'variants':len(list(root.glob('actual-dpr*'))),'frames':len(rows)//2,'sourceOmissionComparisons':len(rows),'visibleRows':sum(x['changedPixels']>0 for x in rows),'failures':failures,'rows':rows};(root/'production-matrix-audit.json').write_text(json.dumps(result,indent=2));print(json.dumps({k:v for k,v in result.items() if k!='rows'}));raise SystemExit(bool(failures))
