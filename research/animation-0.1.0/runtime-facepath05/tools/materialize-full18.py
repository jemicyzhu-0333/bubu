#!/usr/bin/env python3
"""Recreate the exact approved full18 GLB from the repository's lossless archive.
No downloads, absolute environment paths, symlinks, or artistic conversion.
"""
import gzip
import hashlib
import json
import os
from pathlib import Path

RUNTIME = Path(__file__).resolve().parents[1]
ARCHIVE = RUNTIME.parent / 'expression-library/approved-v1/shared-library/bubu-expression-library-v1.glb.gz'
TARGET = RUNTIME / 'fixtures/face-full18/asset.glb'
EXPECTED = '1100131118479ecb266c029082d311f18e5b2564ad0a1077182ac934e769d677'
ARCHIVE_SHA = 'be39c3c61184c8470182855bfc62885feb478998bacfa2a0f8d9f3a3645f22ee'
SIZE = 16867596
ARCHIVE_SIZE = 10914547

def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()

def main():
    if TARGET.is_symlink() or ARCHIVE.is_symlink():
        raise SystemExit('Refusing a symbolic-link asset or archive')
    if TARGET.exists():
        if TARGET.stat().st_size != SIZE or sha(TARGET) != EXPECTED:
            raise SystemExit('Existing full18 asset has wrong size/hash; move it aside before retrying')
        print(json.dumps({'asset': 'fixtures/face-full18/asset.glb', 'sha256': EXPECTED, 'bytes': SIZE, 'status': 'already-verified'}))
        return
    if not ARCHIVE.is_file():
        raise SystemExit('Missing repository archive: research/animation-0.1.0/expression-library/approved-v1/shared-library/bubu-expression-library-v1.glb.gz')
    if ARCHIVE.stat().st_size != ARCHIVE_SIZE or sha(ARCHIVE) != ARCHIVE_SHA:
        raise SystemExit('Repository gzip size/hash mismatch')
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    temp = TARGET.with_name('.asset.glb.materializing')
    if temp.exists() or temp.is_symlink():
        raise SystemExit('Existing temporary materialization file; inspect/remove it before retrying')
    h = hashlib.sha256()
    count = 0
    try:
        with gzip.open(ARCHIVE, 'rb') as source, temp.open('xb') as out:
            while True:
                block = source.read(min(1024 * 1024, SIZE - count + 1))
                if not block:
                    break
                count += len(block)
                if count > SIZE:
                    raise ValueError('Expanded asset exceeds exact approved size')
                h.update(block)
                out.write(block)
            out.flush()
            os.fsync(out.fileno())
        if count != SIZE or h.hexdigest() != EXPECTED:
            raise ValueError('Expanded asset size/hash mismatch')
        temp.replace(TARGET)
    finally:
        if temp.exists():
            temp.unlink()
    print(json.dumps({'asset': 'fixtures/face-full18/asset.glb', 'sha256': EXPECTED, 'bytes': count, 'status': 'materialized-and-verified'}))

if __name__ == '__main__':
    main()
