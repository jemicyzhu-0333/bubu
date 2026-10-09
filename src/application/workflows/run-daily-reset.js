'use strict';

const work = require('../../capabilities/work');
const execution = require('../../capabilities/execution');
const appMaintenance = require('../../capabilities/app-maintenance');
const guidance = require('../../capabilities/guidance');
const routines = require('../../capabilities/routines');
const { runPostCommitEffect } = require('../../shared/post-commit-effects');

const RUN_DAILY_RESET_WRITES = Object.freeze([
  'tasks',
  'archivedTasks',
  'recurrenceSeries',
  'nowTaskId',
  'lastResetDate',
  // ARCHITECTURE「日常与能量」 rides along here rather than on a timer of its own: the two things that
  // happen once per local day are the day turning and the curve learning from that
  // day, and a second scheduler would eventually disagree with this one about when
  // "today" started.
  'routineLog',
  'energyProfile'
]);

const ARCHIVE_REASON = 'expired-unreviewed';

/**
 * The local-day pass: one commit that recounts slipped deadlines, tidies
 * long-untouched expiring work into recoverable history, catches recurring work
 * up to today, flags newly expired work, and advances the day marker.
 *
 * It is one transition on purpose. Splitting it would let a crash land the app
 * on a half-turned day — a marker moved with no tidy done, or work archived
 * that the next launch would archive again.
 */
