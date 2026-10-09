// Editable vector reconstruction of the user's Usagi 2.0 reference sheets.
// Generates the layered authoring SVG; the normal rig compiler owns runtime data.
import fs from 'node:fs';
import { EYE_FALLBACKS, MOUTH_FALLBACKS } from '../../src/capabilities/companion/presentation/rig/face.mjs';

const ink = '#351710', cream = '#fff5de', pink = '#ffc4d0';
const mint = '#a4d5c0', blue = '#a4bad7', gold = '#edd18b', lavender = '#c5add9';
const path = (d, fill = 'none', width = 1.25, stroke = ink) =>
  `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${width}"/>`;
const ellipse = (x, y, rx, ry, fill, stroke = 'none', width = 0) =>
  `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${fill}" stroke="${stroke}" stroke-width="${width}"/>`;
const bone = (name, pivot, layer, content) => `<g data-bone="${name}" data-pivot="${pivot}" data-layer="${layer}">${content}</g>`;
const anchor = (slot, x, y) => `<circle data-anchor="usagi.${slot}" cx="${x}" cy="${y}" r="1"/>`;
const prop = (name, content) => `<g data-prop="${name}" data-layer="${['hole', 'umbrella'].includes(name) ? 'back' : 'front'}" style="display:none">${content}</g>`;

const views = {
  front: { ears: [25, 40], eyes: [23, 43], cheeks: [13, 53], mouth: 33, arms: [11, 55], legs: [21, 45],
    outline: 'M21 1 C6 4 0 15 1 29 C1 36 5 41 12 44 C8 48 10 58 16 61 Q33 65 50 61 C56 58 58 48 54 44 C61 41 65 35 65 27 C66 13 58 4 45 1',
    bridge: 'M30 0 Q33 -1 35 0' },
  'three-quarter': { ears: [29, 39], eyes: [36, 53], cheeks: [26, 57], mouth: 46, arms: [17, 48], legs: [27, 45],
    outline: 'M25 1 C10 3 3 15 4 29 C4 36 9 41 16 44 C12 51 15 59 21 62 Q37 65 51 60 C57 56 58 48 55 43 C62 40 67 33 65 23 C64 10 56 3 48 1',
    bridge: 'M34 0 Q36 -1 38 0' },
  profile: { ears: [33, 40], eyes: [50], cheeks: [44], mouth: 58, arms: [19, 45], legs: [31, 45],
    outline: 'M26 1 C13 3 7 15 8 28 C8 36 12 41 18 44 C14 50 18 60 25 62 Q40 67 53 59 C58 54 58 48 55 43 C62 40 65 36 65 29 Q68 27 64 25 C64 12 54 3 44 1',
    bridge: 'M34 0 L35 0' },
  back: { ears: [25, 40], eyes: [], cheeks: [], mouth: 33, arms: [11, 55], legs: [21, 45],
    outline: 'M21 1 C6 4 0 15 1 29 C1 36 5 41 12 44 C8 48 10 58 16 61 Q33 65 50 61 C56 58 58 48 54 44 C61 41 65 35 65 27 C66 13 58 4 45 1',
    bridge: 'M30 0 Q33 -1 35 0' }
};

function ears(v, back) {
  return v.ears.map((x, i) => {
    const far = (v.eyes.length === 1 && !i) || (v.mouth > 40 && v.eyes.length === 2 && i);
    const shape = path(`M-5 5 C-9 -8 -5 -27 1 -27 C8 -27 7 -12 4 5 Z`, far ? '#f2e3c6' : cream, 1.7)
      + (!back ? path('M-1 1 C-4 -6 -2 -22 1 -22 C5 -22 4 -6 2 1Z', far ? '#edb4c1' : pink, 0) : '');
    return bone(i ? 'ear_r' : 'ear_l', `${x},3`, 'back',
      `<g transform="translate(${x} 0)${far ? ' translate(0 2) scale(.8 .94)' : ''}">${shape}</g>`
      + (i ? anchor('earwear', x, -3) : ''));
  }).join('');
}

