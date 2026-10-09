'use strict';

// Semantic action props stay intact across form adaptation. Composite tools
// expand here; an explicit "none" never borrows a motion's default equipment.
const PROP_SETS = Object.freeze(Object.fromEntries(Object.entries({
  none: [], tail: [], book: ['book'], document: ['paper', 'pen'],
  keyboard: ['keyboard'], laptop: ['laptop'], 'ai-chat': ['laptop', 'ellipsis'], chart: ['chart'], notes: ['notes'],
  plant: ['plant'], pillow: ['pillow'], cup: ['cup'], blanket: ['blanket'], snack: ['snack'],
  headband: ['headband'], butterfly: ['butterfly'], laser: ['laser'],
  balls: ['balls-l', 'balls-r', 'balls-top'], energy: ['energy'], hole: ['hole'],
  mirror: ['mirror'], microphone: ['microphone'], ellipsis: ['ellipsis'],
  treasure: ['shovel', 'treasure'], 'sleep-cap': ['sleep-cap'], tissue: ['tissue'],
  'bubble-wand': ['bubble-wand'], cushion: ['cushion'], 'high-five': ['high-five'],
  'music-notes': ['music-notes'], binoculars: ['binoculars'], plane: ['plane'],
  broom: ['broom'], hat: ['hat', 'star'], telescope: ['telescope'],
  'watering-can': ['watering-can', 'plant'], yarn: ['yarn', 'needle-l', 'needle-r'],
  drum: ['drum'], 'sparkle-shoes': ['shoe-glint-l', 'shoe-glint-r'], box: ['box'], blocks: ['blocks'],
  star: ['star'], umbrella: ['umbrella'], picnic: ['picnic', 'snack'],
  gloves: ['gloves-l', 'gloves-r'], pan: ['pan'], camera: ['camera']
}).map(([id, props]) => [id, Object.freeze(props)])));

const PROP_NAMES = Object.freeze([...new Set([
  'paper', 'pen', 'shovel', ...Object.values(PROP_SETS).flat()
])]);

function resolveMotionProps(defaultProps = [], semanticProp, motion) {
  if (typeof semanticProp === 'string') {
    const selected = PROP_SETS[semanticProp];
    if (!selected) return Object.freeze([]);
    // Writing a margin/chart/ sticky note still needs the pen, while reading
    // the same paper should not inherit writing equipment.
    if (motion === 'write' && ['notes', 'chart', 'book'].includes(semanticProp)) {
      return Object.freeze([...selected, 'pen']);
    }
    return selected;
  }
  return Object.freeze([...new Set(defaultProps.flatMap(id => PROP_SETS[id] || [id]))]);
}

// Art-space centers agreed with the SVG source. Hand props use their rig bone
// pivot instead, so wrist rotation never detaches the tool from its paw.
const PROP_PIVOTS = Object.freeze({
  'balls-l': [17, 8], 'balls-r': [49, 8], 'balls-top': [33, -1],
  butterfly: [60, 14], laser: [65, 60], star: [62, 8],
  'high-five': [58, 27], blocks: [35, 63], treasure: [34, 62],
  notes: [33, 56], mirror: [53, 43], camera: [33, 49], hat: [33, 58],
  umbrella: [69, 47]
});
const smooth = t => t * t * (3 - 2 * t);
function windowWeight(t, start, rise, fall, end) {
  if (t <= start || t >= end) return 0;
  if (t < rise) return smooth((t - start) / (rise - start));
  if (t <= fall) return 1;
  return 1 - smooth((t - fall) / (end - fall));
}

function samplePropPoses(motion, progress) {
  const phase = progress * Math.PI * 2;
  const sin = Math.sin(phase), cos = Math.cos(phase);
  const poses = {};
  if (motion === 'juggle') {
    for (const [i, id] of ['balls-l', 'balls-r', 'balls-top'].entries()) {
      const angle = phase + i * Math.PI * 2 / 3;
      poses[id] = { x: Math.sin(angle) * 6, y: -Math.cos(angle) * 5, r: Math.sin(angle) * 0.25 };
    }
  }
  if (motion === 'dash') {
    poses.butterfly = { x: sin * 6, y: Math.sin(phase * 2) * 3, r: sin * 0.12 };
    poses.laser = { x: sin * 10, y: -2 + cos * 2 };
  }
  if (motion === 'reach') poses.star = { x: -sin * 5, y: (1 - cos) * 7, r: sin * 0.2 };
  if (motion === 'high-five') poses['high-five'] = { x: -windowWeight(progress, 0.15, 0.4, 0.6, 0.85) * 5, r: sin * 0.08 };
  if (motion === 'glide') {
    const fly = windowWeight(progress, 0.25, 0.5, 0.6, 0.95);
    poses.plane = { x: fly * 20, y: -fly * 12, r: -fly * 0.2 };
  }
  if (motion === 'organize') poses.notes = { x: sin * 1.8, y: -(1 - cos) * 0.8, r: sin * 0.05 };
  if (motion === 'build') poses.blocks = { y: -windowWeight(progress, 0.15, 0.35, 0.45, 0.7) * 3 };
  if (motion === 'dig') {
    const reveal = windowWeight(progress, 0.52, 0.7, 0.85, 0.98);
    poses.treasure = { y: (1 - reveal) * 6, opacity: reveal };
    poses.shovel = { opacity: 1 - reveal * 0.85 };
  }
  if (motion === 'magic') {
    const reveal = windowWeight(progress, 0.43, 0.65, 0.78, 0.98);
    poses.star = { x: -22, y: 24 - reveal * 12, r: reveal * 0.25, opacity: reveal };
    poses.hat = { r: sin * 0.035 };
  }
  // Umbrella is now gripped at the right paw; do not independently rotate its shaft away from that contact.
  if (motion === 'moonwalk') {
    poses['shoe-glint-l'] = { opacity: .65 + .35 * Math.max(0, sin) };
    poses['shoe-glint-r'] = { opacity: .65 + .35 * Math.max(0, -sin) };
  }
  if (motion === 'pose') poses.camera = { y: -windowWeight(progress, 0.1, 0.35, 0.65, 0.9) * 2 };
  if (motion === 'look') poses.binoculars = { y: -windowWeight(progress, 0.05, 0.3, 0.7, 0.95) * 2 };
  if (motion === 'water') poses.plant = { r: sin * 0.025 };
  if (motion === 'knit') poses.yarn = { r: sin * 0.08 };
  if (motion === 'drum') poses.drum = { y: -(1 - Math.cos(phase * 2)) * 0.25 };
  return Object.freeze(Object.fromEntries(Object.entries(poses).map(([id, pose]) => [id, Object.freeze(pose)])));
}

function resolveRigProps(viewData, sample, layer) {
  const drawn = [];
  const missing = [];
  for (const id of sample?.props || []) {
    const prop = viewData?.props?.[id];
    if (!prop) { missing.push(id); continue; }
    if (!layer || propLayer(prop) === layer) drawn.push(Object.freeze({ id, prop }));
  }
  return Object.freeze({ drawn: Object.freeze(drawn), missing: Object.freeze(missing) });
}

// Transient props never enter the cached body sprite, even if authored there.
function propLayer(prop) { return prop.layer === 'back' ? 'back' : 'front'; }

export { PROP_SETS, PROP_NAMES, PROP_PIVOTS, resolveMotionProps, samplePropPoses, resolveRigProps, propLayer };
export default Object.freeze({ PROP_SETS, PROP_NAMES, PROP_PIVOTS, resolveMotionProps, samplePropPoses, resolveRigProps, propLayer });
