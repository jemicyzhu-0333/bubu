const TAU = Math.PI * 2;
const clamp = n => Math.max(0, Math.min(1, n));
const ease = n => { const t = clamp(n); return t * t * (3 - 2 * t); };
const IDENTITY = Object.freeze([1, 0, 0, 1, 0, 0]);

// One shared stride drives the native runner's torso, planted/recovering feet,
// tucked paws and trailing dust. All time comes from the existing action clock.
function sampleRunningPose(progress, { calmVisual = false } = {}) {
  const p = clamp(Number(progress) || 0);
  const effort = calmVisual ? 0 : ease(p / .09) * ease((1 - p) / .11);
  const phase = p * TAU * 10, stride = Math.sin(phase);
  return Object.freeze({ effort, stride, phase,
    lean: effort * (.115 + Math.cos(phase * 2) * .012),
    scaleX: 1 + effort * (.1 + Math.cos(phase * 2) * .018),
    scaleY: 1 - effort * (.09 + Math.cos(phase * 2) * .018),
    lift: -effort * Math.sin(phase) ** 2 * 1.6
  });
}

function sampleRunningFeet(anchors, progress, options = {}) {
  const pose = sampleRunningPose(progress, options), feet = {};
  for (const [index, side] of ['foot-left', 'foot-right'].entries()) {
    if (!pose.effort) { feet[side] = IDENTITY; continue; }
    const step = Math.sin(pose.phase + index * Math.PI);
    const x = step * 5.8 * pose.effort;
    const y = -Math.max(0, step) * 4.2 * pose.effort;
    const angle = -step * .32 * pose.effort;
    const c = Math.cos(angle), s = Math.sin(angle), root = anchors[side];
    feet[side] = Object.freeze([c, s, -s, c,
      root.x + x - c * root.x + s * root.y,
      root.y + y - s * root.x - c * root.y]);
  }
  return Object.freeze(feet);
}

function applyRunningTransform(context, progress, options = {}) {
  const pose = sampleRunningPose(progress, options);
  if (!pose.effort) return;
  const unit = (options.bodySize || 66) / 66;
  const center = (options.size || 146) / 2;
  const direction = options.facing === -1 ? -1 : 1;
  // Rotation is applied before the renderer's facing mirror. Its sign must
  // follow facing so the head always leads the feet in the travel direction.
  context.translate(center, center + 24 * unit);
  context.translate(0, pose.lift * unit);
  context.rotate(pose.lean * direction);
  context.scale(pose.scaleX, pose.scaleY);
  context.translate(-center, -center - 24 * unit);
}

export { sampleRunningPose, sampleRunningFeet, applyRunningTransform };
