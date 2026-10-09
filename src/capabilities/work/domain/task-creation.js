'use strict';

const {
  LIMITS,
  normalizeRecurrenceSeries,
  normalizeTask
} = require('./task-model');
const {
  anchorDateFrom,
  buildOccurrence,
  firstOccurrenceDate
} = require('./recurrence');
const { collectUsedIds, makeUniqueId } = require('./task-state');

function requireTimestamp(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 8.64e15) {
    throw new TypeError('task creation requires a finite non-negative time');
  }
  return value;
}

function requirePolicyPorts({ createId, inferEnergy, suggestDuration } = {}) {
  if (typeof createId !== 'function'
      || typeof inferEnergy !== 'function'
      || typeof suggestDuration !== 'function') {
    throw new TypeError('task creation requires identity, energy and duration policies');
  }
  return { createId, inferEnergy, suggestDuration };
}

function collectSeriesIds(state) {
  return new Set(
    (Array.isArray(state.recurrenceSeries) ? state.recurrenceSeries : [])
      .map(series => series && series.id)
      .filter(Boolean)
  );
}

function createSeries(state, input, options) {
  const { createdAt, createId, energy, energyAuto } = options;
  const requestedStart = anchorDateFrom(input.plannedFor, createdAt);
  const series = normalizeRecurrenceSeries({
    id: createId('series'),
    createdAt,
    updatedAt: createdAt,
    state: 'active',
    rule: { ...input.recurrence, anchorDate: requestedStart },
    template: {
      title: input.title,
      description: input.description || null,
      stepTitles: (input.steps || []).map(step => step.title),
      tags: input.tags || [],
      energy,
      energyAuto,
      estimateMinutes: input.estimateMinutes ?? null
    }
  }, { now: createdAt, usedIds: collectSeriesIds(state) });
  series.rule.anchorDate = firstOccurrenceDate(series.rule, requestedStart);
  return series;
}

function createOneOffDraft(input, options) {
  const { createdAt, createId, energy, energyAuto, suggestedMin, usedIds } = options;
  return {
    id: makeUniqueId(usedIds, createId, 'task'),
    createdAt,
    updatedAt: createdAt,
    title: input.title,
    description: input.description || null,
    steps: (input.steps || []).map(step => ({
      id: makeUniqueId(usedIds, createId, 'step'),
      title: step.title,
      done: false,
      completedAt: null,
      completionCycle: 0
    })),
    done: false,
    energy,
    energyAuto,
    estimateMinutes: input.estimateMinutes ?? null,
    estimateSource: input.estimateMinutes ? 'user' : 'rule',
    suggestedMin,
    tags: input.tags || [],
    plannedFor: input.plannedFor || null,
    scheduledFor: input.scheduledFor || null,
    deadline: input.deadline || null,
    expiresAt: input.expiresAt || null,
    expired: false,
    nextAction: input.steps && input.steps[0] ? input.steps[0].title : null
  };
}

function createTask(state, input = {}, options = {}) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new TypeError('task creation requires a state draft');
  }
  const createdAt = requireTimestamp(options.now);
  const { createId, inferEnergy, suggestDuration } = requirePolicyPorts(options);
  const recurrenceSeries = Array.isArray(state.recurrenceSeries) ? state.recurrenceSeries : [];
  if (input.recurrence && recurrenceSeries.length >= LIMITS.SERIES) {
    return { ok: false, reason: 'series-limit-reached' };
  }

  const energyAuto = input.energy === 'auto' || !input.energy;
  const energy = energyAuto ? inferEnergy(input.title) : input.energy;
  const suggestedMin = suggestDuration(input.title, energy);
  const usedIds = collectUsedIds(state);
  const series = input.recurrence
    ? createSeries(state, input, { createdAt, createId, energy, energyAuto })
    : null;
  const draft = series
    ? {
      ...buildOccurrence(series, {
        date: series.rule.anchorDate,
        now: createdAt,
        taskId: makeUniqueId(usedIds, createId, 'task'),
        stepId: () => makeUniqueId(usedIds, createId, 'step'),
        suggestedMin
      }),
      scheduledFor: input.scheduledFor || null,
      deadline: input.deadline || null,
      expiresAt: input.expiresAt || null
    }
    : createOneOffDraft(input, {
      createdAt,
      createId,
      energy,
      energyAuto,
      suggestedMin,
      usedIds
    });
  const task = normalizeTask(draft, {
    now: createdAt,
    index: state.tasks.length + state.archivedTasks.length,
    usedIds: new Set()
  });

  state.tasks.unshift(task);
  if (series) {
    series.openTaskId = task.id;
    series.lastOccurrenceDate = task.occurrenceDate;
    state.recurrenceSeries.push(series);
  }
  return { ok: true, task, series };
}

module.exports = { createTask };