// Each eye is authored around its own origin. The runtime can close the lids
// continuously and converge the eyes without moving brows with the gaze.
function eyeMark(state, i) {
  const stroke = d => path(d, 'none', 1.45);
  const glossy = (rx, ry, y = 0) => ellipse(0, y, rx, ry, '#21100d')
    + ellipse(-.9, y - ry * .38, Math.min(1.2, rx * .38), .9, '#fffdfa')
    + ellipse(.8, y + ry * .45, .6, .45, '#fffdfa');
  const eyebrow = d => path(d, 'none', 1.1);
  let pupil, brow;
  switch (state) {
    case 'closed': pupil = stroke('M-3 -.3 Q0 1.8 3 -.3'); brow = eyebrow('M-3 -8 Q0 -9 3 -8'); break;
    case 'sleepy': pupil = stroke('M-3 0 Q0 3 3 0 M-3 0 l-1 -.7'); brow = eyebrow('M-3 -6 Q0 -7 3 -6'); break;
    case 'droopy': pupil = path('M-3 -1 Q0 .8 3 -1 Q3 4 0 4 Q-3 4 -3 -1Z', ink, 0)
      + ellipse(-.5, 1.5, .85, .7, '#fffdfa'); brow = eyebrow('M-4 -6 Q0 -5 3 -8'); break;
    case 'half': pupil = path('M-3 -1 H3 V1.4 Q0 4.8 -3 1.4Z', ink, 0)
      + ellipse(-.8, .5, .85, .6, '#fffdfa'); brow = eyebrow('M-3 -8 H3'); break;
    case 'smile': pupil = stroke('M-3 1 Q0 -4 3 1'); brow = eyebrow('M-3 -8 Q0 -10 3 -8'); break;
    case 'content': pupil = stroke('M-3 -1 Q0 2 3 -1'); brow = eyebrow('M-3 -7 Q0 -8 3 -7'); break;
    case 'sparkle': pupil = ellipse(0, 0, 4.2, 4.8, '#21100d')
      + path('M-.6 -3.5 L.2 -1.3 L2.5 -.6 L.2 .2 L-.6 2.5 L-1.3 .2 L-3.2 -.6 L-1.3 -1.3Z', '#fffdfa', 0)
      + ellipse(1.6, 2.4, .85, .85, '#fffdfa'); brow = eyebrow('M-3 -9 Q0 -11 3 -9'); break;
    case 'wide': pupil = glossy(4, 4.8); brow = eyebrow('M-4 -9 Q0 -12 4 -9'); break;
    case 'surprised': pupil = ellipse(0, 0, 3.6, 4.5, '#fffdfa', ink, 1.25)
      + ellipse(0, .2, 1.6, 2.25, ink); brow = eyebrow('M-3 -10 Q0 -13 3 -10'); break;
    case 'curious': pupil = glossy(i ? 3.2 : 3.7, i ? 3.4 : 4.3, i ? .6 : -.5);
      brow = eyebrow(i ? 'M-3 -7 Q0 -6 3 -7' : 'M-4 -10 Q0 -13 3 -10'); break;
    case 'focused': pupil = path('M-3 -2 L3 -1 Q3 3 0 3.2 Q-3 3 -3 -2Z', ink, 0)
      + ellipse(-.7, -.5, .9, .65, '#fffdfa'); brow = eyebrow(i ? 'M-4 -7 L3 -9' : 'M-3 -9 L4 -7'); break;
    case 'determined': pupil = path(i ? 'M-3 -1 L3 -3 Q4 3 0 3.5 Q-3 3 -3 -1Z'
      : 'M-3 -3 L3 -1 Q3 3 0 3.5 Q-4 3 -3 -3Z', ink, 0)
      + ellipse(i ? .7 : -.7, -.1, .9, .7, '#fffdfa'); brow = eyebrow(i ? 'M-4 -6 L3 -9' : 'M-3 -9 L4 -6'); break;
    case 'pleading': pupil = glossy(4.1, 4.5, .3) + ellipse(.4, 3.6, 2.8, .9, '#c5e7ed')
      + ellipse(1.8, -.2, .8, .8, '#fffdfa'); brow = eyebrow(i ? 'M-4 -10 Q0 -7 4 -7' : 'M-4 -7 Q0 -7 4 -10'); break;
    case 'shy': pupil = glossy(2.7, 3.1, 1.3); brow = eyebrow(i ? 'M-3 -7 Q0 -6 3 -5' : 'M-3 -5 Q0 -6 3 -7'); break;
    case 'waiting': pupil = glossy(3.1, 3.8, -.8); brow = eyebrow('M-3 -9 Q0 -9.7 3 -9'); break;
    default: pupil = glossy(3.35, 3.8); brow = eyebrow(i ? 'M-4 -12 Q2 -14 5 -7' : 'M-5 -7 Q-2 -14 4 -12');
  }
  return { pupil, brow };
}

