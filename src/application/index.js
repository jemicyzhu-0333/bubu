'use strict';

const { createUnitOfWork } = require('./state/unit-of-work');
const { ENERGY_BANDS, inferEnergy, suggestDuration } = require('./queries/energy-compatibility');
const {
  ACCEPT_HEALTHY_SHUTDOWN_WRITES,
  createAcceptHealthyShutdownWorkflow
} = require('./workflows/accept-healthy-shutdown');
const {
  ARCHIVE_WORK_ITEM_WRITES,
  createArchiveWorkItemWorkflow
} = require('./workflows/archive-work-item');
const {
  CLARIFY_WORK_ITEM_WRITES,
  createClarifyWorkItemWorkflow
} = require('./workflows/clarify-work-item');
const {
  COMPLETE_DUE_SESSION_WRITES,
  createCompleteDueSessionWorkflow
} = require('./workflows/complete-due-session');
const {
  CREATE_WORK_ITEM_WRITES,
  createWorkItemDraft,
  createWorkItemWorkflow
} = require('./workflows/create-work-item');
const {
  EXPIRE_WORK_ITEMS_WRITES,
  createExpireWorkItemsWorkflow
} = require('./workflows/expire-work-items');
const {
  RESOLVE_FOCUS_LANDING_WRITES,
  createResolveFocusLandingWorkflow
} = require('./workflows/resolve-focus-landing');
const {
  RESOLVE_IMPULSE_WRITES,
  createResolveImpulseWorkflow
} = require('./workflows/resolve-impulse');
const {
  RESOLVE_QUICK_START_WRITES,
  createResolveQuickStartWorkflow
} = require('./workflows/resolve-quick-start');
const {
  RESUME_FOCUS_SESSION_WRITES,
  createResumeFocusSessionWorkflow
} = require('./workflows/resume-focus-session');
const {
  RUN_DAILY_RESET_WRITES,
  createRunDailyResetWorkflow
} = require('./workflows/run-daily-reset');
const {
  START_FOCUS_SESSION_WRITES,
  createStartFocusSessionWorkflow
} = require('./workflows/start-focus-session');
const {
  STOP_FOCUS_SESSION_WRITES,
  createStopFocusSessionWorkflow
} = require('./workflows/stop-focus-session');
const {
  ADJUST_FOCUS_DURATION_WRITES,
  createAdjustFocusDurationWorkflow
} = require('./workflows/adjust-focus-duration');
const {
  COMPLETE_WORK_ITEM_WRITES,
  createCompleteWorkItemWorkflow
} = require('./workflows/complete-work-item');
const { SELECT_NOW_WRITES, createSelectNowWorkflow } = require('./workflows/select-now');
const {
  SETTLE_FOCUS_SESSION_WRITES,
  createSettleFocusSessionWorkflow
} = require('./workflows/settle-focus-session');
const {
  COMPLETE_WORK_STEP_WRITES,
  createCompleteWorkStepWorkflow
} = require('./workflows/complete-work-step');
const {
  SKIP_WORK_OCCURRENCE_WRITES,
  createSkipWorkOccurrenceWorkflow
} = require('./workflows/skip-work-occurrence');
const {
  UPDATE_WORK_ITEM_WRITES,
  createUpdateWorkItemWorkflow
} = require('./workflows/update-work-item');
const {
  RESOLVE_REVIEW_WRITES,
  createResolveReviewWorkflow
} = require('./workflows/resolve-review');
const {
  FEED_COMPANION_WRITES,
  createFeedCompanionWorkflow
} = require('./workflows/feed-companion');
const {
  RECORD_TASK_AVOIDANCE_WRITES,
  createRecordTaskAvoidanceWorkflow
} = require('./workflows/record-task-avoidance');
const {
  RECORD_COMPANION_INTERACTION_WRITES,
  createRecordCompanionInteractionWorkflow
} = require('./workflows/record-companion-interaction');
const {
  BUY_COMPANION_FOOD_WRITES,
  createBuyCompanionFoodWorkflow
} = require('./workflows/buy-companion-food');
const { createRoutineTimelineEffects } = require('./effects/routine-timeline-effects');
const {
  ANALYZE_IMPULSE_ENERGY_WRITES,
  createAnalyzeImpulseEnergyWorkflow
} = require('./workflows/analyze-impulse-energy');
const { createTriageCaptureWorkflow } = require('./workflows/triage-capture');
const wellbeing = require('./workflows/wellbeing');

