#!/usr/bin/env python3
"""Behavior and negative regressions for the fixed source registration contract."""
from pathlib import Path
from PIL import Image
import copy
import hashlib
import json
import shutil
import tempfile
import unittest

from check_registration import ROOT, CONTRACT, expected_coverage, validate


class RegistrationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='dango-registration-')
        self.root = Path(self.temporary.name) / 'limbs'
        shutil.copytree(ROOT, self.root, ignore=shutil.ignore_patterns('__pycache__'))

    def tearDown(self):
        self.temporary.cleanup()

    def edit(self, name, operation):
        path = self.root / name
        data = json.loads(path.read_text())
        operation(data)
        path.write_text(json.dumps(data, indent=2) + '\n')

    def test_source_bound_registration_and_all_625_pixels_per_socket(self):
        result = validate(self.root)
        self.assertEqual(result['registeredRoot'], [58.5, 45.5])
        self.assertEqual(result['coveragePixelsChecked'], 7500)
        self.assertEqual(result['fixedGoals'], 40)

    def test_old_coverage_fails_even_with_matching_new_declared_hash(self):
        sockets = json.loads((self.root / 'socket/sockets.json').read_text())['frames']
        socket = copy.deepcopy(sockets[1]); socket['worldRoot'] = [61.5, 45.5]
        old = expected_coverage(self.root, socket)
        old.save(self.root / socket['coverageStencil'])
        old.resize((200, 200), Image.Resampling.NEAREST).save(self.root / socket['coverageProduction'])
        digest = hashlib.sha256((self.root / socket['coverageStencil']).read_bytes()).hexdigest()
        self.edit('limbs.json', lambda d: d['sockets'][1].update(coverageSha256=digest))
        self.edit('socket/sockets.json', lambda d: d['frames'][1].update(coverageSha256=digest))
        def update(d):
            for f in d['frames']:
                if f['src'] == socket['src']: f['coverageSha256'] = digest
                if f['src'] == socket['coverageStencil']: f['sha256'] = digest
        self.edit('sources/rebuild-recipe.json', update)
        with self.assertRaisesRegex(AssertionError, 'source-alpha coverage'):
            validate(self.root)

    def test_coordinated_old_root_metadata_cannot_replace_source_registration(self):
        for name, key in [('limbs.json', 'sockets'), ('socket/sockets.json', 'frames'),
                          ('sources/rebuild-recipe.json', 'frames')]:
            def update(d):
                for f in d[key]:
                    sem = f.get('semantic', {})
                    if (sem.get('attachment'), sem.get('view'), sem.get('side')) == ('shoulder', 'front', 'r'):
                        f['worldRoot'] = [61.5, 45.5]
                        f['anchorOffset'] = [2.9, 5.787179]
            self.edit(name, update)
        with self.assertRaisesRegex(AssertionError, 'registered root'):
            validate(self.root)

    def test_contract_root_cannot_be_relabelled(self):
        self.edit(CONTRACT, lambda d: d.update(worldRoot=[61.5, 45.5]))
        with self.assertRaisesRegex(AssertionError, 'registered root'):
            validate(self.root)

    def test_canonical_body_hash_is_pinned(self):
        self.edit(CONTRACT, lambda d: d['sourceBody'].update(sha256='0' * 64))
        with self.assertRaisesRegex(AssertionError, 'canonical body descriptor'):
            validate(self.root)

    def test_actual_canonical_body_pixel_change_fails(self):
        path = self.root / 'sources/canonical/views/front/body.png'
        image = Image.open(path).convert('RGBA'); image.putpixel((0, 0), (255, 255, 255, 255)); image.save(path)
        with self.assertRaisesRegex(AssertionError, 'canonical body hash'):
            validate(self.root)

    def test_padding_is_checked_not_only_useful_rect(self):
        path = self.root / 'socket/socket-shoulder-r-front-coverage.png'
        image = Image.open(path).convert('RGBA'); image.putpixel((0, 0), (255, 255, 255, 255)); image.save(path)
        with self.assertRaisesRegex(AssertionError, 'source-alpha coverage'):
            validate(self.root)

    def test_8x_mismatch_fails(self):
        path = self.root / 'socket/socket-shoulder-r-front-coverage@8x.png'
        image = Image.open(path).convert('RGBA'); image.putpixel((0, 0), (255, 255, 255, 255)); image.save(path)
        with self.assertRaisesRegex(AssertionError, 'coverage 8x'):
            validate(self.root)

    def test_original_target_cannot_move_to_hide_lattice_error(self):
        def update(d):
            next(p for p in d['poses'] if p['pose'] == 'hold-canonical-cup' and p['side'] == 'right')['requestedWrist'][0] -= 1
        self.edit('validation/fixed-shoulder-targets.json', update)
        with self.assertRaisesRegex(AssertionError, 'original target moved'):
            validate(self.root)


if __name__ == '__main__':
    unittest.main()
