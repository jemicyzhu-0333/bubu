'use strict';

// One content-free operation shared by timeline and source history. Canonical
// absence alone never grants permission: history binds a freshly loaded source.
function createTimelineMoodDeletion({ sendDelete, hasMood, findSource = () => null, render = () => {}, refresh } = {}) {
  if ([sendDelete, hasMood, render, refresh].some(port => typeof port !== 'function')) {
    throw new TypeError('mood deletion requires scoped command and view ports');
  }
  let armed = null, operation = null, disposed = false;
  const observers = new Set();
  function view() {
    const confirmation = { armedSourceId: armed?.sourceId || null, armedMoodId: armed?.moodId || null };
    if (!operation) return Object.freeze({ ...confirmation, phase: null, busy: false, canRetry: false, canDismiss: false });
    const { moodId, dayKey, phase, alreadyAbsent } = operation;
    return Object.freeze({ ...confirmation, moodId, dayKey, phase, alreadyAbsent: alreadyAbsent === true,
      busy: phase === 'sending', canRetry: ['refused', 'partial', 'unknown'].includes(phase),
      canDismiss: ['refused', 'complete'].includes(phase) });
  }
  function publish() {
    if (disposed) return;
    for (const observer of [render, ...observers]) {
      try { observer(view()); } catch (_) { /* A view failure cannot cancel an authorized command. */ }
    }
  }
  async function perform(target) {
    const prior = target.phase;
    target.phase = 'sending'; publish();
    let result;
    try { result = await sendDelete(target.moodId); } catch (_) { result = null; }
    if (disposed || operation !== target) return;
    if (result?.durability === 'unconfirmed' || result?.outcome === 'unknown' || result?.retrySameIdentity === true || (result?.ok === true && result.sourceCleanupPending === true)) {
      target.phase = 'unknown';
    } else if (result?.ok === true && typeof result.changed === 'boolean' && typeof result.localDeleted === 'boolean'
        && (result.alreadyAbsent === undefined || typeof result.alreadyAbsent === 'boolean')
        && (result.sourceCleanupPending === undefined || result.sourceCleanupPending === false)
        && (result.retrySameIdentity === undefined || result.retrySameIdentity === false)
        && result.outcome === undefined && result.durability === undefined
        && (result.alreadyAbsent !== true || (!result.changed && !result.localDeleted))) {
      target.phase = 'complete'; target.alreadyAbsent = result.alreadyAbsent === true;
    } else if (result?.reason === 'mood-delete-partial' && result.sourceCleanupPending === true) target.phase = 'partial';
    else if (result?.reason === 'mood-source-query-unavailable' || result?.reason === 'mood-note-invalid') {
      target.phase = ['unknown', 'partial'].includes(prior) ? prior : 'refused';
    } else target.phase = 'unknown';
    publish();
    if (target.phase === 'complete') {
      try { await refresh(target.dayKey, target.moodId); } catch (_) { /* Deletion success is not undone by a failed view refresh. */ }
    }
  }
  function confirm(identity) {
    if (disposed || (operation && operation.phase !== 'complete')) return 'blocked';
    if (!armed || Object.keys(identity).some(key => identity[key] !== armed[key])) {
      armed = identity; publish(); return 'armed';
    }
    armed = null;
    operation = { moodId: identity.moodId, dayKey: identity.dayKey, phase: 'ready', alreadyAbsent: false };
    void perform(operation);
    return 'sending';
  }
  function activate(moodId, dayKey) {
    if (disposed || !hasMood(moodId)) { armed = null; publish(); return 'blocked'; }
    return confirm({ kind: 'mood', moodId, dayKey });
  }
  function activateSource(sourceId, moodId, dayKey) {
    if (disposed) return 'blocked';
    const source = findSource(sourceId);
    if (!source || source.id !== sourceId || typeof moodId !== 'string' || !moodId
        || moodId.trim() !== moodId || moodId.length > 64 || source.resolution?.action !== 'feeling'
        || source.resolution.targetId !== moodId || hasMood(moodId)
        || !Number.isSafeInteger(source.createdAt) || !Number.isSafeInteger(source.resolution.at)) {
      armed = null; publish(); return 'blocked';
    }
    return confirm({ kind: 'source', sourceId, moodId, dayKey,
      createdAt: source.createdAt, resolvedAt: source.resolution.at });
  }
  function retry() {
    if (disposed || !operation || !view().canRetry) return false;
    void perform(operation); return true;
  }
  function dismiss() {
    if (disposed || !view().canDismiss) return false;
    operation = null; armed = null; publish(); return true;
  }
  return Object.freeze({ activate, activateSource, retry, dismiss, view,
    subscribe(observer) {
      if (disposed || typeof observer !== 'function') return () => {};
      observers.add(observer); observer(view());
      return () => observers.delete(observer);
    },
    resetArming() { if (armed) { armed = null; publish(); } },
    dispose() { disposed = true; armed = null; operation = null; observers.clear(); }
  });
}
export { createTimelineMoodDeletion };
