#!/usr/bin/env python3
"""Recreate the exact approved D2 GLB from the repository's lossless archive.
No downloads, absolute environment paths, symlinks, or artistic conversion.
"""
import gzip
import hashlib
import json
import os
from pathlib import Path

RUNTIME = Path(__file__).resolve().parents[1]
ARCHIVE = RUNTIME.parent / 'expression-library/d2-style-variant/asset/bubu-full18-d2-static-blush.glb.gz'
TARGET = RUNTIME / 'fixtures/face-d2/asset.glb'
EXPECTED = '84ec5d8608f21e43bf06df26b8b2f81124909ebb39c77bb9cc153aca17319a3a'
ARCHIVE_SHA = 'a0ce0c1acdca8d3d7240d91b7b2285a0de0e65c09e0ed7a9f221a5c905b5f839'
SIZE = 16867596
ARCHIVE_SIZE = 10915162

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
            raise SystemExit('Existing D2 asset has wrong size/hash; move it aside before retrying')
        print(json.dumps({'asset': 'fixtures/face-d2/asset.glb', 'sha256': EXPECTED, 'bytes': SIZE, 'status': 'already-verified'}))
        return
    if not ARCHIVE.is_file():
        raise SystemExit('Missing repository archive: research/animation-0.1.0/expression-library/d2-style-variant/asset/bubu-full18-d2-static-blush.glb.gz')
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
    print(json.dumps({'asset': 'fixtures/face-d2/asset.glb', 'sha256': EXPECTED, 'bytes': count, 'status': 'materialized-and-verified'}))

if __name__ == '__main__':
    main()
