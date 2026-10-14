'use strict';
// Per-form story anchors in each form's own art space. A story never reads
// another form's pixels: dango and usagi each declare their own table, so a
// rig or raster change for one form is tuned here without touching the other.
// `space` documents the coordinate box; `toSpace` converts normalized [0..1]
// points for authoring tools.
const freeze = value => Object.freeze(Array.isArray(value) ? value.map(freeze)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, freeze(v)])) : value);
const USAGI_PAPER = { rest: [59, 49], ready: [64, 46], release: [69, 43], hold: [63, 48],
  // Two joined cubics: out-and-up hook, then back to the release grip.
  flight: [[69, 43], [89, 40], [94, 8], [82, 10], [70, 12], [69, 34], [69, 43]] };
const STORY_ANCHORS = freeze({
  'paper-return': {
    usagi: { space: [99, 99], ...USAGI_PAPER },
    // Dango's raster fin grip was verified against these same points; it now
    // owns a copy that can diverge without moving usagi.
    dango: { space: [99, 99], ...USAGI_PAPER }
  },
  'hat-star': {
    usagi: { space: [99, 99], brim: [33, 55], side: [77, 55], reveal: [77, 29], belly: [55, 61], outer: [81, 42] },
    dango: { space: [99, 99], brim: [33, 55], side: [77, 55], reveal: [77, 29], belly: [55, 61], outer: [81, 42] }
  }
});
function storyAnchors(story, formId = 'usagi') {
  const table = STORY_ANCHORS[story];
  if (!table) throw new RangeError(`unknown story ${story}`);
  return table[formId] || table.usagi;
}
const toSpace = (anchors, [u, v]) => [u * anchors.space[0], v * anchors.space[1]];
const toNormalized = (anchors, [x, y]) => [x / anchors.space[0], y / anchors.space[1]];
export { STORY_ANCHORS, storyAnchors, toSpace, toNormalized };
// Floor line of each form's composed body, as a fraction of the square body
// canvas (measured from the idle raster's lowest opaque row). Accents pivot here.
const BODY_FLOOR = Object.freeze({ usagi: 323 / 438, dango: 311 / 438 });
const bodyFloor = (formId, size) => (BODY_FLOOR[formId] ?? BODY_FLOOR.usagi) * size;
export { BODY_FLOOR, bodyFloor };
