'use strict';

const work = require('../../capabilities/work');
const execution = require('../../capabilities/execution');
const progress = require('../../capabilities/progress');
const companion = require('../../capabilities/companion');
const { runPostCommitEffect } = require('../../shared/post-commit-effects');
const { pick } = require('../state/undo-registry');

const COMPLETE_WORK_ITEM_WRITES = Object.freeze([
  'tasks',
  'recurrenceSeries',
  'nowTaskId',
  'focusSession',
  'xp',
  'level',
  'lastCompletedDate',
  'stats',
  'rewardLedger',
  'pet',
  'companion',
  'unlockedSkins'
]);

function createCompleteWorkItemWorkflow({
  unitOfWork,
  clock,
  idFactory,
  undo = null,
  synchronize = () => {},
  publish = () => {},
  reportEffectError = () => {}
} = {}) {
  if (!unitOfWork || typeof unitOfWork.run !== 'function') {
    throw new TypeError('complete-work-item workflow requires a unit of work');
  }
  if (!clock || typeof clock.now !== 'function') {
    throw new TypeError('complete-work-item workflow requires a clock');
  }
  if (typeof idFactory !== 'function') {
    throw new TypeError('complete-work-item workflow requires an id source');
  }
  if ([synchronize, publish, reportEffectError].some(effect => typeof effect !== 'function')) {
    throw new TypeError('complete-work-item workflow effects must be functions');
  }

  function execute({ taskId, confirmUnfinishedSteps = false, expectedRevision } = {}) {
    const completedAt = clock.now();
    let prior = null;
    const transaction = unitOfWork.run({
      writes: COMPLETE_WORK_ITEM_WRITES,
      expectedRevision,
      context: { now: completedAt },
      transition: state => {
        prior = structuredClone(pick(state, COMPLETE_WORK_ITEM_WRITES));
        const rewardDay = progress.taskCompletion.rewardDayFor(state, completedAt);
        const completion = work.taskCompletion.completeTask(state, {
          id: taskId,
          confirmUnfinishedSteps,
          now: completedAt,
          referenceDay: rewardDay
        }, { createId: idFactory });
        if (!completion.ok) return completion;

        const executionResult = execution.taskCompletion.reconcileCompletedTask(state, {
          taskId: completion.task.id,
          now: completedAt
        });
        const { reward } = progress.taskCompletion.recordTaskCompletion(
          state,
          completion.task,
          { now: completedAt, rewardDay }
        );
        const benefits = reward.recorded
          ? companion.completionBenefits.applyTaskCompletionBenefits(state, {
              now: completedAt
            })
          : { foodDrop: null, bond: null };
        const growth = companion.completionBenefits.applyGrowthBenefits(state, { reward, now: completedAt });
        const newlyUnlockedSkins = companion.completionBenefits.unlockEligibleSkins(state);
        return {
          ok: true,
          taskId: completion.task.id,
          stepCount: Array.isArray(completion.task.steps) ? completion.task.steps.length : 0,
          // hadFocus is true only when an active focus session on THIS task was
          // paused by the completion (reconcileCompletedTask). Earlier, already
          // ended focus still shows as session.segment events on the timeline.
          hadFocus: Boolean(executionResult.paused || executionResult.due),
          nextOccurrenceDate: completion.nextOccurrence
            ? completion.nextOccurrence.occurrence.occurrenceDate
            : null,
          reward,
          foodDrop: benefits.foodDrop,
          bond: growth.bond || benefits.bond,
          ticketsGranted: growth.ticketsGranted,
          newlyUnlockedSkins,
          sessionPaused: executionResult.paused,
          sessionDue: executionResult.due
        };
      }
    });

    if (!transaction.ok) {
      return {
        ok: false,
        reason: transaction.reason,
        unfinishedCount: transaction.unfinishedCount || 0
      };
    }

    const fact = Object.freeze({
      type: 'work-item-completed',
      taskId: transaction.taskId,
      completedAt,
      stepCount: transaction.stepCount,
      hadFocus: transaction.hadFocus,
      revision: transaction.revision,
      nextOccurrenceDate: transaction.nextOccurrenceDate,
      reward: transaction.reward,
      foodDrop: transaction.foodDrop,
      bond: transaction.bond,
      ticketsGranted: transaction.ticketsGranted,
      newlyUnlockedSkins: Object.freeze([...transaction.newlyUnlockedSkins]),
      sessionPaused: transaction.sessionPaused,
      sessionDue: transaction.sessionDue,
      session: transaction.state.focusSession
    });
    if (fact.sessionPaused) runPostCommitEffect(synchronize, fact, reportEffectError);
    runPostCommitEffect(publish, fact, reportEffectError);
    // 撤销凭据：只给“安静”的完成——没有升级、没有解锁皮肤、没有羁绊阶段变化、没有动到正在走的专注。
    // 那几种情况的通知、庆祝和计时状态已经对外发生了，回滚状态只会让界面自相矛盾。
    const quiet = !fact.sessionPaused && !fact.sessionDue
      && !(fact.reward && fact.reward.leveledUp)
      && fact.newlyUnlockedSkins.length === 0
      && !(fact.bond && fact.bond.stageChanged);
    const ticket = undo && quiet
      ? undo.capture({
        kind: 'task-complete',
        subject: fact.taskId,
        paths: transaction.changedPaths,
        before: prior,
        after: transaction.state,
        meta: { taskId: fact.taskId, completedAt }
      })
      : null;
    return ticket
      ? { ok: true, done: true, nextOccurrenceDate: fact.nextOccurrenceDate, undo: ticket }
      : { ok: true, done: true, nextOccurrenceDate: fact.nextOccurrenceDate };
  }

  return Object.freeze({ execute });
}

module.exports = { COMPLETE_WORK_ITEM_WRITES, createCompleteWorkItemWorkflow };
