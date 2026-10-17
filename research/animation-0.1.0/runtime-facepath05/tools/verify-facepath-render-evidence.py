"""Hash-audit final offline replay, rendered PNGs and media provenance."""
import hashlib,json
from pathlib import Path
root=Path(__file__).resolve().parents[1]
def H(p):return hashlib.sha256(p.read_bytes()).hexdigest()
read=lambda p:json.loads(p.read_text())
media=read(root/'evidence/facepath-media/manifest.json');index=read(root/'evidence/facepath-render/manifest.json');timeline=H(root/'src/face-timeline.mjs');basis={};records=0;items=[]
for item in media['results']:
 name=item['name'];mp=root/f'evidence/facepath-render/{name}/manifest.json';m=read(mp);replay=root/f'evidence/facepath-replays/{name}.json';r=read(replay)
 assert H(mp)==item['renderManifestSHA256'];assert H(replay)==m['replaySHA256'];assert m['timelineSHA256']==timeline==r['timelineSha256'];assert m['fixedBodyRigVerified'];assert len(m['frames'])==len(r['frames'])
 for f in m['frames']:
  rf=r['frames'][f['frame']];assert (f['time'],f['state'],f['weights'])==(rf['time'],rf['state'],rf['weights'])
 for sample in m['frames']+m['diagnostics']:
  images=[sample['image']] if 'image' in sample else list(sample['images'].values())
  for im in images:
   assert H(root/'evidence/facepath-render'/im['file'])==im['sha256'];records+=1
   if sample['state']['value']==0:
    assert not any(sample['weights'].values());basis.setdefault(im['view'],set()).add(im['sha256'])
 for im in item['contactSheets']+[item['movie']]:assert H(root/'evidence/facepath-media'/im['file'])==im['sha256']
 items.append({'name':name,'frames':len(m['frames']),'diagnosticTimes':len(m['diagnostics']),'viewsPerDiagnostic':4,'replaySHA256':H(replay),'renderManifestSHA256':H(mp),'movieSHA256':item['movie']['sha256'],'fixedBodyRigVerified':True})
assert all(len(s)==1 for s in basis.values());assert records==919
assert H(root/'evidence/facepath-media'/media['combinedMovie']['file'])==media['combinedMovie']['sha256']
report={'scope':'Hash/provenance audit, not visual or GPU performance certification','timelineSHA256':timeline,'assetSHA256':index['settings']['assetSHA256'],'lookSHA256':index['settings']['lookSHA256'],'scenarios':items,'totalMovieFrames':sum(i['frames'] for i in items),'totalDiagnosticTimes':sum(i['diagnosticTimes'] for i in items),'totalPNGRecords':records,'basisPixelConsistentByView':{k:next(iter(v)) for k,v in basis.items()},'maxBlenderFloatWeightError':index['maxBlenderFloatWeightError'],'finalCacheValidation':index['counts'],'combinedMovie':media['combinedMovie']}
(root/'evidence/facepath-complete-audit.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'scenarios':len(items),'frames':report['totalMovieFrames'],'diagnostics':report['totalDiagnosticTimes'],'pngRecords':records,'basisViews':list(basis)}))
