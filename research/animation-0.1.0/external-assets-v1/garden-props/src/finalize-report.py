import json,hashlib
from pathlib import Path
from PIL import Image,ImageDraw
r=Path(__file__).resolve().parents[1];m=json.loads((r/'manifest.json').read_text());reviews={'shovel':'Rounded metal blade and genuine open D handle; shaft contact uses existing short right fin.','dirt-mound':'Three low volumetric hillocks, five pebble meshes, flat ground contact; no hand mount.','watering-can':'Hollow fill opening, open handle, rose face and seven dark physical perforation indicators; single side fin handle contact.','plant-pot':'Volumetric pot, soil and four thick leaves; soil and ground sockets, no mandatory hand mount.','broom':'Seven broad straw bundles. First render exposed inverted fan; corrected before final export and review.'}
for it in m['items']:
 it['status']={'design':'generated per item and visually reviewed; final user acceptance pending','model':'real volumetric GLB exported','validation':'21 automated checks passed: finite vertices, bounds, budget, cold GLB load, sockets, disposal, rigid transform inverse','mount':'actual unchanged hybrid actor with original face, static contact candidate reviewed; full action and wardrobe compatibility pending','nativeRuntime':'pending','animationCompatibility':'pending'}
 it['review']=reviews[it['id']];it['sha256']=hashlib.sha256((r/it['file']).read_bytes()).hexdigest();it['renders']={a:f'renders/{it["id"]}-{a}.png' for a in ['front','side','quarter','back']};it['mountedRenders']={str(a):f'renders/mounted-{it["id"]}-{a}/0000.png' for a in [0,45,90,180]};it['prototypeSource']='Built-in image_gen; manually modeled as editable geometry from reviewed reference, no raster plane substitution'
(r/'manifest.json').write_text(json.dumps(m,indent=2))
for mounted in [False,True]:
 out=Image.new('RGB',(384*4,414*5),'#eeeeee');d=ImageDraw.Draw(out)
 for row,it in enumerate(m['items']):
  for col,a in enumerate([0,45,90,180] if mounted else ['front','side','quarter','back']):
   p=r/(it['mountedRenders'][str(a)] if mounted else it['renders'][a]);im=Image.open(p).convert('RGBA');out.paste(im,(384*col,414*row),im);d.text((384*col+10,414*row+389),f'{it["id"]} {a}',fill='black')
 out.save(r/'renders'/('mounted-contact-sheet.png' if mounted else 'single-model-contact-sheet.png'))
(r/'reports'/'review-notes.md').write_text('''# Garden prop candidate review

Five exact inventory entities: shovel, dirt-mound, watering-can, plant-pot, broom. All five have separate built-in-generated concept sheets, editable geometry, GLBs, physical materials, named sockets and measured dimensions in manifest.json. Coordinates: glTF X right, Y up, Z front; same approved character scale. No production files, persistent user state or action timing changed.

21 tests passed. CPU Blender renders are actual geometry. Images in prototypes/ are conceptual references only. Static mounted renders use existing hybrid meshes and original face meshes, neither repainting nor extending hands. Shovel and broom use single right fin shaft contact; watering can uses the existing right fin at handle; dirt and plant sit on ground. Rest hand stays unchanged. These static contacts are candidate attachment contracts, not new action sequences.

Pending: final user review, complete wardrobe collision and facial clearance across motions, full V1 action compatibility, WebGL/native platform runtime. Shovel blade is simpler/flatter than concept concavity; watering rose holes are dark shallow geometry indicators, not through-bores. Both are intentional low-detail small-scale representations.
''')
