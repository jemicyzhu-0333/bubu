'use strict';
// Secondary motion: a damped spring that follows a primary signal (e.g. body
// sway) with lag and overshoot. Stateless and deterministic: the spring is
// re-integrated over a short fixed window that ends at `timeMs`, starting at
// rest on the signal. Same inputs → same output, regardless of frame rate.
function springFollow(signal, timeMs, { stiffness = 170, damping = 11, windowMs = 600, stepMs = 25 } = {}) {
  const steps = Math.max(1, Math.round(windowMs / stepMs)), dt = stepMs / 1000;
  let t = timeMs - steps * stepMs, x = signal(t), v = 0;
  for (let i = 0; i < steps; i++) {
    t += stepMs; const target = signal(t);
    // Semi-implicit Euler; stable for these small k/c at 25 ms steps.
    v += (stiffness * (target - x) - damping * v) * dt; x += v * dt;
  }
  return x - signal(timeMs);
}
// Lag of a follower expressed as a swing angle (radians), clamped and
// disabled entirely under reduced/calm motion.
function secondarySwing(signal, timeMs, { gain = .06, limit = .28, reducedMotion = false, ...spring } = {}) {
  if (reducedMotion || !Number.isFinite(timeMs)) return 0;
  const swing = -springFollow(signal, timeMs, spring) * gain;
  return Math.max(-limit, Math.min(limit, swing));
}
export { springFollow, secondarySwing };
