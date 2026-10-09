'use strict';

const { isDeepStrictEqual } = require('node:util');

const { focusSession } = require('../../capabilities/execution');
const { normalizeFocusSession } = focusSession;
const {
  normalizeRewardLedger,
  backfillLegacyStepBudgets,
  seedLegacyCompletionRewardIds
} = require('../../core/reward-ledger');
const { ID_PATTERN, normalizeCompanionState } = require('../../core/companion-state');
const { normalizeEnergySignals } = require('../../core/energy-signal');
const { normalizeWakeTimes, normalizeMoodNotes } = require('../../core/wellbeing');
const {
  isPlainObject,
  numberInRange,
  nonNegativeInteger,
  trimmedString,
  validDayKey,
  validIsoOrNull,
  timestampOrNull,
  uniqueNormalizedId
} = require('../../core/field-normalizers');
const { taskModel, inboxRecords } = require('../../capabilities/work');
const { aiChangeLedger, planningState } = require('../../capabilities/guidance');
const {
  ENERGY_LEVELS,
  ESTIMATE_SOURCES,
  RECURRENCE_FREQUENCIES,
  RECURRENCE_STRATEGIES,
  SERIES_STATES,
  EDIT_SCOPES,
  LIMITS,
  normalizeTask,
  normalizeRecurrenceSeries,
  assertTaskModelInvariants
} = taskModel;
const {
  MAX_MIGRATION_NOTICES,
  migrationBusinessDay,
  migrateTaskModel,
  migrateFocusMinutes
} = require('../../core/schema8-migration');
const { FOOD_IDS, PET_STATES, mealRhythm, foodCommand, skinAvailability } = require('../../capabilities/companion');
// Routines, their occurrence log and the energy calibration profile normalize in
// a sibling module: their rule is reject-rather-than-clamp, which is the opposite
// of the task model's, and keeping the two rules in one file is how one gets
// applied by mistake. Composed into `normalizePersistedState` and re-exported
// below, so callers see no difference.
const {
  MAX_ROUTINES,
  MAX_ROUTINE_LOG_DAYS,
  MAX_ROUTINE_ENTRIES_PER_DAY,
  MAX_ROUTINE_NOTE,
  MIN_EFFECT_SCALE,
  MAX_EFFECT_SCALE,
  MAX_EFFECT_SCALE_KEYS,
  normalizeRoutines,
  normalizeRoutineLog,
  normalizeEnergyProfile
} = require('./routine-schema');

// Schema 8 replaced the mutually exclusive `category` with orthogonal task
// attributes, added recurrence series, narrowed the focus range to 5–120 minutes
// and reserved the persisted slots for ADHD strategy feedback and daily reviews.
//
// Schema 9 opened the slots for worn companion accessories,
// routines with their two-day occurrence log, the personal energy calibration
// profile, and the quick panel / timeline / AI switches under `settings`. They
// land in one version bump on purpose — shipping them per feature would mean
// five migrations over the same user data, and every migration is a chance to
// lose some of it. "Reserving a slot" here means the shape is final and fully
// validated now, even where no writer exists yet; a field that shipped as a
// pass-through would need a second bump the day it gained a real shape.
// Schema 10 adds one bounded guidance-owned list: AI-derived energy corrections
// linked to their source impulse by id. The private impulse text is deliberately
// not copied. This is a real shape change, so it uses the normal verified
// schema-N-to-10 backup path rather than a permissive same-schema repair.
// Schema 11 adds two small guidance-owned records: the wake time the person reported
// for a day (so the energy baseline starts from when they actually got up) and the
// private mood notes they explicitly chose to keep from the inbox. Both are bounded,
// local-only and never sent to a model; see core/wellbeing.js.
// Schema 12 removes the consecutive-day counter (`streak`, `stats.longestStreak`): a number that
// resets to zero after one missed day is pressure, not progress. What replaced it is derived, not
// stored — how many of the last 30 days were used, from the daily stats (core/active-days.js).
// `lastCompletedDate` stays: it is the monotonic reward-day guard, not a streak.
// Schema 14 retains explicitly resolved captures and user-confirmed categories.
// Schema 15 adds settings.activityMirrorEnabled (default false).
// Schema 16 adds the guidance-owned atomic AI receipt and durable outbox ledger.
// Schema18 is a fresh-profile foundation, never an implicit pre18 migration.
const PERSISTED_SCHEMA_VERSION = 18;
// The schema at which tasks became orthogonal (tags / description / estimate
// instead of one mutually exclusive `category`). The task-model migration is
// keyed on *this* number rather than on "is not the current version": from
// schema 9 onward a schema-8 file is no longer current, but its tasks and
// recurrence series are already in today's shape. Re-running the migration over
// them would rebuild `recurrenceSeries` by looking for a `category` field that
// no longer exists — i.e. silently delete every repeating task the user has.
const ORTHOGONAL_TASK_MODEL_SCHEMA = 8;
const REVIEW_KINDS = Object.freeze(['closeout', 'startup']);
const REVIEW_STATUSES = Object.freeze(['pending', 'done', 'dismissed']);
const {
  AI_MODEL_PATTERN,
  MAX_AI_URL_INPUT_LENGTH,
  MAX_AI_CANONICAL_URL_LENGTH,
  DEFAULT_SETTINGS,
  baseUrlFromEndpoint,
  isHttpsEndpoint,
  normalizeSettings
} = require('../../capabilities/preferences');

