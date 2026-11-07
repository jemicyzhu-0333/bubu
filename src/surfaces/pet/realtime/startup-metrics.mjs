// Startup CPU work has no preceding interval. Keep it outside the continuous
// frame distribution, including for reduced-motion or paused first draws.
const stamp = value => Number.isFinite(value) && value >= 0 ? value : null;
const elapsed = (end, start) => end !== null && start !== null && end >= start ? end - start : null;

export function createStartupMetrics(createdAtMs) {
  const state = { createdAtMs: stamp(createdAtMs), stageLoadStartedAtMs: null,
    stageLoadFinishedAtMs: null, readyAtMs: null, stageLoadMs: null, readyMs: null, firstFrame: null };
  return Object.freeze({
    stageStarted(atMs) { state.stageLoadStartedAtMs = stamp(atMs); },
    stageReady(atMs) {
      state.stageLoadFinishedAtMs = stamp(atMs);
      state.stageLoadMs = elapsed(state.stageLoadFinishedAtMs, state.stageLoadStartedAtMs);
    },
    ready(atMs) {
      state.readyAtMs = stamp(atMs);
      state.readyMs = elapsed(state.readyAtMs, state.createdAtMs);
    },
    frame(callbackAtMs, updateStartedAtMs, updatedAtMs, renderFinishedAtMs) {
      if (state.firstFrame) return;
      const callback = stamp(callbackAtMs), started = stamp(updateStartedAtMs);
      const updated = stamp(updatedAtMs), finished = stamp(renderFinishedAtMs);
      state.firstFrame = { callbackAtMs: callback, updateStartedAtMs: started, renderFinishedAtMs: finished,
        callbackDelayMs: elapsed(started, callback), updateMs: elapsed(updated, started),
        renderSubmissionMs: elapsed(finished, updated), totalCpuMs: elapsed(finished, started),
        readyToRenderFinishedMs: elapsed(finished, state.readyAtMs) };
    },
    snapshot: () => ({ ...state, firstFrame: state.firstFrame ? { ...state.firstFrame } : null })
  });
}
