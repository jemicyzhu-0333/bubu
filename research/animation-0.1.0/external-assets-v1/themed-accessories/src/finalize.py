import json,hashlib,subprocess,re,os
from pathlib import Path
from collections import Counter
from PIL import Image,ImageDraw
from portable_paths import P,R,ASSET,REPO
if REPO is None: raise ValueError('--repo-root is required for canonical catalog metadata')
CATALOG_PATH=REPO/'src/content/appearance.mjs'
if not (P/'src/accessory-adapter.mjs').exists(): raise RuntimeError('Finalization requires an isolated authoring cache with src/models/references and freshly rendered review frames; do not run against packaged inputs')
canonical={item['id']:item for item in json.loads(subprocess.check_output(['node','--input-type=module','-e','import {PET_APPEARANCE_ITEMS} from '+json.dumps(str(CATALOG_PATH))+'; console.log(JSON.stringify(PET_APPEARANCE_ITEMS));'],text=True))}
CANONICAL_FIELDS=['id','slot','exclusiveGroup','exclusivePriority','minLevel','unlockKind','optInOnly','formId','skin']
def catalog_metadata(id):
 item=canonical[id]
 return {key:bool(item.get(key,False)) if key=='optInOnly' else item[key] for key in CANONICAL_FIELDS}

items=[('cap','skin.woodsman-cap','樵夫帽','woodsman-cap','head','headwear','woodsman',80),('fin','skin.ocean-fin','海蓝鳍','ocean-fin','back','backwear','ocean',100),('wings','skin.bat-wings','夜行翼','bat-wings','back','backwear','bat',100),('plum','seasonal.plum-cape','梅紫小披风','plum-cape','back','backwear',None,80)]
manifest={'version':'0.1.0-research','scope':'Four themed accessories only; no new actions, no production wardrobe changes or remote writes','sourceBodySHA256':'84ec5d8608f21e43bf06df26b8b2f81124909ebb39c77bb9cc153aca17319a3a','hybridSHA256':'52a080d81606fbe92e9cd71593bd703f356eb50a0e1c74ccc34547a0db308e67','applicationEntry':'src/accessory-adapter.mjs','bodyPolicy':'Unchanged approved D2 source body and hybrid rig; generated wearing sheets are concepts only','coordinateFrame':'source actor geometry-local; Blender Z-up exports standard GLTF Y-up; accessory root inherits exact sourceSkin world transform','mutualExclusion':'cap may combine with one backwear item; fin/wings/plum are mutually exclusive. combined-static and tea-combined are collision diagnostics, not valid outfits. assertCompatible rejects same-group selection.','reproduce':['blender -b --python src/build_models.py','node src/test_and_export.mjs','python src/audit_tea.py','python src/finalize.py'],'items':[]}
tea=json.loads((P/('reports/tea-collision-full.json' if (P/'reports/tea-collision-full.json').exists() else 'reports/tea-collision.json')).read_text());audit=json.loads((P/'reports/host-audit.json').read_text());overall=Image.new('RGB',(1536,1640),'#eeeeee')
for row,(kind,id,name,filename,slot,group,skin,priority) in enumerate(items):
 out=Image.new('RGB',(1536,410),'#eeeeee');d=ImageDraw.Draw(out)
 for i,a in enumerate([0,45,90,180]):
  im=Image.open(P/f'review/{kind}-{a}/0000.png');out.paste(im,(i*384,25),im);d.text((i*384+10,8),filename+' | '+str(a)+' degrees | ACTUAL CPU',fill='black')
 out.save(P/f'review/{kind}-actual-fourviews.png');overall.paste(out,(0,row*410))
 selected_tea=tea
 hits=[{'time':f['time'],'phase':f['phase'],'intersections':{k:v for k,v in f['intersections'].items() if k.split('/')[-1].startswith(kind+'_')}} for f in selected_tea['frames']]
 clear=all(not f['intersections'] for f in hits)
 (P/f'reports/{kind}-tea-collision.json').write_text(json.dumps({'scope':selected_tea['scope'],'accessoryModelSHA256':selected_tea.get('accessoryModelSHA256',{}),'allSampledClear':clear,'frames':hits},indent=2))
 meshes=json.loads((P/f'review/{kind}-static.json').read_text())['frames'][0]['meshes'];coords=[m['positions'] for m in meshes if m['name'].startswith(kind+'_')];mins=[min(a[j] for a in coords for j in range(k,len(a),3)) for k in range(3)];maxs=[max(a[j] for a in coords for j in range(k,len(a),3)) for k in range(3)]
 manifest['items'].append({'id':id,'name':name,'kind':kind,'model':'models/'+filename+'.glb','sha256':hashlib.sha256((P/'models'/f'{filename}.glb').read_bytes()).hexdigest(),'generatedReference':'references/plum-side-clasp-r2-prototype.png' if kind=='plum' else 'references/'+filename+'-prototype.png','prompt':'references/plum-side-clasp-r2-prompt.txt' if kind=='plum' else 'references/'+kind+'-prompt.txt','modelRevision':'side-shoulder-clasp-r2' if kind=='plum' else 'final-candidate-v1','slot':slot,'layer':'back','exclusiveGroup':group,'exclusivePriority':priority,'skin':skin,'unlockKind':canonical[id]['unlockKind'],'minLevel':canonical[id]['minLevel'],'optInOnly':bool(canonical[id].get('optInOnly',False)),'formId':canonical[id]['formId'],'canonicalV1Views':['front'] if kind=='plum' else ['front','three-quarter','profile','back'],'candidate3DViews':[0,45,90,180],'binding':{'anchor':'sourceSkin actor-local '+('head crown' if kind=='cap' else 'rear body surface'),'rootPosition':[0,0,0],'rootScale':[1,1,1],'noSkeletonOrGeometryMutation':True,'borrowedAssetOwnership':'adapter detaches only; caller explicitly disposeAsset after final use'},'materials':{'cap':['moss green felt','forest underside','cream feather','warm shaft'],'fin':['aqua continuous membrane','deep teal ribs'],'wings':['lavender-gray membrane','plum rounded ribs'],'plum':['deep plum soft drape','wide rear folded band','gold side-shoulder clasp']}[kind],'actualStaticWorldBounds':{'min':mins,'max':maxs},'tests':{'dragFrames':audit['scenarios']['drag']['frames'],'longpressFrames':audit['scenarios']['longpress']['frames'],'sourceBodyUnchanged':True,'finiteBounds':True,'explicitRelease':audit['lifecycle'][kind]['explicitRelease'],'teaSampledClear':clear,'teaFrames':len(hits),'teaContinuousCollision':'not-tested','clothSimulation':'not-implemented','browserWebGL':'not-tested','nativeDesktop':'not-tested','productionWardrobe':'not-integrated'},'visualReview':'review/'+kind+'-actual-fourviews.png','status':'static-host-candidate; tea-contact-pending' if not clear else 'static-host-candidate; sampled-tea-clear','userAcceptance':'pending-final-batch-review'})
