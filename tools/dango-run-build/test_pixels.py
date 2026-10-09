"""Explicit pixel tests; run python tools/dango-run-build/test_pixels.py."""
import unittest
import sys

import numpy as np
from PIL import Image
from scipy.ndimage import label

sys.dont_write_bytecode = True
from build import BASELINE, DEFAULT_OUTPUT, FRAME_COUNT, canonical_layers
from contours import ContourCycle, rotate, translated


class LayerSeparationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source, cls.body, cls.face, _, _ = canonical_layers()

    def test_canonical_layers_recompose_exactly_before_contour_authoring(self):
        np.testing.assert_array_equal(Image.alpha_composite(self.body, self.face), self.source)

    def test_all_frames_mask_material_and_preserve_baseline(self):
        cycle = ContourCycle(self.body)
        rotated_face = np.array(rotate(self.face))
        for index in range(FRAME_COUNT):
            with self.subTest(phase=index):
                name = f'run-{index:02d}.png'
                body = Image.open(DEFAULT_OUTPUT / 'body' / name)
                mask = np.array(Image.open(DEFAULT_OUTPUT / 'mask' / name))
                body_pixels = np.array(body)
                self.assertEqual(body.mode, 'RGBA')
                self.assertEqual(body.size, (256, 256))
                np.testing.assert_array_equal(mask[:, :, 3], body_pixels[:, :, 3])
                self.assertTrue(np.all(mask[:, :, :3] == 255))
                self.assertTrue(set(np.unique(mask[:, :, 3])).issubset({0, 255}))
                self.assertEqual(label(body_pixels[:, :, 3] > 0)[1], 1)
                regenerated, meta = cycle.pose(index / FRAME_COUNT)
                np.testing.assert_array_equal(body, regenerated)
                overlay = Image.fromarray(translated(rotated_face, meta['bodyY'])).resize((256, 256), Image.Resampling.NEAREST)
                baseline = Image.open(BASELINE / 'frames' / name)
                np.testing.assert_array_equal(Image.alpha_composite(body, overlay), baseline)
                # Protected upper source is entirely faceless before authoring.
                protected = Image.fromarray(translated(cycle.source, meta['bodyY'])).resize((256, 256), Image.Resampling.NEAREST)
                np.testing.assert_array_equal(body_pixels[:178], np.array(protected)[:178])


if __name__ == '__main__':
    unittest.main()
