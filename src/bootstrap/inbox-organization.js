'use strict';

const {
  createResolveImpulseWorkflow,
  createInboxTimelineEffects,
  createOrganizeInboxWorkflow,
  createArchiveInboxRecordsWorkflow,
  createDeleteInboxRecordWorkflow,
  createInboxHistoryQuery,
  createKeepMoodNoteCommand,
  createDeleteMoodNoteCommand
} = require('../application');
const { ROUTINE_EFFECT_PROFILES } = require('../content/energy-effects.mjs');

// Composition of every inbox command: turning captures into tasks, routines, states
// or mood notes, keeping and deleting them, and moving resolved captures into the
// fact-store archive (ARCHITECTURE「收件分类与原文历史」). No business rule lives here.
const RESOLVED_DIRTY = Object.freeze({
  delete: { impulses: true },
  promote: { tasks: true, impulses: true, nowTask: true, recommendations: true, energy: true }
});
const RESOLVED_DEFAULT_DIRTY = Object.freeze({ tasks: true, archivedTasks: true, impulses: true, nowTask: true, recommendations: true, energy: true });

function createInboxOrganization({
  unitOfWork, readSnapshot, clock, idFactory, archive, taskPolicies, durability,
  publishChange, publishRoutine = () => {}, reportEffectError, timelineRecorder
} = {}) {
  if (!unitOfWork || typeof readSnapshot !== 'function' || !archive || !taskPolicies
      || typeof publishChange !== 'function' || typeof reportEffectError !== 'function') {
    throw new TypeError('inbox organization requires state, archive, task policy and effect ports');
  }
  const report = channel => error => reportEffectError(error, channel);
  const timelineEffects = createInboxTimelineEffects({ timelineRecorder, reportEffectError });
  const archiving = createArchiveInboxRecordsWorkflow({
    unitOfWork, readSnapshot, archive,
    publish: () => publishChange({ impulses: true }),
    reportEffectError: report('inbox-archive')
  });
  // Every committed inbox outcome is copied to the archive right after it lands.
  function afterCommit(dirty, resolutions = []) {
    const recorded = timelineEffects.resolved(resolutions);
    publishChange(recorded ? { ...dirty, timeline: true } : dirty);
    const flushed = archiving.flush();
    if (!flushed.ok) report('inbox-archive')(new Error(flushed.reason));
  }
  const resolveImpulse = createResolveImpulseWorkflow({
    unitOfWork, clock, idFactory, ...taskPolicies,
    publish: fact => afterCommit(RESOLVED_DIRTY[fact.action] || RESOLVED_DEFAULT_DIRTY, [{
      inboxId: fact.impulseId, resolvedAt: fact.resolvedAt, action: fact.action, targetId: fact.taskId
    }]),
    reportEffectError: report('impulses:review')
  });
  const organize = createOrganizeInboxWorkflow({
    unitOfWork, clock, idFactory, profiles: ROUTINE_EFFECT_PROFILES,
    publish: result => {
      afterCommit({ impulses: true, routines: true, energy: true, recommendations: true }, result.resolutions);
      if (result.fact) publishRoutine(result.fact);
    },
    reportEffectError: report('impulses:organize')
  });
  const deleteRecord = createDeleteInboxRecordWorkflow({
    unitOfWork, archive, durability, publish: () => publishChange({ impulses: true }), reportEffectError: report('impulses:delete')
  });
  const moodPorts = { unitOfWork, clock, durability, inboxArchive: archive, reportEffectError: report('wellbeing') };
  const keepMoodNote = createKeepMoodNoteCommand({ ...moodPorts, idFactory, publish: fact => afterCommit(fact.dirty, fact.inboxResolution ? [fact.inboxResolution] : []) });
  const deleteMoodNote = createDeleteMoodNoteCommand({ ...moodPorts, publish: fact => publishChange(fact.dirty) });
  const history = createInboxHistoryQuery({ readSnapshot, archive });

  function register(registerIpc) {
    if (typeof registerIpc !== 'function') throw new TypeError('inbox organization requires an IPC registrar');
    registerIpc('impulses:promote', (_event, id) => resolveImpulse.execute({ impulseId: id, action: 'promote' }));
    registerIpc('impulses:review', (_event, { id, action }) => resolveImpulse.execute({ impulseId: id, action }));
    registerIpc('impulses:delete', (_event, id) => deleteRecord.execute({ impulseId: id }));
    registerIpc('impulses:organize', (_event, payload) => organize.execute(payload));
    registerIpc('impulses:keep-all', (_event, payload) => organize.keepAll(payload));
    registerIpc('impulses:history', (_event, payload) => history.page(payload));
    registerIpc('impulses:keep-mood', (_event, impulseId) => keepMoodNote.execute({ impulseId }));
    registerIpc('mood:delete', (_event, id) => deleteMoodNote.execute({ id }));
    // Startup catch-up: anything resolved before the archive existed, or while it failed.
    const flushed = archiving.flush();
    if (!flushed.ok) report('inbox-archive')(new Error(flushed.reason));
  }

  return Object.freeze({ register, flushResolved: () => archiving.flush(), historyTotal: impulses => history.total(impulses) });
}

module.exports = { createInboxOrganization };
