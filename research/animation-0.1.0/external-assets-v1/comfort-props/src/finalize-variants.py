import json,hashlib
from pathlib import Path
from PIL import Image,ImageDraw
root=Path(__file__).resolve().parents[1]
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
manifest=json.loads((root/'variants-manifest.json').read_text());audit=json.loads((root/'reports/variant-mount-audit.json').read_text());contracts=json.loads((root/'reports/variant-mount-contracts.json').read_text())
for i in manifest['items']:
 id=i['id'];family='tissue' if id=='tissue-sheet' else 'telescope';node='Tissue_single_sheet' if id=='tissue-sheet' else 'Telescope_altitude_pivot'
 i.update({'family':family,'variant':'detached-handheld','prototype':f'prototypes/{family}.png','prototypeSha256':sha(root/'prototypes'/f'{family}.png'),'sha256':sha(root/i['file']),'sourceGeometry':{'parentModel':f'models/{family}.glb','parentSha256':sha(root/'models'/f'{family}.glb'),'partNode':node,'operation':'clone existing geometry/materials, detach, translate only; original node rotation preserved','newImageGeneration':False},'staticMount':next(x for x in contracts['items'] if x['id']==id),'staticAudit':next(x for x in audit['items'] if x['id']==id),'safeBounds':i['clearanceEnvelope'],'status':{'design':'existing generated prototype; original shape reused','model':'independent derived GLB, original six GLBs unchanged','mount':'original unmodified right hand static contact','validation':'79 full group tests pass; actual geometry CPU rendering only'},'pending':['new action timing','paper extraction/return sequence' if family=='tissue' else 'eye-level optical use sequence','wardrobe combinations','production/native integration'],'renderEvidence':{'isolated':[f'renders/{id}-{v}.png' for v in ['front','side','quarter','back']],'assembled':[f'renders/{id}-mounted-{a}/0000.png' for a in [0,45,90,180]]}})
manifest['scope']='Derived handheld static variants alongside original six; no new animation timing, original actor and original six models unchanged.'
(root/'variants-manifest.json').write_text(json.dumps(manifest,indent=2))
canvas=Image.new('RGB',(768,818),(243,242,237));draw=ImageDraw.Draw(canvas)
for row,i in enumerate(manifest['items']):
 for col,angle in enumerate([0,45]):
  p=root/'renders'/f'{i["id"]}-mounted-{angle}'/'0000.png';im=Image.open(p).convert('RGBA');canvas.paste(im,(384*col,409*row+25),im);draw.text((384*col+8,409*row+8),f'{i["id"]} / {angle} degrees',fill=(35,35,35))
canvas.save(root/'renders/handheld-variants-front-45.png')
