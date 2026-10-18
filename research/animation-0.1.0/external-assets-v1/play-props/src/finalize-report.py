import json,hashlib
from pathlib import Path
from PIL import Image,ImageDraw
r=Path(__file__).resolve().parents[1];m=json.loads((r/'manifest.json').read_text());audit=json.loads((r/'reports/mount-audit.json').read_text())
for it in m['items']:
 a=next(a for a in audit['items'] if a['id']==it['id']);it['status']={'design':'separate built-in imagegen concept inspected; user acceptance pending','model':'editable real 3D exported','staticMount':'actual original 13 meshes unchanged; static contact audit passed' if a['staticAuditPass'] else 'BLOCKED','animation':'pending, not authored','wardrobe':'pending','nativeRuntime':'pending'}
 it['sha256']=hashlib.sha256((r/it['file']).read_bytes()).hexdigest();it['renders']={a:f'renders/{it["id"]}-{a}.png' for a in ['front','quarter','side','back']};it['mountedRenders']={str(a):f'renders/mounted-{it["id"]}-{a}/0000.png' for a in [0,45,90,180]};it['provenance']='Built-in image_gen per family; hand-authored editable Three.js geometry from inspected design, no PNG plane or claimed automatic reconstruction.'
 if it['id']=='energy-token':it.update({'semanticIdentity':'golden energy crystal; not coin or currency','sourceIdentity':'original V1 assets/companion/dango/raster/tools/energy.png','rejectedPriorVersion':'rejected/energy-coin-v1','physicalBevel':.008})
 it['scaleRelativeToBodyWidth']=(it['bounds']['max'][0]-it['bounds']['min'][0])/m['bodyWidth']
(r/'manifest.json').write_text(json.dumps(m,indent=2))
for mounted in [False,True]:
 out=Image.new('RGB',(1536,414*len(m['items'])),'#eeeeee');d=ImageDraw.Draw(out)
 for row,it in enumerate(m['items']):
  for col,a in enumerate([0,45,90,180] if mounted else ['front','quarter','side','back']):
   p=r/(it['mountedRenders'][str(a)] if mounted else it['renders'][a]);im=Image.open(p).convert('RGBA');out.paste(im,(384*col,414*row),im);d.text((384*col+10,414*row+389),f'{it["id"]} {a}',fill='black')
 out.save(r/'renders'/('mounted-contact-sheet.png' if mounted else 'single-model-contact-sheet.png'))
images=[]
for id in ['ball','building-block']:
 for a in [0,45,90,180]:images.append((id,a,Image.open(r/f'renders/repeated-{id}-{a}/0000.png').convert('RGBA')))
out=Image.new('RGB',(1536,828),'#eeeeee');d=ImageDraw.Draw(out)
for i,(id,a,im) in enumerate(images):x=i%4*384;y=i//4*414;out.paste(im,(x,y),im);d.text((x+8,y+389),f'{id} repeated {a}',fill='black')
out.save(r/'renders/repeated-contact-sheet.png')
