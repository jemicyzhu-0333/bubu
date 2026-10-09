'use strict';

const DURATION_MS = 240;
const STALE_GAP_MS = 500;
const BODY_DEFAULTS = Object.freeze({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotateDeg: 0 });

// Renderer-local settling only: no timer, activity selection or persisted state.
// A sleep boundary blends the already displayed root and expression pose. All
// character layers share that transform; stable breathing remains the raw pose.
function createSleepTransition() {
  let previous = null, from = null, startedAt = 0;
  const reset = () => { previous = null; from = null; };
  function step({ formId, skinId, view, state, expressionId, action, now, calmVisual, offX, offY, bodyPose }) {
    const target = { offX, offY, bodyPose };
    if (formId !== 'dango' || action || calmVisual || state === 'dragged' || !Number.isFinite(now)) {
      reset(); return target;
    }
    const identity = `${skinId}|${view}`;
    const sleeping = state === 'sleeping' || expressionId === 'life.sleep';
    if (!previous || previous.identity !== identity || now < previous.now || now - previous.now > STALE_GAP_MS) {
      from = null;
    } else if (sleeping !== previous.sleeping) {
      from = previous.shown; startedAt = now;
    }
    let shown = target;
    if (from) {
      const progress = Math.max(0, Math.min(1, (now - startedAt) / DURATION_MS));
      const weight = progress * progress * (3 - 2 * progress);
      if (progress === 1) from = null;
      else {
        const blend = (a, b) => a + (b - a) * weight;
        const pose = { ...bodyPose };
        for (const [channel, rest] of Object.entries(BODY_DEFAULTS)) {
          pose[channel] = blend(from.bodyPose?.[channel] ?? rest, bodyPose?.[channel] ?? rest);
        }
        shown = { offX: blend(from.offX, offX), offY: blend(from.offY, offY), bodyPose: pose };
      }
    }
    previous = { identity, sleeping, now, shown };
    return shown;
  }
  return Object.freeze({ step, reset });
}

export { createSleepTransition };
