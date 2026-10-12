'use strict';
// Usagi limb rig + limb intents (data only; see docs/ADDING_ACTIONS.md).
//
// sockets  – shoulder socket per view/side in rest art space (root bone).
//            The limb root is merged into the body contour at this socket.
// arm      – fixed bone lengths. Arms never stretch: when the paw is closer
//            than the bounded elbow allows, the chain retracts into the socket.
// bends    – named elbow presets: preferred side (out = away from the body
//            centre, down = below the chord) and max elbow bend (fraction of reach).
const freeze = v => Object.freeze(Array.isArray(v) ? v.map(freeze)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, freeze(x)])) : v);

const USAGI_LIMB_RIG = freeze({
  sockets: {
    front: { l: [12, 44], r: [54, 44] },
    'three-quarter': { l: [16, 44], r: [55, 43] },
    profile: { l: [18, 44], r: [55, 43] },
    back: { l: [12, 44], r: [54, 44] }
  },
  arm: { upper: 16, lower: 16 },
  hip: { front: { l: [21, 59], r: [45, 59] } },
  rootRadius: 2.7, wristRadius: 3.6, outline: 1.5, bury: 2.5, socketRadius: 4.6, bodyCentre: [33, 40],
  restReach: 7, releaseReach: 8,
  // Free (support) reaches such as catching: paw stops on this circle around the shoulder pivot.
  supportReach: 11,
  // Max elbow travel in art units per ms when a pose or intent changes.
  elbowSpeed: .045,
  // Cross-fade when a limb intent changes (story beat, release, gesture end).
  intentFadeMs: 200,
  bends: {
    out: { out: 1, down: .3, maxBend: .12 },
    fold: { out: .3, down: 1, maxBend: .16 },
    lateral: { out: 1, down: .4, maxBend: .07 },
    table: { out: .4, down: 1, maxBend: .14 },
    compact: { out: 0, down: 1, maxBend: .03 },
    gesture: { out: 1, down: 0, side: true, maxBend: .044, wristRadius: 3.4, rootRadius: 2.9 },
    support: { out: 1, down: 1, maxBend: .1 }
  }
});

// kind: 'grip' (paw holds/touches something; replaces the authored paw),
//       'gesture' (free arm; far side paints behind the body),
//       'support' (authored paw kept; a limb grows from the socket under it).
const grip = (bend, extra = {}) => freeze({ kind: 'grip', bend, ...extra });
const NOT_NAP = ['rest-nap'];
const USAGI_LIMB_INTENTS = freeze([
  { gesture: 'yawn', intent: { kind: 'gesture', bend: 'gesture' } },
  { gesture: 'high-five', intent: { kind: 'gesture', bend: 'gesture' } },
  { gesture: 'wave', intent: { kind: 'gesture', bend: 'gesture' } },
  { gesture: 'stretch', intent: { kind: 'gesture', bend: 'gesture' } },
  { motion: 'hiccup', props: ['cup'], side: 'r', intent: grip('out') },
  { motion: 'juggle', props: ['balls-l'], intent: grip('out') },
  { motion: 'carry', props: ['energy'], intent: grip('fold') },
  { motion: 'telescope', props: ['telescope'], intent: grip('lateral') },
  { motion: 'look', props: ['binoculars'], intent: grip('out') },
  { contact: 'paper-return', side: 'r', notContact: NOT_NAP, intent: grip('table', { expanded: true }) },
  { props: ['book'], motions: ['read', 'organize', 'breathe'], notContact: NOT_NAP, intent: grip('table', { expanded: true }) },
  { anyProps: ['paper', 'notes', 'chart'], motions: ['write', 'read', 'organize', 'trade'], notContact: NOT_NAP, intent: grip('table', { expanded: true }) },
  { props: ['keyboard'], motion: 'type', notContact: NOT_NAP, intent: grip('table', { expanded: true }) },
  { props: ['laptop'], motions: ['browse', 'organize'], notContact: NOT_NAP, intent: grip('table', { expanded: true }) },
  { props: ['laptop'], motion: 'breathe', notContact: NOT_NAP, intent: grip('table', { expanded: true, whileExtended: true }) },
  { props: ['needle-l', 'needle-r'], motion: 'knit', notContact: NOT_NAP, intent: grip('table', { expanded: true }) },
  { props: ['drum'], motion: 'drum', notContact: NOT_NAP, intent: grip('table', { expanded: true }) },
  { props: ['blocks'], motion: 'build', notContact: NOT_NAP, intent: grip('table', { expanded: true }) },
  { props: ['cup'], motion: 'sip', side: 'r', notContact: NOT_NAP, intent: grip('fold', { expanded: true }) },
  { props: ['cup'], contact: 'rest-tea', side: 'r', intent: grip('fold', { expanded: true }) },
  { props: ['cup'], contact: 'rest-tea', motion: 'carry', intent: grip('fold', { expanded: true }) },
  { props: ['cup'], contact: 'rest-tea', intent: grip('fold', { expanded: true, whileExtended: true }) },
  { props: ['pan'], motion: 'cook', notContact: NOT_NAP, intent: grip('table', { expanded: true }) },
  { props: ['plant'], motion: 'organize', contact: 'rest-plant', side: 'r', intent: grip('table', { expanded: true }) },
  { props: ['broom'], motion: 'sweep', side: 'r', notContact: NOT_NAP, intent: grip('lateral', { expanded: true }) },
  { props: ['umbrella'], motion: 'umbrella', side: 'r', notContact: NOT_NAP, intent: grip('lateral', { expanded: true }) },
  { props: ['snack'], motion: 'picnic', side: 'r', notContact: NOT_NAP, intent: grip('fold', { expanded: true }) },
  { props: ['bubble-wand'], motion: 'float', side: 'r', notContact: NOT_NAP, intent: grip('fold', { expanded: true }) },
  { props: ['microphone'], motion: 'sway', side: 'r', notContact: NOT_NAP, intent: grip('fold', { expanded: true }) },
  { props: ['watering-can'], motion: 'water', side: 'r', notContact: NOT_NAP, intent: grip('lateral', { expanded: true }) },
  { motions: ['umbrella', 'reach'], side: 'r', intent: { kind: 'support', bend: 'support', tuck: true } },
  { intent: { kind: 'support', bend: 'support' } }
]);

// Legs: hip sockets on the body silhouette (root space) and the authored foot
// sole point below each leg pivot. The leg IK keeps the foot exactly where the
// pose puts it (floor contact unchanged) and re-aims/stretches the leg so its
// top always stays at the hip socket. stretch bounds the axial scale.
const USAGI_LEG_RIG = Object.freeze({
  // Pivot -> outer edge of the sole stroke (sole 8.45 + half outline): the
  // fixed point of the leg stretch, so the floor line never moves.
  footDrop: 9.2,
  stretch: Object.freeze([.55, 1.45])
});

export { USAGI_LEG_RIG, USAGI_LIMB_RIG, USAGI_LIMB_INTENTS };
