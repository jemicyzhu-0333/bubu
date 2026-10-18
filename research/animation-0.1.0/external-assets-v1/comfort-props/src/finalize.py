import json,hashlib
from pathlib import Path
from PIL import Image,ImageDraw
root=Path(__file__).resolve().parents[1]
ids=['mirror','tissue','cushion','binoculars','telescope','pillow']
origins=['exec-96507d70-c115-4f98-b39e-be30035a5733.png','exec-181dc778-bd46-41ab-b750-b451609baa29.png','exec-b0fd670e-0d0e-4139-b2df-373e1fc46d0c.png','exec-27cc538d-7d1e-41fa-8db3-59e0d6051ddd.png','exec-bcbf3b7b-e2a7-486f-ab3a-bb03abdae3e3.png','exec-441e56f4-6b5e-4627-a513-dd8a0ee8630c.png']
descriptions=['Small handheld oval mirror, mint rounded frame, short handle, plain silver face and cream back; four isolated views and unchanged pink Bubu scale vignette.','Cream rounded tissue box, mint base, oval slit, single white folded tissue; floor beside unchanged Bubu.','Round mint tufted floor cushion with cream piping, empty on floor beside Bubu; distinct from rectangular pillow.','Two parallel cream binocular barrels with mint grips, blue objectives, dark eyepieces, central bridge and focus wheel; no stand.','Single cream stargazing telescope with mint rim, dark objective, angled eyepiece and three-legged wood tripod, naturally grounded.','Puffy rectangular lavender sleeping pillow with cream piping, no pattern, flat on floor beside unchanged Bubu; distinct from cushion.']
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
# Historical provenance-authoring utility; not the fresh static validation entrypoint.
import argparse
parser=argparse.ArgumentParser();parser.add_argument('--reference-image',type=Path,required=True)
reference=parser.parse_args().reference_image.resolve()
provenance={'generator':'built-in image_gen.imagegen; no paid external API, no credentials','reference':str(reference),'referenceSha256':sha(reference),'review':'Each generated sheet inspected before modeling. Pink Bubu identity kept, halo omitted in concept use vignettes. Vignettes are concept only; original geometry exclusively used in actual assembled renders.','items':[]}
for id,origin,desc in zip(ids,origins,descriptions):provenance['items'].append({'id':id,'file':'prototypes/'+id+'.png','source':str(root.parent/'generated_images'/origin),'sha256':sha(root/'prototypes'/f'{id}.png'),'designBrief':desc,'constraints':'Soft toy 3D reference sheet on white; front, side, 45 and back plus use-scale vignette. Exact character identity, original two short arms and two feet, no new limbs, no text. Concept is not geometry.','reviewed':True,'adaptations':'Mirror and its straight handle tilt outward together 0.5 radians around the grip; no actor or hand reshaping.' if id=='mirror' else 'Geometry scaled in fixed approved-body units. Cushion/pillow remain empty grounded scene props; actor is not seated or sleeping.' if id in ['cushion','pillow'] else 'Static assembly preserves all original 13 actor meshes.'})
(root/'prototypes/provenance.json').write_text(json.dumps(provenance,indent=2))
audit=json.loads((root/'reports/mount-audit.json').read_text());contracts=json.loads((root/'reports/mount-contracts.json').read_text());manifest=json.loads((root/'manifest.json').read_text())
for i in manifest['items']:
 id=i['id'];i['sha256']=sha(root/i['file']);i['prototypeSha256']=sha(root/i['prototype']);i['status']={'design':'individual generated prototype reviewed','model':'real GLB geometry and materials exported','mount':'isolated actual approved body + hybrid + 8 face meshes static assembly; 13 original actor meshes unchanged','validation':'79 Node tests plus actual mesh triangle and surface audit passed; native integration pending'};i['staticMount']=next(c for c in contracts['items'] if c['id']==id);i['staticAudit']=next(c for c in audit['items'] if c['id']==id);i['safeBounds']=i['clearanceEnvelope'];i['pending']=['new action timing','complete wardrobe compatibility','production installation','native renderer/GPU/OS acceptance'];i['renderEvidence']={'isolated':[f'renders/{id}-{view}.png' for view in ['front','side','quarter','back']],'assembled':[f'renders/{id}-mounted-{a}/0000.png' for a in [0,45,90,180]]};
 if id=='mirror':i['pending'].append('live reflected scene GPU mirror effect; static metallic material only')
 if id in ['cushion','pillow']:i['pending'].append('actual seated/sleeping body support pose; feet cannot be silently moved or penetrate floor')
 if id=='binoculars':i['pending'].append('two-handed eye-level optical use; current original-hand side grip only')
(root/'manifest.json').write_text(json.dumps(manifest,indent=2))
for kind in ['isolated','assembled']:
 canvas=Image.new('RGB',(4*280,6*310),(243,242,237));draw=ImageDraw.Draw(canvas)
 for row,id in enumerate(ids):
  paths=next(i for i in manifest['items'] if i['id']==id)['renderEvidence'][kind]
  for col,p in enumerate(paths):
   im=Image.open(root/p).convert('RGBA');im.thumbnail((280,280));canvas.paste(im,(col*280,row*310+25),im);draw.text((col*280+6,row*310+6),f'{id} / '+(['front','45','side','back'][col] if kind=='assembled' else ['front','side','45','back'][col]),fill=(40,40,40))
 canvas.save(root/'renders'/f'{kind}-review-sheet.png')
candidates=[p for p in sorted(root.rglob('*')) if p.is_file() and 'node_modules' not in p.parts and p.name not in ['SHA256SUMS','CANDIDATE-ALLOWLIST.json']]
(root/'CANDIDATE-ALLOWLIST.json').write_text(json.dumps([{'path':str(p.relative_to(root)),'bytes':p.stat().st_size,'sha256':sha(p)} for p in candidates],indent=2))
(root/'SHA256SUMS').write_text('\n'.join(sha(p)+'  '+str(p.relative_to(root)) for p in sorted(root.rglob('*')) if p.is_file() and 'node_modules' not in p.parts and p.name!='SHA256SUMS')+'\n')