for item in manifest['items']:
 item.update(catalog_metadata(item['id']))
manifest['canonicalCatalog']={'path':str(CATALOG_PATH),'sha256':hashlib.sha256(CATALOG_PATH.read_bytes()).hexdigest(),'metadataFields':CANONICAL_FIELDS}
adapter_path=P/'src/accessory-adapter.mjs'
specs={kind:catalog_metadata(id) for kind,id,*_ in items}
adapter=adapter_path.read_text()
adapter=re.sub(r'export const SPECS=Object\.freeze\([^\n]*\);', 'export const SPECS=Object.freeze('+json.dumps(specs,separators=(',',':'))+');',adapter,count=1)
adapter_path.write_text(adapter)
(P/'attach-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2));overall.save(P/'review/themed-accessories-actual-contact-sheet.png')
print(json.dumps([{'id':i['id'],'status':i['status']} for i in manifest['items']],ensure_ascii=False))
subprocess.run(['node',str(ASSET/'src/verify_catalog.mjs'),'--repo-root',str(REPO),'--reference-root',str(R),'--cache-root',str(P.parent)],check=True,env={**os.environ,'THEMED_AUTHORING_ROOT':str(P)})
# Explicit candidate-only package: exclude rejected models, old probes and dependencies.
files=['README.md','attach-manifest.json']
files += [str(f.relative_to(P)) for f in sorted((P/'models').glob('*.glb'))]
files += [str(f.relative_to(P)) for f in sorted((P/'src').glob('*')) if f.is_file()]
for item in manifest['items']:
 files += [item['generatedReference'],item['prompt'],item['visualReview'],f"reports/{item['kind']}-tea-collision.json"]
files += ['review/themed-accessories-actual-contact-sheet.png','review/interaction-actual-contact-sheet.png','review/plum-tea-side-clasp-r2/0000.png','review/plum-tea-side-clasp-r2/0001.png','reports/host-audit.json','reports/tea-collision-full.json','reports/tea-coordinate-proof.json','reports/interaction-image-bounds.json','reports/catalog-metadata-proof.json']
files=sorted(set(files))
allowlist={'scope':'Final candidates only; no rejected center-clasp model or stale unaligned collision reports','files':[{'path':f,'sha256':hashlib.sha256((P/f).read_bytes()).hexdigest()} for f in files]}
(P/'CANDIDATE-ALLOWLIST.json').write_text(json.dumps(allowlist,indent=2))
(P/'SHA256SUMS').write_text(''.join(f"{entry['sha256']}  {entry['path']}\n" for entry in allowlist['files']))
