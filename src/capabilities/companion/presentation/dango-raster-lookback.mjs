'use strict';

const clamp = value => Math.max(0, Math.min(1, value));
const ease = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
const eligible = action => ['tail-wiggle', 'rest-window'].includes(action?.id);

// A round character turns through its facial perspective: the far eye grows
// as the near eye approaches the edge. Interpolate approved per-view anchors
// and widths, rather than translating an unchanged face across the torso.
function sampleRasterLookback(manifest, data, { action, progress = 0, calmVisual = false, state } = {}) {
  if (!eligible(action) || !data.face?.eyes?.neutral?.length) return null;
  const p = calmVisual || state === 'dragged' ? 0 : action.sequencePhase?.timelineProgress ?? progress;
  const turn = ease((p - .20) / .22) * (1 - ease((p - .68) / .22));
  const cue = ease((p - .15) / .06) * (1 - ease((p - .28) / .09));
  const blink = Math.max(0, 1 - Math.abs(p - .28) / .035, 1 - Math.abs(p - .76) / .035);
  const front = manifest.views.front.face, opposite = manifest.views['three-quarter-left']?.face || front;
  const matrices = [];
  const source = [...data.face.eyes.neutral, data.face.mouth.neutral];
  const centered = [...front.eyes.neutral, front.mouth.neutral];
  const turned = [...opposite.eyes.neutral, opposite.mouth.neutral];
  const first = Math.min(1, turn * 2), second = Math.max(0, turn * 2 - 1) * .74;
  for (let i = 0; i < source.length; i++) {
    const from = source[i], mid = centered[i], end = turned[i];
    const x = mix(mix(from.pivot[0], mid.pivot[0], first), end.pivot[0], second);
    // Both eyes stay on a level gaze line during the held return glance.
    const targetY = i < 2 ? (turned[0].pivot[1] + turned[1].pivot[1]) / 2 : end.pivot[1];
    const y = mix(mix(from.pivot[1], mid.pivot[1], first), targetY, second);
    const sx = mix(mix(from.rect[2], mid.rect[2], first), end.rect[2], second) / from.rect[2];
    const sy = mix(mix(from.rect[3], mid.rect[3], first), end.rect[3], second) / from.rect[3];
    matrices.push(Object.freeze([sx, 0, 0, sy, x - sx * from.pivot[0], y - sy * from.pivot[1]]));
  }
  return Object.freeze({ turn, cue, blink, matrices: Object.freeze(matrices) });
}

export { eligible as hasRasterLookback, sampleRasterLookback };
