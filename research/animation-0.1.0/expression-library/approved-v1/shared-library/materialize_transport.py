"""Run beside TRANSPORT.json before restore_library.py; standard library only."""
import gzip, hashlib, json
from pathlib import Path
root = Path(__file__).resolve().parent
for item in json.loads((root / 'TRANSPORT.json').read_text())['files']:
    target = root / item['file']
    data = gzip.decompress((root / item['gzip']).read_bytes())
    assert len(data) == item['bytes'] and hashlib.sha256(data).hexdigest() == item['sha256'], item['file']
    if target.exists():
        assert target.read_bytes() == data, 'Refusing to replace a different existing file: ' + str(target)
    else:
        tmp = target.with_suffix(target.suffix + '.restoring')
        tmp.write_bytes(data)
        tmp.replace(target)
    print('Verified', item['file'])
