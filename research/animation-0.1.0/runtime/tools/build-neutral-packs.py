"""Repackage exact approved assets without converting geometry or metadata.
Pass a source workspace path. Bundled fixtures need no regeneration for tests."""
import sys,json,hashlib
from pathlib import Path
root=Path(sys.argv[1]); out=Path(__file__).resolve().parents[1]/'fixtures'
sources=[('static05','bubu-3d-a-feet05-20261016/candidate-a-static-05/a-reference-feet05.glb','3b7adcb303c8bd3c0dfb8976f9eb8fc0e6cefb897a7c16e99acc827385591722'),('r6','bubu-3d-a-face-coordinate-v2-20261016/candidate-a05-selected-faces-r6-review/bubu-a05-selected-faces.glb','fba41db41ecb0e0a959cd6923f55d5edbfaebf4558d79e1e9832b2a806cc5830')]
for name,path,sha in sources:
    data=(root/path).read_bytes();assert hashlib.sha256(data).hexdigest()==sha
    directory=out/('neutral-'+name);directory.mkdir(exist_ok=True)
    (directory/'asset.glb').write_bytes(data)
    profile={'format':'bubu-neutral-profile','version':'0.1.0','purpose':'approved-art-neutral','sourceSha256':sha,'rig':'static' if name=='static05' else 'skinned','root':'A_reference_root','body':'A_mochi_skin','faces':['A_eye_highlight_L','A_eye_highlight_R','A_eye_L','A_eye_R','A_mouth_ring'],'joints':{} if name=='static05' else {'body':'Body','shoulderLeft':'Shoulder_L','shoulderRight':'Shoulder_R','hipLeft':'Hip_L','hipRight':'Hip_R'},'sockets':{} if name=='static05' else {'headTouch':'HeadTouch','accessory':'AccessoryAnchor'},'readiness':{'engine':'neutral-load-only','binding':'hash-locked-rest','verified':'cpu-source-parity-only'}}
    p=(json.dumps(profile,indent=2)+'\n').encode();(directory/'profile.json').write_bytes(p)
    manifest={'format':'bubu-neutral-suite','version':'0.1.0','id':'approved-'+name+'-neutral','purpose':'approved-art-neutral','assets':[{'id':'body','path':'asset.glb','kind':'glb','bytes':len(data),'sha256':sha},{'id':'profile','path':'profile.json','kind':'profile','bytes':len(p),'sha256':hashlib.sha256(p).hexdigest()}],'character':{'asset':'body','profile':'profile'},'budgets':{'decodedArrayBytes':16*1024*1024}}
    (directory/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
