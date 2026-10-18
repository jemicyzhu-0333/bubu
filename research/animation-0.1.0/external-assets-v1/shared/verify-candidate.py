#!/usr/bin/env python3
"""Verify included model bytes and catalog cardinalities without accepting stale audit reports."""
from pathlib import Path
import json,hashlib,struct
p=Path(__file__).resolve().parents[1];c=json.load(open(p/'catalog.json'));assert len(c['wearables'])==18 and len(c['props'])==39
count=0
for item in c['wearables']+c['props']+[v for row in c['props'] for v in row.get('variants',[])]:
 model=item.get('model')
 if not model or model.startswith('../'):continue
 f=p/model;assert f.is_file(),model;data=f.read_bytes();assert hashlib.sha256(data).hexdigest()==item['sha256'],model
 magic,version,total=struct.unpack('<4sII',data[:12]);assert magic==b'glTF' and version==2 and total==len(data);count+=1
print(f'{count} included GLBs verified; 18 wearables and 39 prop families catalogued; no acceptance inferred')