function eyes(v, state) {
  const shapes = v.eyes.map((x, i) => {
    const { pupil, brow } = eyeMark(state, i);
    const scale = v.eyes.length === 2 && v.mouth > 40 && i ? .82 : 1;
    return `<g transform="translate(${x} 25) scale(${scale} 1)">${brow}<g data-pupil="">${pupil}</g></g>`;
  }).join('');
  return `<g data-face="eyes:${state}" style="display:none">${shapes}</g>`;
}

function mouth(v, state) {
  const x = v.mouth, y = v.eyes.length === 1 ? 30 : 33;
  const signature = 'M-4 -1 Q-4 2 -1.5 1 Q0 0 0 -1 Q0 3 3 1 Q4 0 4 -1';
  const lipScale = state === 'closed' ? .84 : state === 'wavy' ? .92 : 1;
  // This two-wave upper lip is identity-bearing, even while talking or chewing.
  // Cream above its contour cuts the lobes cleanly out of each lower opening.
  const lip = `<g transform="scale(${lipScale} 1)">`
    + path(signature + ' L4 -3 H-4Z', cream, 0)
    + path(signature, 'none', 1.4) + '</g>';
  const lower = {
    neutral: '',
    closed: path('M-1.4 2.5 Q0 2.9 1.4 2.5', 'none', .7),
    smile: path('M-2.5 1 Q0 5 2.5 1', 'none', 1.1),
    grin: path('M-3.5 .5 H3.5 Q3.7 7.5 0 7.5 Q-3.7 7.5 -3.5 .5Z', ink, 1)
      + path('M-2.5 1.1 H2.5 L2 2.8 H-2Z', '#fffdfa', 0)
      + path('M-2 5.3 Q0 3.6 2 5.3 Q0 8 -2 5.3Z', pink, 0),
    open: path('M-2.8 .5 H2.8 Q4 8 0 8.5 Q-4 8 -2.8 .5Z', ink, 1)
      + path('M-2.1 5.4 Q0 3.7 2.1 5.4 Q1 8 -1 8Z', pink, 0),
    talk: path('M-2.7 .6 H2.7 Q2.8 5.1 0 5.1 Q-2.8 5.1 -2.7 .6Z', ink, 1)
      + ellipse(0, 3.7, 1.7, .8, pink),
    surprised: ellipse(0, 3.3, 1.65, 3, ink) + ellipse(-.4, 3.2, .55, .8, '#865145'),
    chew: path('M1.3 2.7 Q4.2 4.3 4.8 1.5 M4.6 1 Q6 2.4 4.4 4.5', 'none', 1.05),
    wavy: path('M-2.8 3 Q-1.4 1.5 0 3 Q1.4 4.5 2.8 3', 'none', 1)
  };
  return `<g data-face="mouth:${state}" style="display:none" transform="translate(${x} ${y}) scale(${v.eyes.length === 1 ? .65 : 1} 1)">${lower[state]}${lip}</g>`;
}

const at = (x, y, content) => `<g transform="translate(${x} ${y})">${content}</g>`;
const rect = (x, y, width, height, fill, radius = 1.5) =>
  `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${fill}" stroke="${ink}" stroke-width="1.1"/>`;
