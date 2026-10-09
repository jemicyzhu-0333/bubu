'use strict';

// 三个很小的个人记录命令（schema 11）：报起床时间、把一条闪念留成情绪记录、删掉一条情绪记录。
// 放在同一个文件里是因为它们共用同一套“收下—落盘—通知面板”的形状；写集各自声明在 manifest 里。
const { redactRelatedReceipts } = require('../ai/receipt-privacy');
const guidance = require('../../capabilities/guidance');
const work = require('../../capabilities/work');
const { localDayKey } = require('../../core/calendar');
const { MAX_MOOD_ID } = require('../../core/wellbeing');
const { runPostCommitEffect } = require('../../shared/post-commit-effects');
const { classifyInboxDraft } = require('./classify-inbox-draft');

const SET_WAKE_TIME_WRITES = Object.freeze(['wakeTimes']);
const KEEP_MOOD_NOTE_WRITES = Object.freeze(['impulses', 'moodNotes', 'energySignals']);
const DELETE_MOOD_NOTE_WRITES = Object.freeze(['moodNotes', 'impulses', 'aiCollaboration']);

function requirePorts({ unitOfWork, clock }) {
  if (!unitOfWork || typeof unitOfWork.run !== 'function' || !clock || typeof clock.now !== 'function') {
    throw new TypeError('wellbeing commands require unitOfWork and clock ports');
  }
}

function run({ unitOfWork, clock, publish, reportEffectError }, writes, dirty, transition) {
  const at = clock.now();
  const transaction = unitOfWork.run({ writes, context: { now: at }, transition: state => transition(state, at) });
  if (!transaction.ok) return { ok: false, reason: transaction.reason };
  if (transaction.committed && typeof publish === 'function') {
    runPostCommitEffect(publish, Object.freeze({ type: 'wellbeing-changed', dirty,
      ...(transaction.inboxResolution ? { inboxResolution: Object.freeze({ ...transaction.inboxResolution }) } : {})
    }), reportEffectError || (() => {}));
  }
  return { ok: true, changed: Boolean(transaction.committed), ...transaction.detail };
}

function createSetWakeTimeCommand(ports) {
  requirePorts(ports);
  return Object.freeze({
    execute({ minutes } = {}) {
      return run(ports, SET_WAKE_TIME_WRITES, { wellbeing: true }, (state, at) => {
        const result = guidance.wakeTime.recordWakeTime(state, { dayKey: localDayKey(at), minutes });
        return result.ok ? { ...result, detail: { minutes: result.minutes } } : result;
      });
    }
  });
}

function createKeepMoodNoteCommand(ports) {
  requirePorts(ports);
  if (typeof ports.idFactory !== 'function') throw new TypeError('keeping a mood note requires an identity policy');
  return Object.freeze({
    execute({ impulseId } = {}) {
      return run(ports, KEEP_MOOD_NOTE_WRITES, { wellbeing: true, impulses: true, energy: true, recommendations: true }, (state, at) => {
        const impulse = work.impulseInbox.findImpulse(state, impulseId);
        if (!impulse) return { ok: false, reason: 'impulse-not-found' };
        const classified = classifyInboxDraft(state, { id: impulse.id, category: 'feeling' });
        if (!classified.ok) return classified;
        const added = guidance.moodNotes.addMoodNote(state, {
          id: ports.idFactory('mood'), at: impulse.createdAt, text: impulse.text
        });
        if (!added.ok) return added;
        // 同一笔事务移出待整理，并留下可追溯的原文与去向。
        const consumed = work.inboxRecords.resolveRecord(state, impulse.id, {
          action: 'feeling', category: 'feeling', at, targetId: added.note.id
        });
        return consumed.ok ? { ok: true, detail: { id: added.note.id }, inboxResolution: {
          inboxId: consumed.impulse.id, resolvedAt: consumed.impulse.resolution.at,
          action: consumed.impulse.resolution.action, targetId: consumed.impulse.resolution.targetId
        } } : consumed;
      });
    }
  });
}

function createDeleteMoodNoteCommand(ports) {
  requirePorts(ports);
  return Object.freeze({
    execute({ id } = {}) {
      if (typeof id !== 'string' || !id.trim() || id.trim().length > MAX_MOOD_ID) {
        return { ok: false, reason: 'mood-note-invalid' };
      }
      id = id.trim();
      let archivedSources;
      if (ports.inboxArchive) {
        try { archivedSources = ports.inboxArchive.idsByTarget?.('feeling', id); } catch (_) {}
        if (archivedSources?.ok !== true || !Array.isArray(archivedSources.ids)) {
          return { ok: false, reason: 'mood-source-query-unavailable' };
        }
      }
      const archivedIds = archivedSources?.ok ? archivedSources.ids : [];
      const result = run(ports, DELETE_MOOD_NOTE_WRITES, { wellbeing: true, impulses: true }, state => {
        const sourceIds = [...archivedIds, ...state.impulses.filter(item => item.resolution?.action === 'feeling'
          && item.resolution.targetId === id).map(item => item.id)];
        const deleted = guidance.moodNotes.deleteMoodNote(state, id);
        if (!deleted.ok && !sourceIds.length) {
          if (!ports.inboxArchive) return deleted;
          return { ok: true, detail: { alreadyAbsent: true, localDeleted: false, receiptDetailsRedacted: false } };
        }
        work.inboxRecords.removeMoodRecords(state, id);
        const privacy = redactRelatedReceipts(state, { sourceRefs: sourceIds.map(sourceId => ({ kind: 'inbox', id: sourceId })) });
        return privacy.ok ? { ok: true, detail: { receiptDetailsRedacted: privacy.changed, localDeleted: deleted.ok } } : privacy;
      });
      if (!result.ok) return result;
      if ((result.alreadyAbsent && !ports.durability) || (ports.durability && !ports.durability.verify().ok)) {
        return { ...result, ok: false, reason: 'mood-delete-partial', sourceCleanupPending: true, durability: 'unconfirmed' };
      }
      if (result.alreadyAbsent) return result;
      if (ports.inboxArchive) {
        let removed;
        try { removed = ports.inboxArchive.removeByTarget('feeling', id); } catch (_) { removed = null; }
        if (!removed?.ok) return { ...result, ok: false, reason: 'mood-delete-partial', sourceCleanupPending: true };
      }
      return result;
    }
  });
}

module.exports = {
  SET_WAKE_TIME_WRITES,
  KEEP_MOOD_NOTE_WRITES,
  DELETE_MOOD_NOTE_WRITES,
  createSetWakeTimeCommand,
  createKeepMoodNoteCommand,
  createDeleteMoodNoteCommand
};