const MAX_RECURRENCE_SERIES = LIMITS.SERIES;
const MAX_STRATEGY_FEEDBACK_KEYS = 200;
const MAX_PENDING_REVIEWS = 14;
const DEFAULT_PET = Object.freeze({
  satiation: 65,
  foodInventory: Object.freeze({
    fish: 0, bone: 0, donut: 0, coffee: 0, carrot: 0, mushroom: 0,
    rice: 0, milk: 0, berry: 2, cake: 0
  }),
  foodTickets: 6,
  lastTicketDay: null,
  foodCommands: Object.freeze([]),
  care: Object.freeze({ ...mealRhythm.defaultMealCare(), meals: Object.freeze([]) }),
  totalFeeds: 0
});

function normalizeRecurrenceSeriesList(raw, options = {}) {
  if (!Array.isArray(raw)) return [];
  const usedIds = new Set();
  const series = raw
    .filter(isPlainObject)
    .map((item, index) => normalizeRecurrenceSeries(item, { ...options, index, usedIds }));
  if (series.length > MAX_RECURRENCE_SERIES) {
    throw new RangeError(`bubu data holds more than ${MAX_RECURRENCE_SERIES} recurrence series`);
  }
  return series;
}

// Strategy feedback is a local preference signal only: it changes which
// suggestions come back and how often, and never leaves the device.
function normalizeStrategyFeedback(raw) {
  if (!isPlainObject(raw)) return {};
  const entries = [];
  for (const [rawId, rawValue] of Object.entries(raw)) {
    if (typeof rawId !== 'string' || !ID_PATTERN.test(rawId) || !isPlainObject(rawValue)) continue;
    entries.push([rawId, {
      helpful: typeof rawValue.helpful === 'boolean' ? rawValue.helpful : null,
      updatedAt: timestampOrNull(rawValue.updatedAt),
      shownCount: nonNegativeInteger(rawValue.shownCount, 0, 1000000),
      dismissedCount: nonNegativeInteger(rawValue.dismissedCount, 0, 1000000)
    }]);
  }
  if (entries.length > MAX_STRATEGY_FEEDBACK_KEYS) {
    throw new RangeError(`bubu data holds more than ${MAX_STRATEGY_FEEDBACK_KEYS} strategy feedback entries`);
  }
  entries.sort(([left], [right]) => left.localeCompare(right));
  return Object.fromEntries(entries);
}

