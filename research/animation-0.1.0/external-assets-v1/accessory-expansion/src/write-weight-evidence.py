"""Bind current candidate source, actual geometry exports, and CPU render evidence."""
import hashlib,json,shutil
from pathlib import Path
root=Path(__file__).resolve().parents[2];cache=root/'.cache/weight'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
for folder,group in [('accessory-expansion','accessory'),('themed-accessories','themed-accessories')]:
 p=root/folder;out=p/'reports/weight-v2';out.mkdir(parents=True,exist_ok=True)
 for name in ['host-audit.json','tea-collision.json']:
  shutil.copy2(cache/group/'reports'/name,out/name)
 files=list((p/'models').glob('*.glb'))+list((p/'src').glob('*.mjs'))+list((p/'src').glob('*.py'))+list((p/'review/weight-v2').rglob('*.png'))
 if folder=='themed-accessories':files.append(root/'accessory-expansion/src/supported-deformation.mjs')
 files+=[out/'host-audit.json',out/'tea-collision.json',out/'tail-contact.json',root/'body-tail/tail-mesh.json',root/'body-tail/bubu-round-tail.glb']
 exports=list((cache/group/'review').glob('*.json'))
 proof={'status':'research candidate only; not production integration or engine selection','scope':'Static support/contact geometry and experimental bounded secondary deformation. CPU Three.js mesh exports and Blender renders; no native desktop/GPU acceptance and no cloth solver claim.','sourceSHA256':'84ec5d8608f21e43bf06df26b8b2f81124909ebb39c77bb9cc153aca17319a3a','hybridSHA256':'52a080d81606fbe92e9cd71593bd703f356eb50a0e1c74ccc34547a0db308e67','files':[{ 'path':str(f.relative_to(root)),'sha256':sha(f)} for f in files+exports],'bounds':'Secondary offset clamped to 0.16 local units; all recorded poses finite. Boots source-shell offset max 0.003; native feet retained.','limitations':['Mature physics/particle library comparison pending; experimental adapter API not frozen.','Tea audit is 16 discrete samples against hands/cup; not continuous collision or all wardrobe combinations.','Cape/fin+tail images are static actual source geometry, not a new tail dynamics integration.']}
 (out/'current-evidence.json').write_text(json.dumps(proof,indent=2))
 for row in proof['files']:assert sha(root/row['path'])==row['sha256']
 print(folder,len(files),'candidate inputs/renders +',len(exports),'actual mesh exports verified')
