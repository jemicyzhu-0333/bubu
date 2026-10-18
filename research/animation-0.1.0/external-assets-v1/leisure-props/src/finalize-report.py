import json,hashlib
from pathlib import Path
from PIL import Image,ImageDraw
r=Path(__file__).resolve().parents[1];m=json.loads((r/'manifest.json').read_text());audit=json.loads((r/'reports/mount-audit.json').read_text())
for it in m['items']:
 it['status']={'design':'separate built-in imagegen concepts visually inspected; user acceptance pending','model':'editable actual 3D exported','staticMount':'original 13 actor meshes unchanged; actual contact audit passed' if next(a for a in audit['items'] if a['id']==it['id'])['staticAuditPass'] else 'BLOCKED','animation':'not in this batch','wardrobe':'pending','nativeRuntime':'pending'}
 it['sha256']=hashlib.sha256((r/it['file']).read_bytes()).hexdigest();it['renders']={a:f'renders/{it["id"]}-{a}.png' for a in ['front','quarter','side','back']};it['mountedRenders']={str(a):f'renders/mounted-{it["id"]}-{a}/0000.png' for a in [0,45,90,180]};it['provenance']='Built-in image_gen per item; then authored editable Three.js geometry, no PNG plane.'
(r/'manifest.json').write_text(json.dumps(m,indent=2))
for mounted in [False,True]:
 out=Image.new('RGB',(1536,2070),'#eeeeee');d=ImageDraw.Draw(out)
 for row,it in enumerate(m['items']):
  for col,a in enumerate([0,45,90,180] if mounted else ['front','quarter','side','back']):
   p=r/(it['mountedRenders'][str(a)] if mounted else it['renders'][a]);im=Image.open(p).convert('RGBA');out.paste(im,(384*col,414*row),im);d.text((384*col+10,414*row+389),f'{it["id"]} {a}',fill='black')
 out.save(r/'renders'/('mounted-contact-sheet.png' if mounted else 'single-model-contact-sheet.png'))