module.exports = Object.freeze({
  ...require('./workflows/update-preferences'),
  ...require('./workflows/start-break-session'),
  ...require('./workflows/advance-meal-care'),
  ...require('./workflows/resolve-meal-decision'),
  ...require('./queries/companion-feed-state'),
  ...require('./workflows/apply-ai-change-set'),
  ...require('./workflows/acknowledge-ai-change-delivery'),
  ...require('./queries/popover-state'),
  ...require('./queries/surface-read-composition'),
  ...require('./queries/pet-context'),
  ...require('./queries/timeline-day'),
  ...require('./effects/inbox-timeline-effects'),
  ...require('./queries/inbox-history'),
  ...require('./workflows/organize-inbox'),
  ...require('./workflows/archive-inbox-records'),
  ...require('./workflows/delete-inbox-record'),
  // 只放 predictModelLevelAt:buildEnergyCurveView 是 popover-state 的内部件,
  // 校准需要的只是「那一刻模型说多少」。
  predictModelLevelAt: require('./queries/energy-curve-view').predictModelLevelAt,
  currentEnergyLevelAt: require('./queries/energy-curve-view').currentEnergyLevelAt,
  ...require('./workflows/apply-guidance-proposal'),
  createUnitOfWork,
  ProposalStore: require('./ai/proposal-store').ProposalStore,
  ENERGY_BANDS,
  inferEnergy,
  suggestDuration,
  ACCEPT_HEALTHY_SHUTDOWN_WRITES,
  createAcceptHealthyShutdownWorkflow,
  ARCHIVE_WORK_ITEM_WRITES,
  createArchiveWorkItemWorkflow,
  CLARIFY_WORK_ITEM_WRITES,
  createClarifyWorkItemWorkflow,
  COMPLETE_DUE_SESSION_WRITES,
  createCompleteDueSessionWorkflow,
  CREATE_WORK_ITEM_WRITES,
  createWorkItemDraft,
  createWorkItemWorkflow,
  EXPIRE_WORK_ITEMS_WRITES,
  createExpireWorkItemsWorkflow,
  RESOLVE_FOCUS_LANDING_WRITES,
  createResolveFocusLandingWorkflow,
  RESOLVE_IMPULSE_WRITES,
  createResolveImpulseWorkflow,
  RESOLVE_QUICK_START_WRITES,
  createResolveQuickStartWorkflow,
  RESUME_FOCUS_SESSION_WRITES,
  createResumeFocusSessionWorkflow,
  RUN_DAILY_RESET_WRITES,
  createRunDailyResetWorkflow,
  START_FOCUS_SESSION_WRITES,
  createStartFocusSessionWorkflow,
  STOP_FOCUS_SESSION_WRITES,
  createStopFocusSessionWorkflow,
  ADJUST_FOCUS_DURATION_WRITES,
  createAdjustFocusDurationWorkflow,
  COMPLETE_WORK_ITEM_WRITES,
  createCompleteWorkItemWorkflow,
  SELECT_NOW_WRITES,
  createSelectNowWorkflow,
  SETTLE_FOCUS_SESSION_WRITES,
  createSettleFocusSessionWorkflow,
  COMPLETE_WORK_STEP_WRITES,
  createCompleteWorkStepWorkflow,
  SKIP_WORK_OCCURRENCE_WRITES,
  createSkipWorkOccurrenceWorkflow,
  UPDATE_WORK_ITEM_WRITES,
  createUpdateWorkItemWorkflow,
  RESOLVE_REVIEW_WRITES,
  createResolveReviewWorkflow,
  FEED_COMPANION_WRITES,
  createFeedCompanionWorkflow,
  RECORD_TASK_AVOIDANCE_WRITES,
  createRecordTaskAvoidanceWorkflow,
  RECORD_COMPANION_INTERACTION_WRITES,
  createRecordCompanionInteractionWorkflow,
  BUY_COMPANION_FOOD_WRITES,
  createBuyCompanionFoodWorkflow,
  createRoutineTimelineEffects,
  ANALYZE_IMPULSE_ENERGY_WRITES,
  createAnalyzeImpulseEnergyWorkflow,
  createTriageCaptureWorkflow,
  ...wellbeing
});