// A review card is idempotent by construction: `review:<kind>:<dayKey>` means a
// missed trigger or a second attempt can never stack two prompts for one day.
function normalizeReviews(raw) {
  const source = isPlainObject(raw) ? raw : {};
  const seen = new Set();
  const pending = (Array.isArray(source.pending) ? source.pending : [])
    .filter(isPlainObject)
    .map(entry => {
      const kind = REVIEW_KINDS.includes(entry.kind) ? entry.kind : null;
      const dayKey = validDayKey(entry.dayKey);
      if (!kind || !dayKey) return null;
      return {
        id: `review:${kind}:${dayKey}`,
        kind,
        dayKey,
        createdAt: timestampOrNull(entry.createdAt),
        status: REVIEW_STATUSES.includes(entry.status) ? entry.status : 'pending',
        progress: nonNegativeInteger(entry.progress, 0, 100)
      };
    })
    .filter(entry => {
      if (!entry || seen.has(entry.id)) return false;
      seen.add(entry.id);
      return true;
    })
    .sort((left, right) => Number(left.createdAt || 0) - Number(right.createdAt || 0)
      || left.id.localeCompare(right.id))
    .slice(-MAX_PENDING_REVIEWS);
  return { pending };
}

function normalizeMigrationNotices(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  return raw
    .filter(isPlainObject)
    .map(entry => {
      const id = trimmedString(entry.id, null, 120);
      const kind = trimmedString(entry.kind, null, 60);
      if (!id || !kind) return null;
      return {
        id,
        kind,
        createdAt: timestampOrNull(entry.createdAt),
        payload: isPlainObject(entry.payload) ? { ...entry.payload } : {}
      };
    })
    .filter(entry => {
      if (!entry || seen.has(entry.id)) return false;
      seen.add(entry.id);
      return true;
    })
    .sort((left, right) => left.id.localeCompare(right.id))
    .slice(0, MAX_MIGRATION_NOTICES);
}

function petCount(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw new TypeError('invalid-pet-count');
  return value;
}

function normalizePet(raw) {
  const source = isPlainObject(raw) ? raw : {};
  const sourceInventory = isPlainObject(source.foodInventory) ? source.foodInventory : {};
  const foodInventory = {};
  for (const foodId of FOOD_IDS.filter(id => id !== 'basic')) {
    foodInventory[foodId] = petCount(sourceInventory[foodId], DEFAULT_PET.foodInventory[foodId], 999);
  }
  return {
    satiation: numberInRange(source.satiation, DEFAULT_PET.satiation, 0, 100),
    foodInventory,
    foodTickets: petCount(source.foodTickets, DEFAULT_PET.foodTickets),
    lastTicketDay: validDayKey(source.lastTicketDay),
    foodCommands: foodCommand.normalizeFoodReceipts(source.foodCommands),
    care: mealRhythm.normalizeMealCare(source.care),
    totalFeeds: petCount(source.totalFeeds, DEFAULT_PET.totalFeeds)
  };
}

function normalizeDailyMap(raw) {
  const result = {};
  if (!isPlainObject(raw)) return result;
  for (const [key, value] of Object.entries(raw)) {
    if (validDayKey(key)) result[key] = nonNegativeInteger(value, 0);
  }
  return result;
}

function normalizeStats(raw) {
  const source = isPlainObject(raw) ? raw : {};
  const dailyFocus = normalizeDailyMap(source.dailyFocus);
  const penaltyEvents = Array.isArray(source.penaltyEvents)
    ? source.penaltyEvents.slice(-30).filter(isPlainObject).map(event => ({
      date: validDayKey(event.date),
      xpLost: nonNegativeInteger(event.xpLost, 0),
      reasons: Array.isArray(event.reasons)
        ? event.reasons.filter(value => typeof value === 'string').map(value => value.slice(0, 500)).slice(0, 100)
        : []
    })).filter(event => event.date)
    : [];
  return {
    totalFocusMs: nonNegativeInteger(source.totalFocusMs, 0),
    totalPomodoros: nonNegativeInteger(source.totalPomodoros, 0),
    totalTasksDone: nonNegativeInteger(source.totalTasksDone, 0),
    totalBreakdowns: nonNegativeInteger(source.totalBreakdowns, 0),
    dailyFocus,
    dailyCompletions: normalizeDailyMap(source.dailyCompletions),
    dailyLaunches: normalizeDailyMap(source.dailyLaunches),
    dailyReturns: normalizeDailyMap(source.dailyReturns),
    healthyShutdownCount: nonNegativeInteger(source.healthyShutdownCount, 0),
    healthyShutdownStreak: nonNegativeInteger(source.healthyShutdownStreak, 0),
    lastHealthyShutdownDate: validDayKey(source.lastHealthyShutdownDate),
    penaltyEvents
  };
}

