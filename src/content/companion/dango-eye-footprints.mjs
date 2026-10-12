'use strict';

// Canonical neutral PNGs include a body-coloured margin. These are the measured
// dark-pupil bounds (image width/height, then x/y/width/height), not alpha bounds.
// Pixel tests verify the source pixels; no source art or manifest is rewritten.
const DANGO_EYE_INK_BOUNDS = Object.freeze(Object.fromEntries(Object.entries({
  'views/front/eye-left-neutral.png': [68, 76, 4, 5, 60, 66],
  'views/front/eye-right-neutral.png': [67, 76, 4, 5, 58, 66],
  'views/three-quarter-right/eye-left-neutral.png': [69, 77, 5, 5, 59, 67],
  'views/three-quarter-right/eye-right-neutral.png': [49, 79, 5, 5, 39, 69],
  'views/three-quarter-left/eye-left-neutral.png': [52, 79, 5, 4, 43, 70],
  'views/three-quarter-left/eye-right-neutral.png': [72, 81, 4, 4, 64, 72]
}).map(([key, value]) => [key, Object.freeze(value)])));
export { DANGO_EYE_INK_BOUNDS };