const star = (x, y, r = 4, fill = gold) => path(Array.from({ length: 10 }, (_, i) => {
  const a = i * Math.PI / 5 - Math.PI / 2, radius = i % 2 ? r * .48 : r;
  return `${i ? 'L' : 'M'}${(x + Math.cos(a) * radius).toFixed(2)} ${(y + Math.sin(a) * radius).toFixed(2)}`;
}).join(' ') + 'Z', fill, .9);

// Props share a restrained outline and pastel material palette. Hand tools are
// local to the hand pivot; stage objects keep explicit, stable art-space pivots.
function props(x, y, hand) {
  const needle = path('M-4 5 L4 -6', 'none', 1.35, '#97735b') + ellipse(4, -6, 1, 1, gold, ink, .6);
  if (!hand) return prop('needle-l', at(x, y, needle))
    + prop('gloves-l', at(x, y, path('M-4 -4 Q-8 -3 -6 2 L-5 5 H3 Q7 3 5 -2 Q4 -6 0 -5Z', '#d9a7bb') + path('M-4 3 H3', 'none', .8)));
  const contents = {
    umbrella: at(0, -1, path('M0 -48 V2 Q0 5 -3 5 Q-5 5 -5 2', 'none', 1.8, '#9e806e')
      + path('M-15 -47 Q-7 -61 0 -62 Q7 -61 15 -47 Q11 -50 7.5 -46 Q4 -49 0 -46 Q-4 -49 -7.5 -46 Q-11 -50 -15 -47Z', '#afc7df', 1.2)
      + path('M0 -62 V-46 M0 -62 Q7 -57 7.5 -46 M0 -62 Q-7 -57 -7.5 -46', 'none', .8, '#7e9cb7')),
    mirror: at(-49, -61, path('M50 51 L49 62', 'none', 3.5, '#aa93bd') + ellipse(53, 43, 9, 11, lavender, ink, 1.1)
      + ellipse(53, 43, 6.5, 8.5, '#dcebf0', ink, .6)
      + path('M49.7 42 C48.8 37 50 36.5 51 37 Q52.2 38 52 41.2 H53.4 Q53 37 54.5 36.8 Q56.2 36.5 55.7 42', cream, .6)
      + ellipse(53, 45, 4.5, 4.2, cream, ink, .6)
      + ellipse(51.4, 44.5, .65, .85, ink) + ellipse(54.6, 44.5, .65, .85, ink)
      + ellipse(49.8, 46, 1, .65, pink) + ellipse(56.2, 46, 1, .65, pink)
      + path('M51.9 46.2 Q51.8 47.4 53 46.7 Q54.2 47.4 54.1 46.2', 'none', .55)
      + path('M48.8 39.4 L50 38.1', 'none', .8, '#fffdfa')),
    cup: path('M-4 -4 H4 V3 Q0 7 -4 3Z', mint) + path('M4 -2 Q10 -3 7 2 Q6 3 4 2', 'none', 1.1)
      + ellipse(0, -4, 4, 1, '#fffdfa', ink, .8) + path('M-2 -4 H2', 'none', .7, '#9c7051'),
    snack: path('M-4 -2 Q-3 -6 1 -5 Q3 -4 2 -2 Q5 -2 5 1 Q4 5 0 5 Q-5 4 -4 -2Z', '#e8bd82', 1.1)
      + ellipse(-1.6, -.8, .7, .7, '#95614c') + ellipse(.8, 2.2, .7, .7, '#95614c'),
    pen: path('M-1 3 L3 -10', 'none', 2.4, ink) + path('M-.8 1 L2.3 -8', 'none', 1.4, lavender)
      + path('M-1 3 L-1.6 5 L.2 3.2Z', gold, .5),
    shovel: path('M0 0 L6 13', 'none', 2, '#97735b') + path('M2 12 L9 9 Q14 18 8 20Z', '#a6c6cd')
      + path('M-1 -2 Q-6 -6 -2 -8 Q2 -10 3 -5Z', 'none', 1.6, '#97735b'),
    'watering-can': path('M-5 -6 H4 L5 3 Q0 6 -5 3Z', blue) + ellipse(-.5, -6, 4.5, 1.2, '#d9e7ef', ink, .8)
      + path('M4 -2 L10 -6 L12 -5 L6 3Z', blue) + path('M-5 -4 Q-12 -6 -9 1 Q-7 3 -5 1', 'none', 1.6),
    broom: path('M0 -12 L0 9', 'none', 2, '#97735b') + path('M-3 6 L3 6 L6 17 Q0 19 -6 17Z', gold)
      + path('M-2 9 L-3 16 M1 9 L2 16 M-3 8 H3', 'none', .6, '#b09157'),
    microphone: path('M-1 5 L1 -4', 'none', 3, ink) + ellipse(2, -6, 3.5, 4.5, blue, ink, 1)
      + path('M-.4 -8 L4 -6 M-1 -5 L3.4 -3', 'none', .8, '#fffdfa'),
    'bubble-wand': path('M0 5 L0 -4', 'none', 1.6, lavender) + ellipse(0, -7, 3, 3, 'none', lavender, 1.8)
      + ellipse(7, -14, 3, 3, '#e0f2f0', '#8daebd', .8) + ellipse(11, -19, 1.8, 1.8, '#eee5f3', '#a49ab8', .6),
    telescope: path('M-3 1 L12 -7 L15 -1 L0 7Z', blue) + path('M10 -8 L13 -9 L17 -1 L14 1Z', gold)
      + path('M-4 1 L-1 -1 L2 5 L-1 7Z', lavender),
    plane: path('M-8 -4 L12 -10 L2 6 L0 -1Z', '#eaf0f6') + path('M0 -1 L12 -10 M2 6 L-1 2', 'none', .8),
    energy: star(0, -1, 6),
    tissue: path('M-5 -3 L-1 -5 L2 -2 L6 -4 L5 4 L1 6 L-4 3Z', '#fffdfa', .9)
      + path('M-1 -2 L1 3 M3 -1 L3 3', 'none', .6, '#d3cbc3'),
    pan: path('M-2 0 L7 -4', 'none', 2.8, ink) + ellipse(-7, 3, 7, 3.8, '#7f9aab', ink, 1.2)
      + ellipse(-7, 2.6, 4.4, 2, '#fff5cf') + ellipse(-6.6, 2.5, 1.8, 1.2, gold),
    'needle-r': needle,
    'gloves-r': path('M-4 -4 Q-8 -3 -6 2 L-5 5 H3 Q7 3 5 -2 Q4 -6 0 -5Z', '#d9a7bb') + path('M-4 3 H3', 'none', .8)
  };
  return Object.entries(contents).map(([name, content]) => prop(name, at(x, y, content))).join('')
    + anchor('umbrella-grip', x, y - 1);
}

