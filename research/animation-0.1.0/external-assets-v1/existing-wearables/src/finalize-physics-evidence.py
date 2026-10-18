from pathlib import Path
import json,hashlib,shutil,datetime
from portable_paths import P,ASSET
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
reports={}
for name in ['host-audit','tea-collision','static-stage','independent-rejection','contact-keyframe-index','contact-point-classification','contact-visibility']:
 source=P/f'reports/{name}.json';target=ASSET/f'reports/final-{name}.json';shutil.copy2(source,target);reports[name]=str(target.relative_to(ASSET))
host=json.loads((P/'reports/host-audit.json').read_text());tea=json.loads((P/'reports/tea-collision.json').read_text());baseline=json.loads((ASSET/'reports/tea-collision.json').read_text())
scarf_equal=all({k:v for k,v in a['hits'].items() if k.startswith('scarf/')}=={k:v for k,v in b['hits'].items() if k.startswith('scarf/')}for a,b in zip(tea['frames'],baseline['frames']))
assert scarf_equal
fresh=json.loads((P/'reports/independent-rejection.json').read_text());assert fresh['hostFresh'] and fresh['teaFresh']
assert sha(P/'review/tea-contact-actual-sheet.png')==sha(ASSET/'review/weight-contact-tea-actual-sheet.png')
assert sha(P/'review/existing-four-actual-fourviews.png')==sha(ASSET/'review/weight-contact-actual-fourviews.png')
artifacts=[]
for name,scope in [
 ('satchel-side-before-after.png','Fresh actual original/revised GLB-derived geometry, -90/-45/90/180 degrees, enlarged span3.0'),
 ('weight-contact-actual-fourviews.png','Actual final source actor plus candidate wearables, four views, stage span5.264'),
 ('weight-contact-motion-keyframes.png','Actual final geometry at six exact recorded drag/longpress frame/times, front and 45 degrees; representative stills only'),
 ('weight-contact-tea-actual-sheet.png','Actual final first/peak/high-cup contact snapshots, front and 45 degrees, enlarged span3.0')]:
 p=ASSET/'review'/name;artifacts.append({'path':str(p.relative_to(ASSET)),'sha256':sha(p),'scope':scope})
comparison={key:{'original':baseline['summary'][key],'final':value}for key,value in tea['summary'].items()}
summary={
 'createdUTC':datetime.datetime.now(datetime.timezone.utc).isoformat(),
 'status':'Isolated research candidate; experimental dynamics awaiting mature Three.js-compatible solver comparison. Not production integration or user visual acceptance.',
 'retainedCorrections':['Torso-local bag/scarf supports; headwear scalp support.','Bag-side continuous return lifted into upper pouch seam; approved pouch shape/materials retained.','Pinned scarf tail with small resting drape; approved collar surface restored.'],
 'rejectedExperiment':'Inward scarf collar/palm compression increased collision-pair peaks. Removed in final code; every final scarf contact frame exactly matches original baseline again.',
 'runtimeTests':host['tests'],'scenarios':host['scenarios'],'fullHarnessElapsedSeconds':host.get('elapsedSeconds'),
 'sourceHashes':host['inputs'],
 'sourceHashPathsRelativeTo':'.physics-final/existing-wearables',
 'scarfAll271ContactFramesMatchOriginal':scarf_equal,
 'teaComparison':comparison,
 'noCupCrossingsIn271Samples':not any('Sip_'in key for row in tea['frames'] for key in row['hits']),
 'noSproutOrHatHandCrossingsIn271Samples':not any(key.startswith(('sunhat/','sprout/'))for row in tea['frames'] for key in row['hits']),
 'reports':reports,
 'additionalReports':['reports/support-motion-tests.json','reports/side-support-audit.json','reports/motion-bounds.json','reports/final-visible-seams.md'],
 'artifacts':artifacts,
 'geometrySourceHashes':{p.name:sha(p)for p in (P/'review').glob('*static.json')},
 'limits':['Palm/garment seams remain nonzero and partly visible; no continuous collision or full action compatibility.','Bounded local lag/gravity is an experiment, not calibrated cloth or a frozen integration interface.','Rendering is Blender CPU using actual exported geometry; no browser/WebGL/native OS validation.','Production app and npm aggregate suite were not modified/run for this isolated candidate.','Source body still has the original 13 exported meshes; separately restoring a body tail requires integrated rerendering.','Full-harness elapsed time includes loading, checking and geometry export; it is not a frame-time benchmark.']}
(ASSET/'reports/physics-revision-summary.json').write_text(json.dumps(summary,indent=2));print(json.dumps({'status':summary['status'],'scarfAll271ContactFramesMatchOriginal':scarf_equal,'artifacts':[a['path']for a in artifacts]},indent=2))
