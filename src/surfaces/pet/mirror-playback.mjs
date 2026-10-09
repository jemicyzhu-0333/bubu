'use strict';

const ENTER_MS = 800;
const EXIT_MS = 600;
const MIRROR_IDS = new Set(['mirror-music', 'mirror-ai']);
const clamp = value => Math.max(0, Math.min(1, Number(value) || 0));
const smooth = value => value * value * (3 - 2 * value);

function isContextMirror(action) {
  return MIRROR_IDS.has(action?.id) && action.state === action.id;
}

// The mirror's authored body track is already eased by its lifecycle envelope.
// Keeping the generic happy enter (+3 y) or beat loop would add an unrelated
// jump/scale on top. The winning face/ID and every higher-priority body stay intact.
function resolveMirrorBodyPose(body, { action, expressionId, source = 'base' } = {}) {
  if (!isContextMirror(action) || !action.mirrorPresentation || source !== 'base'
      || expressionId !== (action.baseExpression || action.expression)) return body;
  return Object.freeze({ tone: body?.tone || 'normal', x: 0, y: 0, scaleX: 1, scaleY: 1, rotateDeg: 0 });
}

// Renderer-local continuity only (ARCHITECTURE「活动镜像」). The existing session
// controller still owns category and loop time. No TTL, scheduler or event
// meaning is inferred here; enter/exit describe the visible action, not AI work.
function createMirrorPlayback() {
  let active = null;
  let outgoing = null;
  let form = null;
  let skipEntry = false;
  let visible = null;

  function reset() {
    active = null;
    outgoing = null;
    visible = null;
    skipEntry = true;
  }

  function decorate(action, phase, progress, loopProgress, elapsedMs, opacity, calmVisual) {
    const mirrorPresentation = Object.freeze({ phase, progress: clamp(progress),
      elapsedMs: Math.max(0, elapsedMs), loopProgress: clamp(loopProgress), static: calmVisual });
    visible = Object.freeze({ id: action.id, ...mirrorPresentation, propOpacity: opacity });
    return Object.freeze({ action: Object.freeze({ ...action, mirrorPresentation, propOpacity: opacity }),
      progress: clamp(loopProgress) });
  }

  function sample({ action = null, progress = 0, now, formId, blocked = false, calmVisual = false } = {}) {
    visible = null;
    if (!Number.isFinite(now) || !['dango', 'usagi'].includes(formId)) {
      reset(); return Object.freeze({ action, progress: clamp(progress) });
    }
    const formChanged = form !== null && form !== formId;
    if (formChanged || (active && now < active.lastAt)) reset();
    form = formId;

    if (isContextMirror(action)) {
      outgoing = null;
      if (!active || active.action.id !== action.id) {
        active = { action, enteredAt: now, lastAt: now, progress: clamp(progress), opacity: 0,
          settled: skipEntry || blocked || calmVisual, shown: false };
      }
      active.action = action;
      active.lastAt = now;
      active.progress = clamp(progress);
      skipEntry = false;
      if (blocked) {
        active.settled = true;
        active.shown = false;
        return Object.freeze({ action: null, progress: 0 });
      }
      if (calmVisual) active.settled = true;
      const entering = !active.settled && now - active.enteredAt < ENTER_MS;
      const phase = entering ? 'enter' : 'loop';
      const phaseProgress = entering ? clamp((now - active.enteredAt) / ENTER_MS) : calmVisual ? .5 : clamp(progress);
      const opacity = entering ? smooth(phaseProgress) : 1;
      active.opacity = opacity;
      active.shown = !calmVisual;
      return decorate(action, phase, phaseProgress, calmVisual ? .5 : progress,
        calmVisual ? (action.durationMs || 0) / 2 : now - active.enteredAt, opacity, calmVisual);
    }

    // A replacement action (including focus/rest/coding), manual feedback, or a
    // static/hidden reset immediately wins. An old exit is never queued behind it.
    if (action || blocked || calmVisual || skipEntry) {
      active = null;
      outgoing = null;
      skipEntry = false;
      return Object.freeze({ action, progress: clamp(progress) });
    }
    if (active) {
      if (active.shown) outgoing = { ...active, startedAt: now };
      active = null;
    }
    if (!outgoing) return Object.freeze({ action: null, progress: 0 });
    const phaseProgress = clamp((now - outgoing.startedAt) / EXIT_MS);
    if (phaseProgress >= 1) {
      outgoing = null;
      return Object.freeze({ action: null, progress: 0 });
    }
    return decorate(outgoing.action, 'exit', phaseProgress, outgoing.progress,
      now - outgoing.enteredAt, outgoing.opacity * (1 - smooth(phaseProgress)), false);
  }

  return Object.freeze({ sample, reset, snapshot: () => visible });
}

export { createMirrorPlayback, isContextMirror, resolveMirrorBodyPose, ENTER_MS, EXIT_MS };
