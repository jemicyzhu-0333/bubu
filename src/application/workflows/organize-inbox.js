'use strict';

const { work, routines, guidance } = require('../../capabilities');
const { localDayKey, addDaysToKey } = require('../../core/calendar');
const { runPostCommitEffect } = require('../../shared/post-commit-effects');
const { classifyInboxDraft } = require('./classify-inbox-draft');

const ORGANIZE_INBOX_WRITES = Object.freeze(['impulses', 'routines', 'routineLog', 'energyCheckIn', 'energySignals']);
const ORGANIZE_ACTIONS = Object.freeze(['classify', 'keep', 'routine', 'log', 'state']);
const { MAX_KEEP_ALL } = work.inboxRecords;

function routineTarget(state, { action, kind, routineId, createNew, title, profiles, idFactory, at }) {
  const matching = state.routines.filter(item => item.kind === kind && item.active);
  if (action === 'log' && !createNew) {
    // A shared custom kind says nothing about whether two activities are the same.
    // Require the person's explicit target rather than associating unrelated records.
    const routine = routineId ? matching.find(item => item.id === routineId)
      : kind !== 'custom' && matching.length === 1 ? matching[0] : null;
    if (routineId && !routine) return { ok: false, reason: 'routine-not-found' };
    if (routine) return { ok: true, routine };
    if (matching.length > 1 || (kind === 'custom' && matching.length)) return { ok: false, reason: 'routine-choice-required' };
  }
  return routines.routineEditing.addRoutine(state, { title, kind, schedule: null, profiles, idFactory, now: at });
}

function organizeRoutine(state, impulse, classification, request, ports) {
  const kind = classification.routineKind;
  if (!kind) return { ok: false, reason: 'routine-kind-required' };
  const dayKey = localDayKey(impulse.createdAt);
  if (request.action === 'log' && (dayKey < addDaysToKey(localDayKey(ports.at), -1) || impulse.createdAt > ports.at)) {
    return { ok: false, reason: 'capture-too-old-for-log' };
  }
  const target = routineTarget(state, { ...request, kind, ...ports });
  if (!target.ok) return target;
  if (request.action !== 'log') return { ok: true, targetId: target.routine.id, fact: null };
  const logged = routines.routineLogging.logOccurrence(state, {
    routineId: target.routine.id, status: 'done', dayKey, at: impulse.createdAt
  });
  if (!logged.ok) return logged;
  return { ok: true, targetId: target.routine.id, fact: { type: 'routine-logged', routineId: target.routine.id,
    occurrenceId: logged.occurrenceId, status: logged.status, kind: logged.kind, scheduled: logged.scheduled,
    at: impulse.createdAt, dayKey } };
}

function organizeState(state, impulse, classification) {
  if (classification.level === null) return { ok: false, reason: 'energy-level-required' };
  // An old inbox item must never replace a newer explicit self-report.
  if (state.energyCheckIn?.timestamp > impulse.createdAt) return { ok: false, reason: 'newer-check-in-exists' };
  const result = guidance.energyCheckIn.recordEnergyCheckIn(state, {
    level: classification.level, state: guidance.energyCheckIn.energyStateForLevel(classification.level), timestamp: impulse.createdAt
  });
  if (!result.ok) return result;
  guidance.energySignals.removeImpulseEnergySignal(state, impulse.id);
  return { ok: true, targetId: null, fact: null };
}

// One commit owns the label, the destination AND the original capture's outcome. No
// renderer add/delete sequence, so retries cannot duplicate a routine or lose the source.
function createOrganizeInboxWorkflow({ unitOfWork, clock, idFactory, profiles, publish = () => {}, reportEffectError = () => {} }) {
  function transitionFor(request, at) {
    return state => {
      if (!ORGANIZE_ACTIONS.includes(request.action)) return { ok: false, reason: 'impulse-action-invalid' };
      if (request.action === 'classify' || request.category !== undefined) {
        const classified = classifyInboxDraft(state, request);
        if (!classified.ok || request.action === 'classify') return classified;
      }
      const impulse = work.impulseInbox.findImpulse(state, request.id);
      if (!impulse) return { ok: false, reason: 'impulse-not-found' };
      const classification = work.inboxRecords.classificationOf(impulse);
      if (request.action !== 'keep' && classification.category !== request.action) return { ok: false, reason: 'impulse-category-changed' };
      const outcome = request.action === 'keep' ? { ok: true, targetId: null, fact: null }
        : request.action === 'state' ? organizeState(state, impulse, classification)
          : organizeRoutine(state, impulse, classification, request, { profiles, idFactory, at });
      if (!outcome.ok) return outcome;
      const resolved = work.inboxRecords.resolveRecord(state, request.id, {
        action: request.action, category: classification.category, at, targetId: outcome.targetId
      });
      return resolved.ok ? { ok: true, fact: outcome.fact, resolutions: [{
        inboxId: resolved.impulse.id, resolvedAt: resolved.impulse.resolution.at,
        action: resolved.impulse.resolution.action, targetId: resolved.impulse.resolution.targetId
      }] } : resolved;
    };
  }

  function commit(transition, writes = ORGANIZE_INBOX_WRITES) {
    const at = clock.now();
    const transaction = unitOfWork.run({ writes, context: { now: at }, transition: transition(at) });
    if (!transaction.ok) return { ok: false, reason: transaction.reason };
    if (transaction.committed) {
      const resolutions = Object.freeze((transaction.resolutions || []).map(value => Object.freeze({ ...value })));
      const fact = transaction.fact
        ? Object.freeze({ ...transaction.fact, revision: transaction.revision }) : null;
      runPostCommitEffect(publish, Object.freeze({ type: 'inbox-organized', fact, resolutions }), reportEffectError);
    }
    return { ok: true, ...(transaction.kept ? { kept: transaction.kept.length } : {}) };
  }

  function execute({ id, action, category, routineKind = null, level = null, title, routineId, createNew = false } = {}) {
    return commit(at => transitionFor({ id, action, category, routineKind, level, title, routineId, createNew }, at));
  }

  // "Keep everything as it is" is the low-effort exit from a long inbox: one commit,
  // nothing deleted, every original text and label moves to history.
  function keepAll({ ids } = {}) {
    if (!Array.isArray(ids) || !ids.length || ids.length > MAX_KEEP_ALL) return { ok: false, reason: 'impulse-ids-invalid' };
    return commit(at => state => {
      const result = work.inboxRecords.keepAll(state, ids, at);
      if (!result.ok) return result;
      const resolutions = result.kept.map(id => work.impulseInbox.findImpulse(state, id, true))
        .filter(item => item?.resolution?.at === at).map(item => ({ inboxId: item.id,
          resolvedAt: item.resolution.at, action: item.resolution.action, targetId: item.resolution.targetId }));
      return { ...result, resolutions };
    }, ['impulses']);
  }

  return Object.freeze({ execute, keepAll });
}

module.exports = { ORGANIZE_INBOX_WRITES, createOrganizeInboxWorkflow };
