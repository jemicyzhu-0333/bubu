import argparse,gzip,hashlib
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--gzip',required=True);p.add_argument('--out',required=True);a=p.parse_args();blob=gzip.decompress(Path(a.gzip).read_bytes());h=hashlib.sha256(blob).hexdigest();assert h=='84ec5d8608f21e43bf06df26b8b2f81124909ebb39c77bb9cc153aca17319a3a';dst=Path(a.out)
if dst.exists():assert dst.read_bytes()==blob,'Refusing to overwrite a different asset'
else:dst.parent.mkdir(parents=True,exist_ok=True);dst.write_bytes(blob)
print('RECOVERED',h,len(blob))