function stageProps(v) {
  const leaf = (x, y, flip = 1) => path(`M${x} ${y} q${-8 * flip} -1 ${-7 * flip} -7 q${8 * flip} 0 ${7 * flip} 7Z`, mint, 1);
  const ball = (x, y, color) => ellipse(x, y, 3.8, 3.8, color, ink, 1) + path(`M${x - 2} ${y - 2} q2 -1 3 1`, 'none', .8, '#fffdfa');
  const keys = Array.from({ length: 3 }, (_, row) => Array.from({ length: 7 }, (_, col) =>
    path(`M${23 + col * 3} ${56 + row * 2} h1.4`, 'none', .7, '#7d9295')).join('')).join('');
  const contents = {
    book: path('M20 45 Q27 43 33 47 Q39 43 46 45 L46 60 Q39 58 33 62 Q27 58 20 60Z', blue)
      + path('M22 46 Q28 45 33 48 Q39 45 44 46 L44 57 Q38 56 33 60 Q28 56 22 57Z', '#fff7e7', .65)
      + path('M33 48 V61 M25 49 L30 50 M36 50 L41 49 M25 52 L30 53 M36 53 L41 52', 'none', .65, '#9b9890'),
    paper: path('M23 53 H43 L46 64 H21Z', '#fffdfa') + path('M26 57 H39 M25 60 H41', 'none', .7, '#8fabb5')
      + path('M38 54 L40 56 L43 53', 'none', .9, mint),
    blanket: path('M13 52 Q33 49 54 52 L57 65 Q33 70 10 65Z', '#bddbd3', 1.1)
      + path('M13 60 Q33 64 55 60', 'none', 1.2, '#8ab2a8') + star(23, 57, 2.5, '#edf2dd') + star(42, 60, 2.3, '#edf2dd'),
    keyboard: path('M23 53 H43 L48 64 H18Z', '#d3e1dd') + keys + path('M27 62 H38', 'none', 1, '#7d9295'),
    laptop: path('M18 45 Q18 43 20 43 H44 Q46 43 46 45 L44 61 H21Z', mint)
      + path('M21 61 H45 L52 65 H16Z', '#cbe4dc') + ellipse(32, 52, 1.5, 1.8, '#f8f3de')
      + path('M30.8 51 L30.2 48 M33 51 L33.7 48', 'none', 1.1, '#f8f3de'),
    chart: rect(21, 46, 27, 18, '#fffdfa') + path('M25 60 L30 56 L34 58 L40 50 L43 52', 'none', 1.6, '#86b4a2')
      + path('M25 50 V61 H44', 'none', .6, '#b5b2b2'),
    notes: rect(20, 51, 15, 13, blue) + rect(28, 48, 17, 13, gold)
      + path('M32 52 H41 M32 55 H38 M24 56 H26 M24 59 H26', 'none', .8, '#88795f'),
    pillow: path('M10 56 Q7 53 12 52 Q23 49 34 52 Q39 50 38 56 Q40 63 34 64 Q22 67 11 63 Q8 62 10 56Z', lavender),
    cushion: ellipse(33, 65, 22, 6, '#cfc1df', ink, 1.1) + path('M15 64 Q33 69 51 64', 'none', .8, '#ae9abd'),
    plant: path('M55 55 H69 L67 68 H57Z', '#dba983') + path('M62 55 V46', 'none', 1.2, '#709876')
      + leaf(62, 50) + leaf(62, 46, -1) + path('M56 58 H68', 'none', .7, '#a8775d'),
    yarn: ellipse(56, 61, 7, 7, lavender, ink, 1.1) + path('M51 56 Q60 59 61 65 M49 61 L56 68 M53 55 L62 61 M51 64 Q44 69 40 61', 'none', .9, '#9477af')
      + path('M25 48 Q33 51 41 48 V62 Q33 64 25 62Z', '#d6c2e6', 1)
      + path('M28 53 l3 2 3 -2 3 2 M28 58 l3 2 3 -2 3 2', 'none', 1, '#a58abc'),
    drum: ellipse(33, 64, 12, 4, '#c28f9e', ink, 1) + path('M21 53 V64 Q33 69 45 64 V53Z', '#d9a7bb')
      + path('M23 55 L29 64 L34 55 L40 64 L43 55', 'none', .8, gold) + ellipse(33, 53, 12, 4, '#fff2d6', ink, 1.1),
    hat: path('M20 65 H46 L43 61 L42 48 H24 L23 61Z', lavender)
      + ellipse(33, 48, 9, 2.8, '#675173', ink, 1) + path('M24 60 H42', 'none', 2, gold),
    box: path('M19 49 L33 45 L47 49 V64 L33 69 L19 64Z', '#d3af88') + path('M19 49 L33 54 L47 49 M33 54 V69', 'none', 1)
      + path('M33 45 L38 47 L24 52 L20 50Z', '#f0d6aa', .5),
    blocks: rect(23, 57, 10, 10, blue, .7) + rect(35, 57, 10, 10, mint, .7) + rect(29, 47, 10, 10, gold, .7)
      + star(34, 52, 2.3, '#fff7de'),
    treasure: path('M22 58 Q22 52 34 52 Q46 52 46 58 V68 H22Z', '#c79877') + path('M22 59 H46 M27 55 V68 M41 55 V68', 'none', 1.8, gold)
      + rect(32, 58, 4, 5, gold, .5),
    'high-five': path('M58 20 V16 M64 22 L67 19 M66 28 H70 M53 22 L50 19', 'none', 1.6, gold)
      + star(58, 27, 2.8, '#e0eedb'),
    picnic: path('M7 61 L53 58 L66 70 H1Z', '#ead3d8') + path('M15 61 L11 69 M29 60 L27 69 M43 60 L44 70 M6 65 H61', 'none', .8, '#c4a2b2')
      + ellipse(33, 65, 9, 3, '#fffdfa', ink, .8) + path('M27 64 L33 59 L39 64Z', gold),
    camera: rect(22, 43, 23, 14, blue) + rect(27, 40, 8, 4, '#cad9e8', .7)
      + ellipse(34, 50, 5, 5, '#5c7489', ink, 1) + ellipse(34, 50, 2.5, 2.5, '#d7e7ef') + ellipse(41, 46, 1, 1, gold),
    balls: ball(17, 8, pink) + ball(49, 8, mint) + ball(33, -1, gold),
    'balls-l': ball(17, 8, pink), 'balls-r': ball(49, 8, mint), 'balls-top': ball(33, -1, gold),
    butterfly: path('M60 14 Q49 1 53 14 Q49 25 60 17 Q71 25 68 14 Q71 1 60 14Z', lavender, 1)
      + path('M60 12 V18 M60 13 L57 10 M60 13 L63 10', 'none', .9),
    laser: ellipse(65, 60, 2.3, 1.8, '#eca897') + ellipse(65, 60, .9, .65, '#fff8e8'),
    star: star(62, 8, 7),
    'music-notes': path('M58 11 V1 L68 -2 V8 M58 3 L68 0', 'none', 1.5, '#927aaf')
      + ellipse(55.8, 12, 2.6, 1.8, '#927aaf') + ellipse(65.8, 9, 2.6, 1.8, '#927aaf'),
    ellipsis: ellipse(57, 2, 1.2, 1.2, '#a99aa1') + ellipse(62, 2, 1.2, 1.2, '#a99aa1') + ellipse(67, 2, 1.2, 1.2, '#a99aa1'),
    headband: path('M6 12 Q33 2 60 12 L59 16 Q33 7 7 16Z', '#d4acc1', 1),
    'sleep-cap': path('M17 3 Q20 -15 43 -12 Q51 -10 53 -2 Q42 -6 39 4Z', blue)
      + path('M16 2 Q27 -1 41 3', 'none', 3, '#d6e6ef') + ellipse(53, -2, 3, 3, '#fffdfa', ink, .8),
    binoculars: (v.eyes.length === 2 ? path(`M${v.eyes[0] + 4} 24 H${v.eyes[1] - 4}`, 'none', 2) : '')
      + (v.eyes.length ? v.eyes : [23, 43]).map(x => rect(x - 4.5, 19.5, 9, 12, blue)
        + ellipse(x, 29.5, 4.5, 2.5, '#55788b', ink, .8)
        + ellipse(x - 1, 28.8, 1.4, .5, '#c8e0ec')).join(''),
    headphones: path('M7 26 Q2 2 32 0 Q64 2 59 26', 'none', 3, '#aa93bd')
      + rect(3, 22, 6, 12, lavender) + rect(57, 22, 6, 12, lavender)
  };
  const front = Object.entries(contents).map(([id, content]) => prop(id, content)).join('');
  const back = prop('hole', ellipse(33, 66, 18, 5, '#b1937a', ink, 1.1) + ellipse(33, 66, 12, 2.5, '#856d5d'));
  return `<g data-layer="front">${front}</g><g data-layer="back">${back}</g>`;
}

