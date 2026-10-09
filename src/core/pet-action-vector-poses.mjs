const TAU = Math.PI * 2;
import { sampleRunningPose, sampleRunningFeet } from './pet-running-pose.mjs';
const clamp = n => Math.max(0, Math.min(1, n));
const ease = n => { const t = clamp(n); return t * t * (3 - 2 * t); };

// Gestures without a workbench still use short paws emerging from the body's
// edge. These are authored poses, not x-scaled legacy shoulder/elbow sticks.
function sampleFreeVectorAction(action, p, view, anchors, options = {}) {
  const hands = [], tools = [], details = [], phase = p * TAU;
  const work = ease(p / .14) * ease((1 - p) / .16);
  const wave = Math.sin(phase * 3) * work;
  const hand = (side, x, y, layer = 'front') => {
    const root = anchors[`shoulder-${side}`], target = [x, y];
    const dx = root.x - x, dy = root.y - y, length = Math.hypot(dx, dy) || 1;
    const reach = Math.min(5, length) / length;
    hands.push({ side, layer, points: [[root.x, root.y], [x + dx * reach, y + dy * reach + 1], target] });
  };
  const tool = (key, x, y, extra = {}) => tools.push({ key, x, y, ...extra });
  switch (action.motion) {
    case 'wave': hand('right', 62 + wave * 1.5, 29 - work * 3); break;
    case 'high-five': hand('right', 64, 31 - work * 7); break;
    case 'dance':
      hand('left', 3, 35 - wave * 5); hand('right', 63, 35 + wave * 5); break;
    case 'stretch':
      hand('left', 7, 39 - work * 15); hand('right', 59, 39 - work * 15); break;
    case 'pushup':
      hand('left', 8, 55); hand('right', 58, 55); break;
    case 'box':
      hand('left', 5 - Math.max(0, wave) * 6, 34); hand('right', 61 + Math.max(0, -wave) * 6, 34); break;
    case 'juggle':
      hand('left', 4, 37 - Math.max(0, wave) * 4); hand('right', 62, 37 - Math.max(0, -wave) * 4); break;
    case 'dash': {
      const run = sampleRunningPose(p, options);
      hand('left', 10 + run.stride * 1.5, 44 + run.stride * 1.5, 'back');
      hand('right', 60.5 - run.stride, 47 + run.stride);
      for (const paw of hands) paw.integrated = true;
      break;
    }
    case 'umbrella': hand('right', 62, 38); break;
    default: break;
  }
  switch (action.prop) {
    case 'tail': {
      const sway = Math.sin(phase * 3) * 1.1;
      const rasterBack = view === 'back' && Boolean(options.toolSprites?.tail);
      tool('tail', rasterBack ? 61 : view === 'back' ? 57 : -4, 38 + sway,
        { layer: rasterBack ? 'front' : 'back', bodyColor: true, scale:.6,
        rotate: Math.sin(phase * 3) * .18, pivot: [8, 10] });
      details.push({ type: 'look-back', at: [62, 7], amount: .5 + .5 * Math.sin(phase) });
      break;
    }
    case 'umbrella': tool('umbrella', 37, -11, { layer: 'back' }); break;
    case 'cushion': tool('cushion', 8, 56, { layer: 'back' }); break;
    case 'pillow': tool('pillow', 7, 53, { layer: 'back' }); break;
    case 'hole':
      // The pet drops toward the floor; its hole and dust must not drop too.
      const groundY = 63 - bodyOffset(action,p,{calmVisual:options.calmVisual}).y;
      details.push({ type: 'hole', at: [33, groundY], amount: 1, layer: 'back' });
      details.push({ type: 'soil', at: [18, groundY+1], amount: work * .65, layer: 'back' });
      details.push({ type: 'soil', at: [56, groundY+1], amount: work * .65, layer: 'back' });
      break;
    case 'headband': details.push({ type: 'headband', at: [9, 12], amount: 1 }); break;
    case 'butterfly': tool('butterfly', 60 + Math.sin(phase * 2) * 3, 2 + Math.cos(phase * 2) * 3,
      { rotate: Math.sin(phase * 5) * .2, pivot: [9, 7] }); break;
    case 'balls':
      for (let i = 0; i < 3; i++) {
        const t = (p * 3 + i / 3) % 1, a = t * TAU;
        tool('ball', 1 + 58 * (.5 - .5 * Math.cos(a)), 31 - Math.abs(Math.sin(a)) * 32,
          { tint: ['#e3a1b5', '#e2bd7e', '#a7cddd'][i] });
      }
      break;
    case 'ellipsis': details.push({ type: 'ellipsis', at: [55, 7], amount: 1 }); break;
    case 'laser': details.push({ type: 'laser', at: [33 + Math.cos(phase * 3) * 35, 33 + Math.sin(phase * 2) * 23], amount: 1 }); break;
    case 'sleep-cap': tool('sleep-cap', 14, -5); break;
    case 'hat':
      tool('magic-hat', 14, 47); if (p > .25 && p < .8) tool('star', 26, 43 - work * 22);
      break;
    case 'box': tool('box', 7, 43); break;
    case 'gloves':
      for (const pose of hands) { const [x, y] = pose.points.at(-1); tool('glove', x - 6, y - 6, { coversPaw: pose.side }); }
      break;
    case 'high-five': tool('high-five-paw', 67, 20 - work * 3); break;
    case 'music-notes': tool('music-note', -7, 15 + wave * 2); tool('music-note', 67, 11 - wave * 2); break;
    case 'ribbon': details.push({ type: 'ribbon', at: [61, 20], amount: wave }); break;
    default: break;
  }
  if (action.motion === 'dash') {
    const feet = sampleRunningFeet(anchors, p, options), root = anchors['foot-left'], m = feet['foot-left'];
    const footX = m[0] * root.x + m[2] * root.y + m[4];
    const run = sampleRunningPose(p, options);
    details.push({ type: 'run-dust', at: [footX - 10, 61], amount: work, cycle:run.phase / TAU, layer: 'back' });
  } else if (action.motion === 'moonwalk') {
    details.push({ type: 'run-dust', at: [-4, 60], amount: work, layer: 'back' });
  }
  if (action.id === 'rest-window' || (action.motion === 'look' && action.prop === 'none')) {
    details.push({ type: 'look-back', at: [63, 7], amount: work });
  }
  return { hands, tools, details, phase: p, layer: 'front' };
}

export { sampleFreeVectorAction };
import { bodyOffset } from './pet-action-art.mjs';
