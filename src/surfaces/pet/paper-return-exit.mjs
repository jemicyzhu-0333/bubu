'use strict';
// One presentation-only exit, never a queued business action. New expressions
// remain owned by the director while this short tool/hand recovery finishes.
function createPaperReturnExit() {
  let previous = null, exit = null, resume = null, formId = null, lastTime = null, idleView = null;
  const keyFor = o => o.egg?.presentationEventId || `${o.egg?.id || ''}:${o.actionStartedAt || 0}`;
  const reset = () => { previous = null; exit = null; resume = null; formId = null; lastTime = null; idleView = null; };
  function step(result, options) {
    const state = options.combinationContext?.state || {};
    const blocked = state.sessionPaused || state.screenLocked || state.dockedEdge
      || state.commandMenuOpen || state.foodMenuOpen || state.devtoolsOpen
      || ['input-safe', 'essential', 'session'].includes(options.combinationContext?.source)
      || !Number.isFinite(options.now) || (lastTime !== null && options.now < lastTime)
      || options.calmVisual || options.preview || state.dragging
      || ['dragged', 'sleeping', 'resting', 'walking', 'celebrating'].includes(state.state)
      || (formId && formId !== options.form?.id);
    formId = options.form?.id;
    if (blocked) { reset(); return result; }
    lastTime = options.now;
    if (!options.egg?.manual) {
      const calmIdle = !options.egg && !result.actionConfig && state.state === 'idle'
        && (!options.combinationContext?.source || options.combinationContext.source === 'base');
      if (calmIdle && resume && previous?.actionConfig?.id === 'sip-tea' && options.now >= previous.deadline) idleView = resume.view;
      else if (!calmIdle) idleView = null;
      previous = null; exit = null; resume = null;
      return idleView ? Object.freeze({ ...result, viewHint: idleView }) : result;
    }
    idleView = null;
    const now = options.now, key = keyFor(options);
    if (!exit && previous?.actionConfig?.id === 'paper-return'
      && (result.actionConfig?.id !== 'paper-return' || previous.key !== key) && previous.actionT < .96) {
      exit = { action: previous.actionConfig, progress: previous.actionT, start: now, view: options.viewFor?.(previous.actionConfig) };
      resume = null;
    }
    if (exit) {
      const t = Math.max(0, (now - exit.start) / 420);
      if (t < 1) {
        // Requests can replace each other, but cannot restart or stack exits.
        previous = null;
        return Object.freeze({ ...result, actionConfig: Object.freeze({ ...exit.action,
          paperReturnExit: Object.freeze({ progress: exit.progress, t }) }),
        actionT: exit.progress, phase: 'interrupted-recovery' });
      }
      const view = exit.view;
      exit = null;
      resume = { key, start: result.actionT, view };
    }
    if (resume && resume.key !== key) resume = null;
    if (resume && result.actionConfig) {
      // Preserve the incoming take-up pose, then reach its original deadline.
      const progress = Math.max(0, Math.min(1, (result.actionT - resume.start) / Math.max(.001, 1 - resume.start)));
      const recovery = result.actionConfig.id === 'sip-tea' ? Math.max(0, Math.min(1, (progress - .86) / .14)) : 0;
      const fade = Math.max(0, Math.min(1, (recovery - .15) / .55));
      result = Object.freeze({ ...result, actionConfig: Object.freeze({ ...result.actionConfig,
        exitTransitionView: resume.view, ...(result.actionConfig.id === 'sip-tea' ? {
          handoffRecovery: recovery, propOpacity: (result.actionConfig.propOpacity ?? 1) * (1 - fade * fade * (3 - 2 * fade)) } : {}) }), actionT: progress });
    }
    previous = { ...result, key, deadline: (options.actionStartedAt || 0) + (options.egg?.duration ?? Infinity) };
    return result;
  }
  return Object.freeze({ step, reset });
}
export { createPaperReturnExit };
