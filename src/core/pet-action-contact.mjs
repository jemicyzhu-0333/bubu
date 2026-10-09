// PET_VISUAL「手部与动作」: hand and equipment share one sampled contact.
// These are authored screen-space poses for each view, never a compressed
// frontal character. Only the final pixel painter rounds coordinates.
import { BODY_ANCHORS, VIEW_LAYOUTS } from '../content/companion/dango-body.mjs';
import { COMPANION_ACTIVITY_STORIES } from '../content/companion/activity-stories.mjs';
import { TOOL_SPRITES } from '../content/companion/dango-tools.mjs';

const clamp = value => Math.max(0, Math.min(1, value));
const ease = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
const pulse = (p, a, b, c, d) => ease((p - a) / (b - a)) * (1 - ease((p - c) / (d - c)));
const mix = (a, b, t) => a.map((n, i) => n + (b[i] - n) * t);
const point = (view, front, quarter, profile) => view === 'profile' ? profile : view === 'three-quarter' ? quarter : front;

function sampleActionContact(action, progress, view = 'front', options = {}) {
  if (!action) return null;
  const soft = options.soft === true;
  const spriteFor = key => {
    const base = TOOL_SPRITES[key], override = options.toolSprites?.[key];
    return override ? { ...base, ...override, anchors: { ...base?.anchors, ...override.anchors } } : base;
  };
  if (soft && view === 'profile') view = 'three-quarter';
  const p = options.calmVisual ? (action.staticProgress ?? .5) : clamp(Number(progress) || 0);
  const v = view === 'back' ? 'front' : view;
  const hands = [], tools = [], details = [];
  const work = pulse(p, .02, .17, .82, .98), phase = p * Math.PI * 2;
  const tap = ['type', 'browse', 'drum'].includes(action.motion) ? Math.sin(phase * 7) * work : 0;
  const mouth = VIEW_LAYOUTS[v].mouthAnchor;
  const muzzle = options.muzzle ? [options.muzzle.x, options.muzzle.y]
    : [mouth.gridX * 2 + 7, mouth.gridY * 2 + 3];
  const tool = (key, at, extra = {}) => {
    const sprite = spriteFor(key); if (!sprite) throw new Error(`unknown authored tool ${key}`);
    const value = { key, x: at[0], y: at[1], ...extra }; tools.push(value); return value;
  };
  const anchor = (item, name) => {
    const xy = spriteFor(item.key).anchors[name];
    if (!xy) throw new Error(`missing ${item.key}/${name} grip`);
    return [item.x + (item.flip ? spriteFor(item.key).width - xy[0] : xy[0]), item.y + xy[1]];
  };
  const hand = (side, target, style = 'mitten') => {
    if (v === 'profile' && side === 'left') return;
    const root = (options.anchors || BODY_ANCHORS[v])[`shoulder-${side}`];
    const shoulder = [root.x, root.y];
    const distance = Math.hypot(shoulder[0] - target[0], shoulder[1] - target[1]) || 1;
    const reach = Math.min(6, distance) / distance;
    const elbow = soft ? [target[0] + (shoulder[0] - target[0]) * reach,
      target[1] + (shoulder[1] - target[1]) * reach + 1.5]
      : [shoulder[0] * .62 + target[0] * .38, (shoulder[1] + target[1]) / 2 + 3];
    const points = [shoulder, elbow, target];
    hands.push({ side, style, points, layer: 'front' });
  };
  const grip = (item, side, delta = [0, 0]) => {
    if (v === 'profile' && side === 'left') return;
    const target = anchor(item, side); hand(side, [target[0] + delta[0], target[1] + delta[1]]);
  };
  const prop = action.prop;
  if (soft && prop === 'energy') {
    const bob = Math.sin(phase * 3) * work * .7;
    // The angled near eye sits at x≈41; the crystal tip belongs in the
    // corridor between both eyes. Its two paws follow the same tool anchors.
    const energy = tool('energy', point(v, [21, 30 + bob], [38, 30 + bob], [38, 30 + bob]));
    grip(energy, 'left'); grip(energy, 'right');
    details.push({ type: 'energy-rays', at: [energy.x + 12, energy.y + 12], amount: work });
  } else if (soft && prop === 'treasure') {
    const reveal = ease((p - .62) / .18), digging = 1 - ease((p - .56) / .1);
    const ground = point(v, [24, 57], [34, 57], [34, 57]);
    tool('dirt-mound', ground, { layer: 'back' });
    if (digging > 0) {
      const scoop = Math.sin(phase * 4) * work * 3;
      const shovel = tool('shovel', [ground[0] + 9, 29 + scoop], { opacity: digging });
      grip(shovel, 'left'); grip(shovel, 'right');
      details.push({ type: 'soil', at: [ground[0] + 13, ground[1]], amount: Math.max(0, -Math.sin(phase * 4)) * work });
    }
    if (reveal > 0) tool('treasure-chest', [ground[0] + 3, 59 - reveal * 16], { opacity: reveal });
  } else if (soft && prop === 'star') {
    const catchAmount = ease((p - .08) / .34), lower = ease((p - .67) / .23);
    const held = mix([70, 29], [51, 46], lower);
    const gripAt = mix([76, 0], held, catchAmount);
    const star = tool('star', [gripAt[0] - 8.5, gripAt[1] - 14]);
    hand('right', mix([62, 42], held, ease((p - .12) / .25)), 'open');
    if (lower > .3) hand('left', [held[0] - 10, held[1] + 3]);
    details.push({ type: 'star-glow', at: [star.x + 8.5, star.y + 8], amount: work });
  } else if (soft && prop === 'plane') {
    const release = ease((p - .26) / .62), reset = ease((p - .93) / .07);
    const at = mix([53, 35], [80, 21], release);
    const plane = tool('paper-plane', at, { opacity: 1 - reset });
    hand('right', mix(anchor(plane, 'right'), [62, 43], ease((p - .28) / .22)), 'open');
    details.push({ type: 'plane-trail', at, amount: release * (1 - reset) });
  } else if (soft && prop === 'pillow') {
    const pillow = tool('pillow', [7, 45], { persistent: action.id === 'rest-nap' });
    if (action.motion === 'stretch') {
      hand('left', [7, 39 - work * 15], 'open'); hand('right', [59, 39 - work * 15], 'open');
    } else {
      const pat = action.motion === 'organize' ? Math.max(0, Math.sin(phase * 3)) * work * 3 : 0;
      grip(pillow, 'left', [0,-pat]); grip(pillow, 'right', [0,-pat]);
    }
  } else if (prop === 'keyboard') {
    const board = tool(`keyboard-${v}`, point(v, [9, 53], [12, 50], [42, 50]));
    grip(board, 'left', [Math.sin(phase * 2) * work * (action.motion === 'type' ? 1 : 0), -2 - Math.max(0, tap) * 4]);
    grip(board, 'right', [-Math.sin(phase * 2) * work * (action.motion === 'type' ? 1 : 0), -2 - Math.max(0, -tap) * 4]);
    details.push({ type: 'keypress', at: anchor(board, 'right'), amount: Math.max(0, tap) });
  } else if (prop === 'cup') {
    const lift = action.motion === 'sip' ? pulse(p, .08, .34, .66, .92) : 0;
    const rest = soft ? point(v, [23, 43], [35, 43], [35, 43]) : point(v, [30, 45], [39, 45], [56, 43]);
    const rim = spriteFor('cup').anchors.rim;
    const at = mix(rest, [muzzle[0] - rim[0], muzzle[1] - rim[1]], lift);
    const cup = tool('cup', at); grip(cup, 'right');
    if (v !== 'profile') grip(cup, 'left');
    details.push({ type: 'steam', at: options.toolSprites ? anchor(cup, 'rim')
      : [at[0] + (soft ? 1 : 7), at[1] - (soft ? 4 : 5)], amount: lift });
  } else if (prop === 'book') {
    const book = tool(`book-${v}`, point(v, [9, 46], [16, 46], [42, 46]));
    const turn = action.motion === 'read' ? pulse(p, .22, .38, .56, .72) : 0;
    grip(book, 'left'); grip(book, 'right', [-turn * (v === 'profile' ? 8 : 18), -turn * 6]);
    details.push({ type: 'page', at: anchor(book, 'page'), amount: turn, width: v === 'profile' ? 11 : 19 });
  } else if (prop === 'document') {
    const page = tool('document', point(v, [13, 49], [20, 48], [38, 48]));
    grip(page, 'left');
    const stroke = action.motion === 'write' ? work : 0;
    const tip = spriteFor('pen').anchors.tip;
    const at = [page.x + 22 - tip[0] + Math.sin(phase * 4) * 6 * stroke,
      page.y + 8 - tip[1] + Math.sin(phase * 8) * stroke];
    const pen = tool('pen', at); grip(pen, 'right');
    details.push({ type: 'ink', at: [page.x + 10, page.y + 12], amount: p });
  } else if (prop === 'laptop' || prop === 'ai-chat') {
    const laptop = tool('laptop', point(v, [10, 39], [17, 39], [38, 39]));
    grip(laptop, 'left', [0, -Math.max(0, tap) * 3]);
    grip(laptop, 'right', [Math.sin(phase * 2) * 3 * work * (['browse', 'type'].includes(action.motion) ? 1 : 0), -Math.max(0, -tap) * 2]);
    if (action.motion === 'browse') details.push({ type: 'scroll', at: [laptop.x + 10, laptop.y + 15], amount: p });
    // Reuse authored laptop contacts and dots without changing the mirror's semantic prop.
    if (prop === 'ai-chat') details.push({ type: 'ellipsis', at: [72, 7], amount: 1 });
  } else if (prop === 'chart') {
    const chart = tool('chart', point(v, [11, 43], [19, 43], [37, 43]));
    grip(chart, 'left');
    const track = ['trade', 'write'].includes(action.motion) ? .5 + Math.sin(phase) * .5 : .5;
    const target = [chart.x + 12 + track * 24, chart.y + 17 - track * 9];
    if (action.motion === 'write') {
      const pen = tool('pen', [target[0] - 1, target[1] - 15]); grip(pen, 'right');
    } else hand('right', target);
  } else if (prop === 'notes') {
    const origin = point(v, [12, 49], [21, 49], [41, 49]);
    tool('note', origin); tool('note', [origin[0] + 27, origin[1] + 2]);
    const move = action.motion === 'organize' ? pulse(p, .12, .4, .66, .95) : 0;
    const note = tool('note', [origin[0] + 13 + move * 9, origin[1] - 5 - Math.sin(move * Math.PI) * 9]);
    if (action.motion === 'write') {
      const pen = tool('pen', [note.x + 5 + Math.sin(phase * 5) * work * 3, note.y - 7]); grip(pen, 'right');
      details.push({ type: 'ink', at: [note.x + 3, note.y + 10], amount: p * .35 });
    } else grip(note, 'right');
    hand('left', [origin[0] + 3, origin[1] + 8]);
  } else if (prop === 'mirror') {
    const mirror = tool('mirror', soft ? point(v, [52, 13], [56, 13], [56, 13]) : point(v, [65, 12], [66, 12], [67, 12]));
    grip(mirror, 'right');
    hand('left', soft ? [3 - Math.sin(phase * 2) * work * 2, 33 - work * 7]
      : [-2 - Math.sin(phase * 2) * work * 3, 26 - work * 7], 'open');
    details.push({ type: 'reflection', at: [mirror.x + 5, mirror.y + 8], amount: p });
  } else if (prop === 'plant') {
    const plant = tool('plant', point(v, [-7, 34], [-2, 34], [77, 34]), { persistent: action.id === 'rest-plant' });
    if (action.motion === 'organize') hand(v === 'profile' ? 'right' : 'left', [plant.x + 6, plant.y + 24]);
    if (action.motion === 'wave') hand('right', soft ? [64 + Math.sin(phase * 3) * work * 1.5, 29 - work * 3]
      : point(v, [67 + Math.sin(phase * 4) * 4, 20], [67 + Math.sin(phase * 4) * 4, 20], [61 + Math.sin(phase * 4) * 3, 20]), 'open');
  } else if (prop === 'watering-can') {
    const profile = v === 'profile';
    const pour = pulse(p, .15, .35, .65, .9);
    const plant = tool('plant', point(v, [-7, 34], [-2, 34], [77, 34]), { persistent: action.id === 'rest-plant' });
    const can = tool('watering-can', soft
      ? point(v, [32 - pour * 3, 41 - pour * 3], [35 - pour * 3, 41 - pour * 3], [35 - pour * 3, 41 - pour * 3])
      : point(v, [40 - pour * 3, 41 - pour * 3], [45 - pour * 3, 41 - pour * 3], [49 + pour * 3, 40 - pour * 3]), { flip: profile });
    grip(can, 'right');
    details.push({ type: 'water', at: anchor(can, 'spout'), end: [plant.x + 10, plant.y + 10], amount: pour });
  } else if (prop === 'pan') {
    const pan = tool('pan', soft ? point(v, [18, 50], [24, 50], [24, 50]) : point(v, [35, 50], [39, 50], [45, 50]));
    const toss = pulse(p, .28, .43, .47, .67); pan.y -= toss * 5;
    grip(pan, 'right'); hand('left', soft ? [pan.x + 5, pan.y + 5] : point(v, [22, 49], [25, 49], [50, 48]));
    const arc = Math.sin(toss * Math.PI);
    details.push({ type: 'food', at: [pan.x + 15 - (soft ? arc * 7 : 0), pan.y - 2 - arc * (soft ? 8 : 12)], amount: toss });
    if (soft) {
      const bowl = spriteFor('pan').anchors.bowl || [15, 5];
      details.push({ type: 'steam', at: options.toolSprites ? [pan.x + bowl[0], pan.y + bowl[1]]
        : [pan.x + 2, pan.y - 2], amount: work });
    }
  } else if (prop === 'broom') {
    const sweep = Math.sin(phase * 2) * work * (soft ? 3 : 8);
    const broom = tool('broom', soft ? point(v, [49 + sweep, 20], [58 + sweep, 20], [58 + sweep, 20])
      : point(v, [47 + sweep, 18], [51 + sweep, 18], [51 + sweep, 18]));
    grip(broom, 'right'); hand('left', [broom.x + 13, broom.y + (soft ? 30 : 17)]);
    if (soft) details.push({ type: 'soil', at: [broom.x + 9, broom.y + 47], amount: work * .5 });
  } else if (prop === 'camera') {
    const lift = pulse(p, .12, .32, .58, .85);
    const camera = tool('camera', point(v, [17, 44 - lift * 9], [26, 44 - lift * 9], [44, 44 - lift * 9]));
    grip(camera, 'left'); grip(camera, 'right');
    details.push({ type: 'flash', at: [camera.x + 25, camera.y - 4], amount: p > .43 && p < .49 ? 1 : 0 });
  } else if (prop === 'binoculars') {
    const lift = pulse(p, .05, .24, .72, .94);
    const binoculars = tool(`binoculars-${v}`, point(v, [12, 42 - lift * (soft ? 24 : 19)], [23, 42 - lift * 19], [46, 42 - lift * 20]));
    grip(binoculars, 'left'); grip(binoculars, 'right');
  } else if (prop === 'drum') {
    const drum = tool('drum', point(v, [15, 44], [23, 44], [44, 44]));
    grip(drum, 'left', [0, -4 - Math.max(0, tap) * 6]);
    grip(drum, 'right', [0, -4 - Math.max(0, -tap) * 6]);
  } else if (prop === 'yarn') {
    const base = soft ? point(v, [25, 43], [34, 43], [34, 43]) : point(v, [25, 45], [34, 45], [51, 45]);
    tool('yarn-ball', [base[0] + 23, base[1] + 5]);
    const beat = Math.sin(phase * 5) * work * 3;
    const left = tool('needle', [base[0] - 3 + beat, base[1] - 2]);
    const right = tool('needle', [base[0] + 5 - beat, base[1] - 2], { flip: true });
    grip(left, 'left'); grip(right, 'right');
    details.push({ type: 'thread', at: [base[0] + 10, base[1] + 12], end: [base[0] + 27, base[1] + 14], amount: work });
  } else if (prop === 'blocks') {
    const base = point(v, [47, 53], [53, 53], [64, 53]);
    tool('block', base); tool('block', [base[0] + 13, base[1]]);
    const place = ease((p - .08) / .47);
    // The raster cube's isometric top is below its bounding-box peak. A full
    // 12-unit lift left a measured 1.625-unit air gap after placement.
    const stackHeight = soft ? 10 : 12;
    const block = tool('block', [base[0] + 6 - (1 - place) * 12, base[1] - stackHeight - (1 - place) * 11]);
    if (p < .64) grip(block, 'right');
    else {
      const release = ease((p - .64) / .3);
      const shoulder = (options.anchors || BODY_ANCHORS[v])['shoulder-right'];
      const rest = soft ? [shoulder.x, shoulder.y] : point(v, [62, 45], [64, 45], [62, 45]);
      hand('right', mix(anchor(block, 'right'), rest, release));
      if (soft) hands.at(-1).opacity = 1 - release;
    }
  } else if (prop === 'picnic') {
    if (soft) tool('picnic-mat', [2, 56], { layer:'back' });
    const lift = pulse(p, .12, .33, .56, .84);
    const food = tool('sandwich', mix(point(v, [40, 51], [48, 51], [61, 51]), [muzzle[0] - 5, muzzle[1] - 2], lift));
    grip(food, 'right'); hand('left', point(v, [16, 54], [23, 54], [51, 53]));
  } else if (prop === 'bubble-wand') {
    const frontal = soft && v === 'front';
    const wand = tool('bubble-wand', [muzzle[0] + (frontal ? 15 : soft ? 11 : 9), muzzle[1] - (frontal ? 6 : 12)]);
    grip(wand, 'right');
  } else if (prop === 'tissue') {
    const cover = pulse(p, .2, .48, .66, .9);
    const tissue = tool('tissue', mix(point(v, [51, 45], [55, 45], [60, 45]), [muzzle[0] - 7, muzzle[1] - 5], cover));
    grip(tissue, 'right');
  } else if (prop === 'microphone') {
    const microphone = tool('microphone', [muzzle[0] + 5 + Math.sin(phase) * 2, muzzle[1] - (soft ? 5 : 10)]);
    grip(microphone, 'right'); hand('left', [-1, 31 - work * 8], 'open');
  } else if (prop === 'telescope') {
    const eyepiece = options.toolSprites && spriteFor('telescope').anchors.eyepiece;
    const aligned = eyepiece && options.focusEye;
    const at = aligned ? [options.focusEye[0] - (spriteFor('telescope').width - eyepiece[0]),
      options.focusEye[1] - eyepiece[1]] : soft ? [56, 21] : point(v, [44, 20], [48, 20], [47, 20]);
    const scope = tool('telescope', at, aligned ? { flip: true } : {});
    grip(scope, 'right');
  } else return null;
  if (!options.skipStoryBlend) blendStoryHands(action, hands, v, options);
  if (view === 'back') {
    for (const item of tools) { item.x = 66 - item.x - spriteFor(item.key).width; item.flip = !item.flip; }
    for (const pose of hands) { pose.points = pose.points.map(([x, y]) => [66 - x, y]); pose.layer = 'back'; }
    details.length = 0; // No face/reflected frontal graphics seen through the back of equipment.
  }
  return { hands, tools, details, phase: p, layer: view === 'back' ? 'back' : 'front' };
}

// The vector rig already blends poses. Pixel paws need the same short reach
// between story beats; this stays pure by sampling the prior authored beat.
function blendStoryHands(action, hands, view, options) {
  const phase = action.sequencePhase, timeline = COMPANION_ACTIVITY_STORIES[action.id];
  if (!phase || !timeline || !phase.index || options.calmVisual) return;
  const stage = timeline.stages[phase.index], previous = timeline.stages[phase.index - 1];
  const elapsed = phase.progress * (stage.until - previous.until) * (action.durationMs || action.duration || 30000);
  const amount = ease(elapsed / 240); if (amount >= 1) return;
  const before = sampleActionContact({ ...action, motion: previous.motion, prop: previous.prop, sequencePhase: null }, 1, view, options);
  for (const pose of hands) {
    const prior = before?.hands.find(hand => hand.side === pose.side);
    pose.points = pose.points.map((xy, index) => mix(prior?.points[index] || pose.points[0], xy, amount));
  }
}

export { sampleActionContact };
