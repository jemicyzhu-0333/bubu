from pathlib import Path
import json,hashlib
root=Path(__file__).resolve().parents[1];allow=json.loads((root/'CANDIDATE-ALLOWLIST.json').read_text())['files']
missing=[f for f in allow if not (root/f).is_file()]
if missing:raise RuntimeError('Candidate incomplete: '+str(missing))
for f in allow:
 assert not any(x in f for x in ['node_modules','rejected','-v1-','video','.bin']),f
hashes={f:hashlib.sha256((root/f).read_bytes()).hexdigest() for f in allow}
(root/'CANDIDATE-SHA256.json').write_text(json.dumps(hashes,indent=2))
print('Finalized',len(allow),'allowlisted files',sum((root/f).stat().st_size for f in allow),'bytes')
