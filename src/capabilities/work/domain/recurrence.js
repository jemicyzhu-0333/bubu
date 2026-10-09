'use strict';

const { parseDayKey } = require('../../../core/calendar');
const recurrenceRule = require('../../../core/recurrence-rule');
const { normalizeStep } = require('./task-model');

/**
 * Materialize a fresh occurrence from the series template.
 *
 * Every step receives a brand new ID and no runtime field of the previous
 * occurrence is copied: reward identity, focus history, blockers and selection
 * counters all belong to the occurrence that earned them.
 */
function buildOccurrence(series, options = {}) {
  if (!series || typeof series !== 'object') throw new TypeError('A recurrence series is required');
  const date = parseDayKey(options.date) && options.date;
  const now = options.now;
  if (typeof now !== 'number' || !Number.isFinite(now) || now < 0 || now > 8.64e15) {
    throw new TypeError('options.now must be a finite non-negative timestamp');
  }
  const newTaskId = options.taskId;
  if (typeof newTaskId !== 'string' || !newTaskId.trim()) {
    throw new TypeError('A new task id is required to build an occurrence');
  }
  const newStepId = typeof options.stepId === 'function' ? options.stepId : (index => `${newTaskId}-step-${index + 1}`);
  const template = series.template || {};
  const stepIds = new Set();
  const steps = (Array.isArray(template.stepTitles) ? template.stepTitles : []).map((title, index) => (
    normalizeStep({ id: newStepId(index), title, done: false, completionCycle: 0 }, index, stepIds)
  ));

  return {
    id: newTaskId.trim(),
    createdAt: now,
    updatedAt: now,
    title: template.title,
    description: template.description ?? null,
    steps,
    done: false,
    completedAt: null,
    skippedAt: null,
    expired: false,
    archivedAt: null,
    archiveReason: null,
    plannedFor: date,
    scheduledFor: null,
    scheduleNotifiedAt: null,
    deadline: null,
    expiresAt: null,
    seriesId: series.id,
    occurrenceDate: date,
    tags: Array.isArray(template.tags) ? [...template.tags] : [],
    energy: template.energy,
    energyAuto: template.energyAuto,
    estimateMinutes: template.estimateMinutes ?? null,
    estimateSource: template.estimateMinutes === null || template.estimateMinutes === undefined ? 'rule' : 'user',
    suggestedMin: options.suggestedMin,
    blocker: null,
    nextAction: steps.length ? steps[0].title : null,
    lastCheckpoint: null,
    lastCheckpointAt: null,
    activationFriction: null,
    focusedMs: 0,
    focusSessions: 0,
    overdueCount: 0,
    completionCycle: 0,
    selectionCount: 0,
    avoidanceCount: 0,
    lastSelectedAt: null,
    lastStartedAt: null,
    lastAvoidedAt: null
  };
}

module.exports = {
  ...recurrenceRule,
  buildOccurrence
};