function normalizeEnergyCheckIn(raw) {
  if (!isPlainObject(raw)) return null;
  const level = numberInRange(raw.level, Number.NaN, 10, 90, true);
  const timestamp = timestampOrNull(raw.timestamp ?? raw.checkedAt ?? raw.createdAt);
  if (!Number.isFinite(level) || timestamp === null) return null;
  const state = ENERGY_LEVELS.includes(raw.state)
    ? raw.state
    : level < 35 ? 'low' : level < 65 ? 'medium' : 'high';
  return { level, state, timestamp };
}

function normalizeQuickStartDecision(raw) {
  if (!isPlainObject(raw)) return null;
  const sessionId = trimmedString(raw.sessionId, null, 200);
  const status = ['pending', 'done', 'extend-8', 'full-session'].includes(raw.status) ? raw.status : null;
  if (!sessionId || !status) return null;
  return {
    sessionId,
    taskId: trimmedString(raw.taskId, null, 200),
    completedAt: timestampOrNull(raw.completedAt),
    elapsedMs: nonNegativeInteger(raw.elapsedMs, 0, 24 * 60 * 60 * 1000),
    status,
    resolvedAt: timestampOrNull(raw.resolvedAt)
  };
}

function normalizeFocusLandingPrompt(raw) {
  if (!isPlainObject(raw) || raw.status !== 'pending') return null;
  const sessionId = trimmedString(raw.sessionId, null, 200);
  const taskId = trimmedString(raw.taskId, null, 200);
  const completedAt = timestampOrNull(raw.completedAt);
  if (!sessionId || completedAt === null || (taskId === null && raw.taskId !== null)) return null;
  return {
    sessionId,
    taskId,
    completedAt,
    status: 'pending'
  };
}

function assertUniquePersistedIds(source) {
  const taskIds = new Set();
  for (const collectionName of ['tasks', 'archivedTasks']) {
    const collection = Array.isArray(source[collectionName]) ? source[collectionName] : [];
    for (const task of collection) {
      if (!isPlainObject(task)) continue;
      const taskId = trimmedString(task.id, null, 200);
      if (taskId) {
        if (taskIds.has(taskId)) throw new Error(`Duplicate persisted task id: ${taskId}`);
        taskIds.add(taskId);
      }
      const stepIds = new Set();
      for (const step of Array.isArray(task.steps) ? task.steps : []) {
        if (!isPlainObject(step)) continue;
        const stepId = trimmedString(step.id, null, 200);
        if (!stepId) continue;
        if (stepIds.has(stepId)) throw new Error(`Duplicate persisted step id in task ${taskId || '<legacy>'}: ${stepId}`);
        stepIds.add(stepId);
      }
    }
  }
  const seriesIds = new Set();
  for (const series of Array.isArray(source.recurrenceSeries) ? source.recurrenceSeries : []) {
    if (!isPlainObject(series)) continue;
    const seriesId = trimmedString(series.id, null, 200);
    if (!seriesId) continue;
    if (seriesIds.has(seriesId)) throw new Error(`Duplicate persisted recurrence series id: ${seriesId}`);
    seriesIds.add(seriesId);
  }
  const impulseIds = new Set();
  for (const impulse of Array.isArray(source.impulses) ? source.impulses : []) {
    if (!isPlainObject(impulse)) continue;
    const impulseId = trimmedString(impulse.id, null, 200);
    if (!impulseId) continue;
    if (impulseIds.has(impulseId)) throw new Error(`Duplicate persisted impulse id: ${impulseId}`);
    impulseIds.add(impulseId);
  }
}

