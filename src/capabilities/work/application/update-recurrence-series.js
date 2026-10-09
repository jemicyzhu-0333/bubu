'use strict';

const { runPostCommitEffect } = require('../../../shared/post-commit-effects');
const { updateSeries } = require('../domain/series-updating');

const UPDATE_RECURRENCE_SERIES_WRITES = Object.freeze(['tasks', 'recurrenceSeries']);

function createUpdateRecurrenceSeriesCommand({
  unitOfWork,
  clock,
  idFactory,
  publish = () => {},
  reportEffectError = () => {}
} = {}) {
  if (!unitOfWork || typeof unitOfWork.run !== 'function') {
    throw new TypeError('update-recurrence-series command requires a unit of work');
  }
  if (!clock || typeof clock.now !== 'function') {
    throw new TypeError('update-recurrence-series command requires a clock');
  }
  if (typeof idFactory !== 'function') {
    throw new TypeError('update-recurrence-series command requires an id factory');
  }
  if (typeof publish !== 'function' || typeof reportEffectError !== 'function') {
    throw new TypeError('update-recurrence-series command effects must be functions');
  }

  function execute({ seriesId, rule, seriesState, expectedRevision } = {}) {
    const updatedAt = clock.now();
    const transaction = unitOfWork.run({
      writes: UPDATE_RECURRENCE_SERIES_WRITES,
      expectedRevision,
      context: { now: updatedAt },
      transition: state => {
        const updated = updateSeries(
          state,
          { seriesId, rule, state: seriesState, now: updatedAt },
          { createId: idFactory }
        );
        if (!updated.ok) return updated;
        return {
          ok: true,
          seriesId: updated.series.id,
          nextOccurrenceId: updated.nextOccurrence
            ? updated.nextOccurrence.occurrence.id
            : null
        };
      }
    });

    if (!transaction.ok) return { ok: false, reason: transaction.reason };
    const series = transaction.state.recurrenceSeries.find(item => item.id === transaction.seriesId);
    const nextOccurrence = transaction.nextOccurrenceId
      ? transaction.state.tasks.find(task => task.id === transaction.nextOccurrenceId)
      : null;
    const nextOccurrenceDate = nextOccurrence ? nextOccurrence.occurrenceDate : null;
    if (transaction.committed) {
      const fact = Object.freeze({
        type: 'recurrence-series-updated',
        seriesId: transaction.seriesId,
        nextOccurrenceDate,
        updatedAt,
        revision: transaction.revision
      });
      runPostCommitEffect(publish, fact, reportEffectError);
    }
    return { ok: true, series, nextOccurrenceDate };
  }

  return Object.freeze({ execute });
}

module.exports = {
  UPDATE_RECURRENCE_SERIES_WRITES,
  createUpdateRecurrenceSeriesCommand
};
