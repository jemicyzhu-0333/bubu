from pathlib import Path
import gzip,hashlib,json,shutil
P=Path(__file__).parent;out=P/'_restored';out.mkdir(exist_ok=True)
for name,sha in json.loads((P/'RESTORE-HASHES.json').read_text()).items():
 with gzip.open(P/(name+'.gz'),'rb') as f,open(out/name,'wb') as w:shutil.copyfileobj(f,w)
 assert hashlib.sha256((out/name).read_bytes()).hexdigest()==sha,name
 print('RESTORED',name,sha)
sha=hashlib.sha256((P/'bubu-a05-basic-batch2.glb').read_bytes()).hexdigest();assert sha==json.loads((P/'STATUS.json').read_text())['candidateSHA256'];print('GLB VERIFIED',sha)
