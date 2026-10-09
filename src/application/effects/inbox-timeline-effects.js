'use strict';

const { localDayKey } = require('../../core/calendar');

function localEventContext(at) {
  return { timezone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
    utcOffsetMinutes: -new Date(at).getTimezoneOffset(), localDayKey: localDayKey(at) };
}

// Existing local command facts only. Ordinary recording stays best effort;
// confirmed AI receipts use the separate persistent outbox publisher.
function createInboxTimelineEffects({ timelineRecorder, timeContextFor = localEventContext,
  reportEffectError = () => {} } = {}) {
  function record(method, input, at) {
    if (typeof timelineRecorder?.[method] !== 'function' || !Number.isSafeInteger(at) || at < 0) return 0;
    try { return timelineRecorder[method]({ ...input, ...timeContextFor(at) })?.recorded || 0; }
    catch (error) {
      try { reportEffectError(error, 'inbox-timeline'); } catch (_) { /* A failed observer cannot retry business. */ }
      return 0;
    }
  }
  function captured(fact) {
    if (fact?.type !== 'impulse-captured') return 0;
    return record('recordInboxCaptured', { inboxId: fact.impulseId, capturedAt: fact.capturedAt }, fact.capturedAt);
  }
  function resolved(facts) {
    let recorded = 0;
    for (const fact of Array.isArray(facts) ? facts.slice(0, 100) : []) {
      if (!fact || fact.action === 'delete') continue;
      recorded += record('recordInboxResolved', { inboxId: fact.inboxId, resolvedAt: fact.resolvedAt,
        action: fact.action, targetId: fact.targetId || null }, fact.resolvedAt);
    }
    return recorded;
  }
  return Object.freeze({ captured, resolved });
}
module.exports = { createInboxTimelineEffects, localEventContext };