function view(name, v) {
  const back = name === 'back';
  const feet = v.legs.map((x, i) => bone(i ? 'leg_r' : 'leg_l', `${x},59`, 'back',
    path(`M${x - 4} 57 L${x - 4} 64 Q${x - 4} 68 ${x} 67 Q${x + 5} 67 ${x + 4} 62 L${x + 4} 57Z`, cream, 1.65)
    + anchor(i ? 'footwear-r' : 'footwear', x, 63)
    + prop(i ? 'shoe-glint-r' : 'shoe-glint-l',
      path(`M${x + 4} 60 V64 M${x + 2} 62 H${x + 6} M${x - 4} 64 V66 M${x - 5} 65 H${x - 3}`, 'none', .85, '#f6dfa0')))).join('');
  const tail = name === 'front' ? '' : bone('tail', back ? '33,56' : '15,56', back ? 'front' : 'back',
    path(back ? 'M27 51 Q24 48 26 55 Q23 59 28 60 Q30 65 34 61 Q40 63 40 57 Q44 54 39 51 Q37 46 34 50 Q29 46 27 51Z'
      : 'M14 49 Q8 45 8 51 Q2 50 4 56 Q1 62 8 62 Q13 67 16 61Z', '#fffdfa', 1.1));
  const cheeks = v.cheeks.map(x => ellipse(x, 33, 6, 4, pink)
    + [-2, 0, 2].map(dx => path(`M${x + dx} 31.5 l-0.9 2.4`, 'none', 0.9)).join('')).join('');
  const contour = v.outline.replace('Q33 65 50 61', 'M25 63 Q33 65 41 63 M50 61')
    .replace('Q37 65 51 60', 'M31 63 Q36 64 41 62 M51 60')
    .replace('Q40 67 53 59', 'M35 64 L41 63 M53 59');
  const body = `<g data-layer="body">${path(v.outline + ' Z', cream, 0, 'none')}${path(contour, 'none', 1.7)}${path(v.bridge, 'none', 1.7)}${cheeks}</g>`;
  const hands = v.arms.map((x, i) => bone(i ? 'arm_r' : 'arm_l', `${x},44`, name === 'profile' && !i ? 'back' : 'front',
    bone(i ? 'hand_r' : 'hand_l', `${x},50`, name === 'profile' && !i ? 'back' : 'front',
      path(i && name !== 'profile'
        ? `M${x + 1.5} 44 C${x + 7} 47 ${x + 5} 54 ${x} 53 Q${x - 3} 53 ${x - 3} 49`
        : `M${x - 1.5} 44 C${x - 7} 47 ${x - 5} 54 ${x} 53 Q${x + 3} 53 ${x + 3} 49`, cream, 1.5)
      + props(x, 51, i)))).join('');
  const face = back ? '' : Object.keys(EYE_FALLBACKS).map(s => eyes(v, s)).join('')
    + Object.keys(MOUTH_FALLBACKS).map(s => mouth(v, s)).join('');
  const layers = ears(v, back) + feet + tail + body + face + hands
    + stageProps(v) + anchor('neckwear', 33, 44) + anchor('backwear', 33, 44)
    + anchor('headwear', 33, -1) + anchor('sidebag', name === 'profile' ? 14 : name === 'three-quarter' ? 10 : 5, 49)
    + anchor('aura', 33, -29);
  // A static cached torso must not parent limbs to a separately scaled body
  // bone: that would slide the joints against its unscaled silhouette. Whole
  // character breathing/stretch is already supplied by the presentation layer.
  return `<g data-view="${name}" id="view-${name}">${bone('root', '33,64', 'body', layers)}</g>`;
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-15 -31 96 113" data-rig-id="usagi-v2" data-rig-version="5" data-rig-form="usagi" stroke-linecap="round" stroke-linejoin="round">
<title>乌沙奇 2.0 · 四视图分层原稿</title>
<desc>Based on user reference sheets: cream silhouette, pink ears and cheeks, glossy eyes. Ear roots and feet overlap the body; limbs, pupils and props remain independently editable.</desc>
${Object.entries(views).map(([name, data]) => view(name, data)).join('\n')}
</svg>\n`;
fs.writeFileSync(new URL('../../assets/companion/usagi/rig/usagi.rig.svg', import.meta.url), svg);
console.log('Wrote the Usagi 2.0 layered SVG; compile with npm run rig:build.');
