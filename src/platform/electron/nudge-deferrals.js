'use strict';

const { nudgePolicy } = require('../../capabilities/attention');
const PROTECTED_RETRY_MS = 30000;

// Ephemeral user deferrals, not another routine state store. Routine payloads
// contain identity only; every replay resolves its content from the owner.
function createNudgeDeferrals({ setTimer, clearTimer, resolveRoutineRequest, start, report }) {
  const entries = new Map();
  const owns = entry => entries.get(entry.instanceId) === entry;
  const resolve = entry => entry.type === 'routine'
    ? resolveRoutineRequest(entry.identity)
    : entry.options;

  function remove(entry) {
    if (!owns(entry)) return;
    clearTimer(entry.timer);
    entries.delete(entry.instanceId);
  }

  function arm(entry, delay) {
    if (!owns(entry)) return;
    entry.timer = setTimer(() => { void replay(entry); }, delay);
  }

  async function replay(entry) {
    if (!owns(entry)) return;
    try {
      const request = resolve(entry);
      if (!request) return remove(entry);
      const result = await start(request, { instanceId: entry.instanceId, deferralOwner: entry });
      if (!owns(entry)) return;
      if (result.reason === 'higher-priority-active' && entry.type === 'routine' && resolve(entry)) {
        arm(entry, PROTECTED_RETRY_MS);
      } else {
        remove(entry);
      }
    } catch (error) {
      remove(entry);
      report(error, { channel: 'nudge:deferral' });
    }
  }

  function schedule(instanceId, request, delay) {
    const previous = entries.get(instanceId);
    if (previous) remove(previous);
    const entry = {
      instanceId,
      type: request.type,
      priority: nudgePolicy.deferralPriority(request.type, request.priority),
      ...(request.type === 'routine'
        ? { identity: { routineId: request.context.routineId, occurrenceId: request.context.occurrenceId } }
        : { options: request }),
      timer: null
    };
    entries.set(instanceId, entry);
    arm(entry, delay);
  }

  function cancel(policy, { preserveRoutines = false } = {}) {
    for (const entry of entries.values()) {
      if (preserveRoutines && entry.type === 'routine') continue;
      if (nudgePolicy.shouldCancelDeferral(entry.priority, policy)) remove(entry);
    }
  }

  function reconcile() {
    for (const entry of entries.values()) {
      if (entry.type === 'routine' && !resolve(entry)) remove(entry);
    }
  }

  return Object.freeze({ schedule, cancel, reconcile, owns });
}

module.exports = { createNudgeDeferrals };