function createRunDailyResetWorkflow({
  unitOfWork,
  clock,
  idFactory,
  energyModel = null,
  publish = () => {},
  reportEffectError = () => {}
} = {}) {
  if (!unitOfWork || typeof unitOfWork.run !== 'function') {
    throw new TypeError('run-daily-reset workflow requires a unit of work');
  }
  if (!clock || typeof clock.now !== 'function' || typeof clock.dayKey !== 'function') {
    throw new TypeError('run-daily-reset workflow requires a clock with now and dayKey');
  }
  if (typeof idFactory !== 'function') {
    throw new TypeError('run-daily-reset workflow requires an id factory');
  }
  // Optional on purpose: the model reader is a projection of three capabilities'
  // state, and a day pass with no reader wired still has to turn the day. Left out,
  // calibration is skipped and nothing else about the pass changes.
  if (energyModel !== null && typeof energyModel.predict !== 'function') {
    throw new TypeError('run-daily-reset workflow energy model requires a predict function');
  }
  if (typeof publish !== 'function' || typeof reportEffectError !== 'function') {
    throw new TypeError('run-daily-reset workflow effects must be functions');
  }

  // ARCHITECTURE「日常与能量」 folds yesterday's self-report into the curve's shape, then drops the log
  // days the curve can no longer use. The order matters: the prediction has to see
  // the log exactly as the user's day had it, and rolling first could delete the very
  // day the report needs to be explained.
  function learnFromYesterday(state, { resetAt, today }) {
    let calibration = null;
    if (energyModel) {
      const checkIn = state.energyCheckIn;
      if (checkIn && Number.isFinite(checkIn.timestamp)) {
        const prediction = energyModel.predict(state, {
          at: checkIn.timestamp,
          dayKey: clock.dayKey(checkIn.timestamp)
        }) || {};
        calibration = guidance.energyCalibration.calibrateEnergyProfile(state, {
          now: resetAt,
          modelLevel: prediction.modelLevel,
          effects: prediction.effects,
          baselineSeed: prediction.baselineSeed,
          checkInMinute: prediction.minuteOfDay
        });
      }
    }
    const rolled = routines.routineLogging.rollLogForward(state, { today });
    return { calibration, rolled };
  }

  function execute({ expectedRevision } = {}) {
    const resetAt = clock.now();
    const today = clock.dayKey(resetAt);
    const transaction = unitOfWork.run({
      writes: RUN_DAILY_RESET_WRITES,
      expectedRevision,
      context: { now: resetAt },
      transition: state => {
        const plan = appMaintenance.dailyMarker.planLocalDayPass(state, { today });
        if (!plan.ok) {
          if (plan.reason !== 'day-already-reset') return plan;
          const refreshed = work.seriesRefresh.refreshSeriesOccurrences(
            state, { now: resetAt, today }, { createId: idFactory }
          );
          if (!refreshed.generatedTaskIds.length && !refreshed.rolledTaskIds.length) return plan;
          return {
            ok: true, mode: 'catch-up', archivedTaskIds: [],
            generatedTaskIds: refreshed.generatedTaskIds,
            expiredTaskIds: [], clearedNowTaskId: null,
            calibration: null, droppedRoutineDayKeys: []
          };
        }

        const archivedTaskIds = [];
        const generatedTaskIds = [];
        // A first-ever pass records the day and nothing else: there is no
        // measured absence to catch up on, and archiving on first launch would
        // be a surprise rather than a service.
        if (plan.mode === 'advance') {
          work.dailyTidy.recountOverdueDays(state, resetAt);
          const stale = work.dailyTidy.selectStaleExpiringTasks(state, {
            now: resetAt,
            protectedTaskIds: execution.taskLinkage.pendingHandoffTaskIds(state)
          });
          for (const taskId of stale.taskIds) {
            const archived = work.taskArchiving.archiveTask(state, {
              taskId,
              reason: ARCHIVE_REASON,
              now: resetAt
            });
            if (!archived.ok) continue;
            execution.taskLinkage.clearNowTask(state, taskId);
            archivedTaskIds.push(taskId);
          }
          if (state.nowTaskId && !work.taskState.findTask(state, state.nowTaskId)) {
            state.nowTaskId = null;
          }
          const refreshed = work.seriesRefresh.refreshSeriesOccurrences(
            state,
            { now: resetAt, today },
            { createId: idFactory }
          );
          generatedTaskIds.push(...refreshed.generatedTaskIds);
        }

        // Expiry rides along in the same transition so the day never lands
        // half-turned. The standalone expire-work-items workflow still serves
        // the periodic and startup checks.
        const expiration = work.taskExpiration.expireDueTasks(state, resetAt);
        const currentNowTaskId = state.nowTaskId;
        const nowTask = work.taskState.findTask(state, currentNowTaskId);
        const blocked = currentNowTaskId
          ? work.availability.taskStartBlockReason(nowTask, resetAt)
          : null;
        if (blocked) execution.taskLinkage.clearNowTask(state, currentNowTaskId);

        // Only on the path that actually turns the day. The catch-up branch above
        // returns before here, so a day already turned never re-calibrates — the
        // `updatedAt` watermark inside `calibrateEnergyProfile` is the second line of
        // defence, not the first.
        const learned = learnFromYesterday(state, { resetAt, today });

        const marked = appMaintenance.dailyMarker.markLocalDayPassed(state, today);
        if (!marked.ok) return marked;

        return {
          ok: true,
          mode: plan.mode,
          archivedTaskIds,
          generatedTaskIds,
          expiredTaskIds: expiration.expiredTaskIds,
          clearedNowTaskId: blocked ? currentNowTaskId : null,
          calibration: learned.calibration,
          droppedRoutineDayKeys: learned.rolled.droppedDayKeys
        };
      }
    });

    if (!transaction.ok) return { ok: false, reason: transaction.reason };
    const calibration = transaction.calibration || null;
    const response = {
      ok: true,
      mode: transaction.mode,
      dayKey: today,
      archivedCount: transaction.archivedTaskIds.length,
      // `null` when nothing was learned, and otherwise the domain's own report —
      // `adjusted` names the one parameter that moved and what it moved from. A
      // model that tunes itself invisibly is a model nobody can debug.
      calibration
    };
    if (!transaction.committed) return response;

    const fact = Object.freeze({
      type: 'local-day-reset',
      dayKey: today,
      mode: transaction.mode,
      archivedTaskIds: Object.freeze([...transaction.archivedTaskIds]),
      generatedTaskIds: Object.freeze([...transaction.generatedTaskIds]),
      expiredTaskIds: Object.freeze([...transaction.expiredTaskIds]),
      clearedNowTaskId: transaction.clearedNowTaskId,
      // Subscribers redraw the curve off this: the profile moved, so the panel's
      // sparkline and its confidence badge are both stale.
      energyProfileChanged: Boolean(calibration && calibration.changed),
      // ARCHITECTURE「日常与能量」's two numbers, carried on the fact rather than read back off
      // `execute()`'s response: the timeline event may only be written after the
      // commit succeeded, and the response is also returned on the path where
      // nothing was committed at all.
      energyCalibration: calibration && calibration.changed
        ? Object.freeze({
          observations: calibration.observations,
          mae: calibration.lastResidualMae
        })
        : null,
      droppedRoutineDayKeys: Object.freeze([...(transaction.droppedRoutineDayKeys || [])]),
      resetAt,
      revision: transaction.revision
    });
    runPostCommitEffect(publish, fact, reportEffectError);
    return response;
  }

  return Object.freeze({ execute });
}

module.exports = { RUN_DAILY_RESET_WRITES, createRunDailyResetWorkflow };
