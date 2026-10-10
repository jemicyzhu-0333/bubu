'use strict';

const work = require('../../capabilities/work');
const execution = require('../../capabilities/execution');
const { runPostCommitEffect } = require('../../shared/post-commit-effects');
const { createWorkItemDraft } = require('./create-work-item');
const { classifyInboxDraft } = require('./classify-inbox-draft');

const RESOLVE_IMPULSE_WRITES = Object.freeze([
  'impulses',
  'tasks',
  'archivedTasks',
  'nowTaskId',
  'stats',
  'energySignals'
]);
const IMPULSE_ACTIONS = Object.freeze([
  'promote',
  'delete',
  'next-step',
  'schedule',
  'someday'
]);

function requireTaskPolicies({
  idFactory,
  inferEnergy,
  suggestDuration,
  nextWorkStart
}) {
  if ([idFactory, inferEnergy, suggestDuration, nextWorkStart]
    .some(policy => typeof policy !== 'function')) {
    throw new TypeError('resolve-impulse workflow requires task and schedule policies');
  }
}

function taskInputFor(action, impulse, resolvedAt, policies) {
  const title = impulse.text.slice(0, work.taskModel.LIMITS.TITLE);
  const task = { title, energy: 'auto', steps: [],
    ...(impulse.text.length > title.length ? { description: impulse.text } : {}) };
  // PRODUCT「捕捉与任务」: conversion opens an editable preview. Only its
  // confirmed steps may be added; a hidden starter would survive cancel and
  // be prepended to the person's approved suggestions.
  if (action === 'schedule') {
    const scheduledAt = policies.nextWorkStart(resolvedAt);
    if (typeof scheduledAt !== 'number' || !Number.isFinite(scheduledAt)
        || scheduledAt < 0 || scheduledAt > 8.64e15) {
      throw new TypeError('next work start must be a finite non-negative time');
    }
    task.scheduledFor = new Date(scheduledAt).toISOString();
  }
  return { ok: true, task };
}

function createResolvedTask(state, action, impulse, resolvedAt, policies) {
  const input = taskInputFor(action, impulse, resolvedAt, policies);
  if (!input.ok) return input;
  const created = createWorkItemDraft(state, {
    task: input.task,
    createdAt: resolvedAt,
    selectAsNow: action === 'promote'
  }, policies);
  if (!created.ok) return created;

  if (action === 'next-step') {
    const selected = execution.nowSelection.selectTask(created.task.id);
    if (!selected.ok) return selected;
    state.nowTaskId = selected.nowTaskId;
  }
  if (action === 'someday') {
    return work.taskArchiving.archiveTask(state, {
      taskId: created.task.id,
      reason: 'someday',
      now: resolvedAt
    });
  }
  return created;
}

function responseFor(transaction, action) {
  if (!transaction.ok) return { ok: false, reason: transaction.reason };
  if (action === 'delete') return { ok: true, action };
  const collection = action === 'someday'
    ? transaction.state.archivedTasks
    : transaction.state.tasks;
  const task = collection.find(candidate => candidate.id === transaction.taskId);
  return action === 'promote' ? { ok: true, task } : { ok: true, action, task };
}

function createResolveImpulseWorkflow({
  unitOfWork,
  clock,
  idFactory,
  inferEnergy,
  suggestDuration,
  nextWorkStart,
  publish = () => {},
  reportEffectError = () => {}
} = {}) {
  if (!unitOfWork || typeof unitOfWork.run !== 'function') {
    throw new TypeError('resolve-impulse workflow requires a unit of work');
  }
  if (!clock || typeof clock.now !== 'function') {
    throw new TypeError('resolve-impulse workflow requires a clock');
  }
  const policies = { idFactory, inferEnergy, suggestDuration, nextWorkStart };
  requireTaskPolicies(policies);
  if (typeof publish !== 'function' || typeof reportEffectError !== 'function') {
    throw new TypeError('resolve-impulse workflow effects must be functions');
  }

  function execute({ impulseId, action, expectedRevision } = {}) {
    const resolvedAt = clock.now();
    const transaction = unitOfWork.run({
      writes: RESOLVE_IMPULSE_WRITES,
      expectedRevision,
      context: { now: resolvedAt },
      transition: state => {
        if (!IMPULSE_ACTIONS.includes(action)) {
          return { ok: false, reason: 'impulse-action-invalid' };
        }
        const impulse = work.impulseInbox.findImpulse(state, impulseId);
        if (!impulse) return { ok: false, reason: 'impulse-not-found' };

        let taskId = null;
        if (action !== 'delete') {
          const classified = classifyInboxDraft(state, { id: impulse.id, category: 'task' });
          if (!classified.ok) return classified;
          const created = createResolvedTask(state, action, impulse, resolvedAt, policies);
          if (!created.ok) return created;
          taskId = created.task.id;
        }
        const consumed = action === 'delete'
          ? work.impulseInbox.consumeImpulse(state, impulse.id)
          : work.inboxRecords.resolveRecord(state, impulse.id, { action, category: 'task', at: resolvedAt, targetId: taskId });
        return consumed.ok
          ? { ok: true, impulseId: consumed.impulse.id, taskId }
          : consumed;
      }
    });

    if (transaction.ok && transaction.committed) {
      const fact = Object.freeze({
        type: 'impulse-resolved',
        impulseId: transaction.impulseId,
        action,
        taskId: transaction.taskId,
        resolvedAt,
        revision: transaction.revision
      });
      runPostCommitEffect(publish, fact, reportEffectError);
    }
    return responseFor(transaction, action);
  }

  return Object.freeze({ execute });
}

module.exports = {
  IMPULSE_ACTIONS,
  RESOLVE_IMPULSE_WRITES,
  createResolveImpulseWorkflow
};