function normalizePersistedState(raw, options = {}) {
  const source = isPlainObject(raw) ? raw : {};
  if (source.schemaVersion != null && (!Number.isSafeInteger(source.schemaVersion) || source.schemaVersion < 0)) {
    throw new TypeError('bubu data has an invalid schemaVersion');
  }
  if (source.schemaVersion > PERSISTED_SCHEMA_VERSION) {
    throw new RangeError('bubu data uses a future schemaVersion');
  }
  // Legacy stores are repaired below after a byte-for-byte backup is made.
  // A store already claiming the current schema must be losslessly valid:
  // duplicate identities there indicate corruption and must fail closed.
  if (source.schemaVersion === PERSISTED_SCHEMA_VERSION) assertUniquePersistedIds(source);
  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
  const persistedVersion = Number.isInteger(source.schemaVersion) ? source.schemaVersion : 0;
  // Two different questions, and conflating them is how a schema bump eats user
  // data. "Is this file not current?" decides how leniently it is read. "Does it
  // predate the orthogonal task model?" decides whether the schema-8 *shape*
  // migrations run — and those must not run on a schema-8 file, which is no
  // longer current but is already in today's task shape.
  //
  // Concretely: `migrateTaskModel` rebuilds `recurrenceSeries` from scratch by
  // looking for `legacy.category === 'daily'`, a field schema 8 no longer has, so
  // running it on a schema-8 store would return an empty list and delete every
  // recurring series the user has. It also overwrites `tags`, `description`,
  // `estimateMinutes`, `estimateSource` and `skippedAt` on every task.
  const predatesOrthogonalTaskModel = persistedVersion < ORTHOGONAL_TASK_MODEL_SCHEMA;
  // The migration day must be monotonic against the persisted markers, and it
  // must be the *same* day used to seed legacy reward identities: the schema-8
  // reward cycle is derived from `occurrenceDate`, so a mismatch would let an
  // already paid daily completion be paid a second time.
  const migrationDayKey = migrationBusinessDay(source, now);
  const impulseIds = new Set();
  const impulses = Array.isArray(source.impulses) ? source.impulses.filter(isPlainObject).map((impulse, index) => {
    const createdAt = timestampOrNull(impulse.createdAt) ?? now;
    return {
      ...impulse,
      id: uniqueNormalizedId(
        impulse.id,
        `recovered-impulse-${Math.round(createdAt)}-${index}`,
        impulseIds
      ),
      text: trimmedString(impulse.text, '未命名闪念', 500),
      createdAt,
      classification: persistedVersion < 14 ? null : inboxRecords.normalizeClassification(impulse.classification),
      resolution: persistedVersion < 14 ? null : inboxRecords.normalizeResolution(impulse.resolution)
    };
  }) : [];
  const unlockedSkins = Array.isArray(source.unlockedSkins)
    ? [...new Set(source.unlockedSkins.filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()))]
    : ['pink'];
  if (!unlockedSkins.includes('pink')) unlockedSkins.unshift('pink');

  const currentSkinCandidate = trimmedString(source.currentSkin, 'pink', 100);
  const migrated = predatesOrthogonalTaskModel
    ? migrateTaskModel(source, { now, migrationDayKey })
    : {
      tasks: Array.isArray(source.tasks) ? source.tasks.filter(isPlainObject) : [],
      archivedTasks: Array.isArray(source.archivedTasks) ? source.archivedTasks.filter(isPlainObject) : [],
      recurrenceSeries: source.recurrenceSeries
    };
  const taskIds = new Set();
  const tasks = migrated.tasks.map((task, index) => normalizeTask(task, { now, index, usedIds: taskIds }));
  const archivedTasks = migrated.archivedTasks.map((task, index) => (
    normalizeTask(task, { now, index: index + tasks.length, usedIds: taskIds })
  ));
  const recurrenceSeries = normalizeRecurrenceSeriesList(migrated.recurrenceSeries, {
    now,
    fallbackAnchorDate: migrationDayKey
  });
  // Narrowing the focus range landed *in* schema 8, so a schema-8 file already
  // satisfies it and re-running would only risk emitting a second notice.
  const focusMinutesMigration = predatesOrthogonalTaskModel
    ? migrateFocusMinutes(source.settings && source.settings.pomodoroMinutes, { now })
    : { minutes: source.settings && source.settings.pomodoroMinutes, notice: null };
  const settings = normalizeSettings(
    isPlainObject(source.settings)
      ? { ...source.settings, pomodoroMinutes: focusMinutesMigration.minutes }
      : source.settings
  );
  const migrationNotices = normalizeMigrationNotices(
    focusMinutesMigration.notice
      ? [...(Array.isArray(source.migrationNotices) ? source.migrationNotices : []), focusMinutesMigration.notice]
      : source.migrationNotices
  );
  const nowTaskCandidate = trimmedString(source.nowTaskId, null, 200);
  // A completed session owns its original identity even when its task is no
  // longer editable, archived or missing. Null is a genuine free-focus session.
  const focusLandingPrompt = normalizeFocusLandingPrompt(source.focusLandingPrompt);
  const normalizedRewardLedger = normalizeRewardLedger(source.rewardLedger, { maxEvents: 5000 });
  // The pre-ledger app already paid completed tasks/steps directly. When that
  // exact legacy shape is upgraded, preserve those historical identities so a
  // reopen/re-complete action cannot pay them again. An existing ledger is
  // authoritative even if empty, and current-schema data remains subject to
  // the strict byte-for-byte startup validation in main.js.
  const shouldSeedLegacyRewards = predatesOrthogonalTaskModel
    && !Object.prototype.hasOwnProperty.call(source, 'rewardLedger');
  let rewardLedger = shouldSeedLegacyRewards
    ? seedLegacyCompletionRewardIds(
        normalizedRewardLedger,
        [...tasks, ...archivedTasks],
        migrationDayKey,
        { maxEvents: 5000 }
      )
    : normalizedRewardLedger;
  // A schema-7 ledger can be perfectly authoritative for past event IDs and
  // totals while still lacking schema 8's new lifetime step-budget index.
  // Backfill only that index for every pre-8 store; never synthesize payout
  // identities when a ledger already exists. A schema-8 ledger already has the
  // index, and re-running could add a `<taskId>|lifetime` key that was not in
  // the file — making a perfectly good store read as non-canonical.
  if (predatesOrthogonalTaskModel && !shouldSeedLegacyRewards) {
    rewardLedger = backfillLegacyStepBudgets(
      rewardLedger,
      [...tasks, ...archivedTasks],
      migrationDayKey,
      { maxEvents: 5000 }
    );
  }
  assertTaskModelInvariants(tasks, recurrenceSeries);
  return {
    schemaVersion: PERSISTED_SCHEMA_VERSION,
    tasks,
    archivedTasks,
    recurrenceSeries,
    impulses,
    // Persisted normalization must not depend on the wall clock: otherwise a
    // clean current-schema file can become "non-canonical" merely by crossing
    // an expiry/appointment boundary while the app is closed. Runtime lifecycle
    // transactions decide whether the structurally valid Now task is actionable.
    nowTaskId: tasks.some(task => task.id === nowTaskCandidate && !task.done && !task.skippedAt)
      ? nowTaskCandidate
      : null,
    xp: nonNegativeInteger(source.xp, 0),
    level: numberInRange(source.level, 1, 1, 1000000, true),
    lastCompletedDate: validDayKey(source.lastCompletedDate),
    stats: normalizeStats(source.stats),
    unlockedSkins,
    currentSkin: skinAvailability.isSkinAvailable(currentSkinCandidate, unlockedSkins)
      ? currentSkinCandidate : 'pink',
    achievements: isPlainObject(source.achievements) ? { ...source.achievements } : {},
    lastResetDate: validDayKey(source.lastResetDate),
    lastWorkEndNotifyDate: validDayKey(source.lastWorkEndNotifyDate),
    settings,
    pet: normalizePet(source.pet),
    focusSession: normalizeFocusSession(source.focusSession, { now }),
    quickStartDecision: normalizeQuickStartDecision(source.quickStartDecision),
    focusLandingPrompt,
    planningPreferences: source.schemaVersion >= 17 || Object.hasOwn(source, 'planningPreferences')
      ? planningState.normalizePlanningPreferences(source.planningPreferences) : planningState.createPlanningPreferences(),
    energySelfReports: source.schemaVersion >= 17 || Object.hasOwn(source, 'energySelfReports')
      ? planningState.normalizeEnergySelfReports(source.energySelfReports) : planningState.createEnergySelfReports(),
    energyCurveTrials: source.schemaVersion >= 17 || Object.hasOwn(source, 'energyCurveTrials')
      ? planningState.normalizeEnergyCurveTrials(source.energyCurveTrials) : planningState.createEnergyCurveTrials(),
    aiCollaboration: source.schemaVersion >= 16 || Object.hasOwn(source, 'aiCollaboration')
      ? aiChangeLedger.normalizeLedger(source.aiCollaboration) : aiChangeLedger.createLedger(),
    energyCheckIn: normalizeEnergyCheckIn(source.energyCheckIn),
    energySignals: normalizeEnergySignals(source.energySignals),
    wakeTimes: normalizeWakeTimes(source.wakeTimes),
    moodNotes: normalizeMoodNotes(source.moodNotes),
    energyProfile: normalizeEnergyProfile(source.energyProfile),
    rewardLedger,
    strategyFeedback: normalizeStrategyFeedback(source.strategyFeedback),
    reviews: normalizeReviews(source.reviews),
    routines: normalizeRoutines(source.routines),
    routineLog: normalizeRoutineLog(source.routineLog),
    migrationNotices,
    companion: normalizeCompanionState(source.companion, {
      strict: source.schemaVersion === PERSISTED_SCHEMA_VERSION
    })
  };
}

