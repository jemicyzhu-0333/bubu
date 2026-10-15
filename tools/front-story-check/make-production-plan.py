import json,hashlib
from pathlib import Path
root=Path(__file__).resolve().parents[3];e=root/'evidence-production';work=root/'work'
actual=json.loads((e/'actual/records.json').read_text())['records'];records=[]
for folder in sorted(e.glob('omit-*')):
 if folder.name.endswith('-dense') or '-dpr' in folder.name:continue
 payload=json.loads((folder/'records.json').read_text());target=payload['omit'];omitted={r['name']:r for r in payload['records']}
 for a in actual:
  r=a['resources'].get(target,{});o=omitted[a['name']];q=o['resources'].get(target,{})
  if not r.get('selected'):continue
  hidden=a['name'].startswith('halloween-') and a['name'].endswith('-7199') and target in ['palm','pumpkin','ghost']
  records.append(dict(target=target,state=a['name'],timeMs=a['at'],expectedVisible=not hidden,
   actual=dict(path='actual/'+a['name']+'.png',sha256=a['pngSha256']),omitted=dict(path=folder.name+'/'+a['name']+'.png',sha256=o['pngSha256']),
   inputsSha256=a['inputSha256'],omittedInputsSha256=o['inputSha256'],poseSha256=a['poseSha256'],omittedPoseSha256=o['poseSha256'],
   requested=int(r['requested']),loaded=int(r['loaded']),pending=0,failed=0,omittedRequested=int(q['requested']),omittedLoaded=int(q['loaded']),omittedPending=0,omittedFailed=0,selected=r['selected'],omittedSelected=q['selected'],drawCount=r['drawCount'],omittedDrawCount=q['drawCount']))
paths=list((work/'assets/companion/dango/front-stories').glob('*'))+list((work/'src/capabilities/companion/presentation').glob('front-story-*.mjs'))+[work/'src/surfaces/pet/renderer.mjs',work/'src/content/companion/front-stories.mjs',work/'tools/front-story-check/production-audit.mjs']
seal=hashlib.sha256(b''.join(p.read_bytes() for p in sorted(paths) if p.is_file())).hexdigest()
(e/'production-evidence-plan.json').write_text(json.dumps(dict(schema='pet-production-evidence/v1',surface='node-canvas',sourceSealSha256=seal,records=records),indent=2));print(len(records))
