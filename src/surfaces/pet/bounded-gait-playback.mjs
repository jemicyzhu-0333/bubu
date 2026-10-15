'use strict';
import { formArt } from '../../capabilities/companion/index.mjs';

// Only the manual, stage-bound gait preview uses this phase owner. It samples
// the controller's existing animation time; no timer, window or stored path.
function createBoundedGaitPlayback() {
  let episode = null, exit = null;
  function reset(context = null) {
    const state = context?.state;
    const closing = state?.state === 'idle' && !state.devPreview && !state.sessionPaused
      && !state.screenLocked && !state.dragging && !state.dockedEdge && !context.hidden && !context.policy?.calmVisual;
    if (closing && (episode || exit)) return;
    episode = null;
    exit = null;
  }
  function sample({ action, preview, previewStartedAt, now, calmVisual, paused, form, state, source }) {
    const admitted = action?.motionCaps?.stepInPlace === true && action === formArt.previewAction(form, preview?.id)
      && !state?.dragging && [undefined, 'idle', 'walking'].includes(state?.state)
      && !state?.dockedEdge && !state?.screenLocked
      && (!source || source === 'base' || source === 'session');
    if (!admitted || preview?.category !== 'action' || !Number.isFinite(now)) {
      const canSettle = !action && !preview && form?.id === 'dango' && state?.state === 'idle'
        && !calmVisual && !paused && !state.dragging && !state.dockedEdge && !state.screenLocked
        && (!source || source === 'base') && Number.isFinite(now);
      if (!canSettle || !episode && !exit) { reset(); return null; }
      if (!exit) {
        exit = { action: episode.action, playback: episode.playback, progress: episode.progress,
          at: now, view: episode.view, facingHint: episode.facingHint };
        episode = null;
      }
      const settle = Math.max(0, Math.min(1, (now - exit.at) / 220));
      // Keep the exact final native stand while idle. A new preview/action,
      // input-safe state or policy change releases this presentation bridge.
      return Object.freeze({ action: Object.freeze({ ...exit.action,
        previewPlayback: Object.freeze({ ...exit.playback, settle }) }),
      progress: exit.progress, viewHint: exit.view, facingHint: exit.facingHint });
    }
    exit = null;
    const key = `${previewStartedAt}:${preview.id}:${preview.view}:${preview.skin}:${preview.level}`;
    if (!episode || episode.key !== key || now < episode.lastNow) {
      episode = { key, elapsed: 0, lastNow: now, paused: Boolean(paused), generation: 0 };
    }
    if (calmVisual) {
      // Tightening the policy settles both feet immediately. Releasing it
      // starts a new bounded entry, never jumps into a missed airborne phase.
      if (!episode.calm) episode.generation += 1;
      episode.elapsed = 0;
    } else if (!paused && !episode.paused && !episode.calm) {
      episode.elapsed += Math.max(0, now - episode.lastNow);
    }
    episode.lastNow = now;
    episode.paused = Boolean(paused);
    episode.calm = Boolean(calmVisual);
    const duration = action.duration;
    const cycle = Math.floor(episode.elapsed / duration);
    const playback = Object.freeze({
        id: `${key}:${episode.generation}:${cycle}`,
        elapsedMs: episode.elapsed,
        static: Boolean(calmVisual), paused: Boolean(paused)
      });
    const progress = calmVisual ? 0 : (episode.elapsed % duration) / duration;
    // The exact naked native-view preview owns only this frame's display facing.
    // Keep the controller's drag-facing untouched, including through the close bridge.
    const facingHint = ['three-quarter', 'three-quarter-right'].includes(preview.view)
      && preview.level === 1 ? 1 : undefined;
    Object.assign(episode, { action, progress, playback, view: preview.view, facingHint });
    return Object.freeze({ action: Object.freeze({ ...action, previewPlayback: playback }), progress, facingHint });
  }
  return Object.freeze({ sample, reset });
}

export { createBoundedGaitPlayback };