// Production admission is deliberately independent of the adapter's configured
// normalizer. It validates a clone with the owning contracts, then compares the
// whole raw shape: missing/unknown keys and coercions are never startup repairs.
// A fixed clock only fills malformed legacy timestamps, which then fail equality.
function assertCanonicalPersistedState(raw) {
  if (!isPlainObject(raw) || raw.schemaVersion !== PERSISTED_SCHEMA_VERSION) {
    throw new TypeError('config-payload-current-schema-required');
  }
  const canonical = normalizePersistedState(structuredClone(raw), { now: 0 });
  if (!isDeepStrictEqual(raw, canonical)) throw new TypeError('config-payload-not-canonical');
  return raw;
}

module.exports = {
  PERSISTED_SCHEMA_VERSION,
  assertCanonicalPersistedState,
  ORTHOGONAL_TASK_MODEL_SCHEMA,
  ENERGY_LEVELS,
  ESTIMATE_SOURCES,
  RECURRENCE_FREQUENCIES,
  RECURRENCE_STRATEGIES,
  SERIES_STATES,
  EDIT_SCOPES,
  REVIEW_KINDS,
  REVIEW_STATUSES,
  AI_MODEL_PATTERN,
  MAX_AI_URL_INPUT_LENGTH,
  MAX_AI_CANONICAL_URL_LENGTH,
  baseUrlFromEndpoint,
  LIMITS,
  FOOD_IDS,
  PET_STATES,
  DEFAULT_SETTINGS,
  DEFAULT_PET,
  MAX_RECURRENCE_SERIES,
  MAX_STRATEGY_FEEDBACK_KEYS,
  MAX_PENDING_REVIEWS,
  MAX_ROUTINES,
  MAX_ROUTINE_LOG_DAYS,
  MAX_ROUTINE_ENTRIES_PER_DAY,
  MAX_ROUTINE_NOTE,
  MIN_EFFECT_SCALE,
  MAX_EFFECT_SCALE,
  MAX_EFFECT_SCALE_KEYS,
  isPlainObject,
  validDayKey,
  validIsoOrNull,
  isHttpsEndpoint,
  normalizeTask,
  normalizeSettings,
  normalizePet,
  normalizeStats,
  normalizeRecurrenceSeriesList,
  normalizeStrategyFeedback,
  normalizeReviews,
  normalizeRoutines,
  normalizeRoutineLog,
  normalizeEnergyProfile,
  normalizeEnergySignals,
  normalizeMigrationNotices,
  normalizePersistedState,
  normalizeFocusLandingPrompt,
  assertUniquePersistedIds
};
