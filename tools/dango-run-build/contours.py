"""Frozen controlled-run-v2 contour authoring, with an injected source layer.

The authored paths and source sampling are unchanged from the approved baseline.
Only the input differs: canonical faceless layers replace the flattened source.
No face pixels are erased from a rendered pose and no artwork is regenerated.
"""
from PIL import Image, ImageDraw
import numpy as np
from scipy.ndimage import binary_erosion, distance_transform_edt
from scipy.interpolate import PchipInterpolator

STANCE = .38
GROUND = 448
FORWARD = 331
BACK = 211
LOOP_MS = 950
LEAN_DEGREES = 3.5
LEAN_CENTER = (256, 410)
SWING_X = PchipInterpolator([STANCE, .53, .74, 1], [BACK, 202, 258, FORWARD])
SWING_Y = PchipInterpolator([STANCE, .51, .68, .82, .92, 1], [GROUND, 426, 422, 434, 442, GROUND])
BOB = PchipInterpolator([0, .12, .28, .40, .46, .5], [-2, 0, -2, -4, -3, -2])


def foot(phase):
    phase %= 1
    if phase < STANCE:
        return FORWARD + (BACK - FORWARD) * phase / STANCE, GROUND, True
    return float(SWING_X(phase)), float(SWING_Y(phase)), False


def translated(array, lift):
    result = np.zeros_like(array)
    if lift >= 0:
        result[lift:] = array[:array.shape[0] - lift]
    else:
        result[:lift] = array[-lift:]
    return result


def rotate(image):
    return image.rotate(-LEAN_DEGREES, resample=Image.Resampling.NEAREST, center=LEAN_CENTER)


class ContourCycle:
    def __init__(self, source):
        self.source = np.array(rotate(source))
        height, width = self.source.shape[:2]
        self.yy, self.xx = np.mgrid[:height, :width]
        interior = (self.source[:, :, 3] > 128) & (self.source[:, :, :3].max(axis=2) > 155)
        _, indices = distance_transform_edt(~interior, return_indices=True)
        self.fill = self.source[indices[0], indices[1], :3]
        self.torso = (self.source[:, :, 3] > 128) & (self.yy <= 409 - 35 * ((self.xx - 250) / 175) ** 2)

    def pose(self, phase):
        height, width = self.source.shape[:2]
        lift = 2 * round(float(BOB(phase % .5)) / 2)
        base = translated(self.torso, lift)
        material = translated(self.fill, lift)
        torso = base.copy()
        feet = []
        for side, offset, root_x in [('far', .5, 257), ('near', 0, 288)]:
            x, y, contact = foot(phase + offset)
            width_px, height_px = (96, 46) if side == 'near' else (87, 42)
            mask = Image.new('L', (width, height))
            draw = ImageDraw.Draw(mask)
            draw.ellipse((x - width_px / 2, y - height_px, x + width_px / 2, y + 4), fill=255)
            draw.rectangle((0, round(y) + 1, width, height), fill=0)
            draw.polygon([(root_x - 35, 367 + lift), (root_x + 35, 367 + lift),
                          (x + width_px / 2 - 3, y - height_px * .50),
                          (x - width_px / 2 + 3, y - height_px * .50)], fill=255)
            mask = np.array(mask) > 128
            sx = np.clip(np.rint(self.xx - x + 333), 279, 392).astype(int)
            sy = np.clip(np.rint(self.yy - y + 441), 392, 441).astype(int)
            texture = self.fill[sy, sx].copy()
            if side == 'far':
                texture = np.clip(texture.astype(float) * .85, 0, 255).astype(np.uint8)
            material = np.where((mask & ~torso)[:, :, None], texture, material)
            base |= mask
            feet.append({'side': side, 'x': x, 'y': y, 'support': contact, 'root': [root_x, 367 + lift]})
        border = base & ~binary_erosion(base, iterations=9)
        result = np.dstack([material, base.astype(np.uint8) * 255])
        result[border, :3] = [12, 6, 27]
        protected = translated(self.source, lift)
        result[:365 + lift] = protected[:365 + lift]
        image = Image.fromarray(result).resize((256, 256), Image.Resampling.NEAREST)
        return image, {'phase': phase, 'bodyY': lift, 'feet': feet}
