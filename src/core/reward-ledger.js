'use strict';

const { createHash } = require('node:crypto');
const { localDayKey } = require('./calendar');

// v3 adds `stepBudgets`. A step-reward budget is a per-occurrence lifetime
// allowance, but `dailyBucketTotals` is partitioned by local day, so a checklist
// finished across midnight would silently receive a second full allowance.
const REWARD_LEDGER_VERSION = 3;
const MAX_REWARD_EVENT_ID_LENGTH = 200;
const MAX_STEP_BUDGET_KEYS = 100000;
const STEP_REWARD_BUDGET = 15;
const DEFAULT_BASE_REWARDS = Object.freeze({
  'task-complete': 15,
  'step-complete': 3,
  'focus-complete': 25,
  'quick-start-complete': 5,
  'pet-feed': 0
});

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isDayKey(value) {
  if (!/^\d{4,}-\d{2}-\d{2}$/.test(String(value))) return false;
  const [year, month, day] = String(value).split('-').map(Number);
  const check = new Date(Date.UTC(year, month - 1, day, 12));
  return check.getUTCFullYear() === year && check.getUTCMonth() + 1 === month && check.getUTCDate() === day;
}

function normalizeAmount(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return fallback;
  return Math.round(number * 100) / 100;
}

function normalizeEventId(value) {
  if (typeof value !== 'string') return null;
  const eventId = value.trim();
  return eventId && eventId.length <= MAX_REWARD_EVENT_ID_LENGTH ? eventId : null;
}

function normalizeBucket(value) {
  if (typeof value !== 'string') return null;
  const bucket = value.trim();
  return bucket ? bucket.slice(0, 80) : null;
}

function normalizeStepBudgetKey(value) {
  if (typeof value !== 'string') return null;
  const key = value.trim();
  return key && key.length <= 2 * MAX_REWARD_EVENT_ID_LENGTH + 1 ? key : null;
}

// Budgets only ever grow. Trimming, reordering, deleting or re-adding steps must
// never hand an allowance back, so this map is never pruned by age.
function normalizeStepBudgets(raw) {
  if (!isPlainObject(raw)) return {};
  const entries = [];
  for (const [rawKey, rawAmount] of Object.entries(raw)) {
    const key = normalizeStepBudgetKey(rawKey);
    const amount = normalizeAmount(rawAmount, Number.NaN);
    if (!key || !Number.isFinite(amount) || amount <= 0) continue;
    entries.push([key, amount]);
  }
  if (entries.length > MAX_STEP_BUDGET_KEYS) {
    throw new RangeError(`Reward ledger holds more than ${MAX_STEP_BUDGET_KEYS} step budget keys`);
  }
  entries.sort(([left], [right]) => left.localeCompare(right));
  return Object.fromEntries(entries);
}

function normalizeRewardEvent(raw) {
  if (!isPlainObject(raw)) return null;
  const eventId = normalizeEventId(raw.eventId);
  const source = typeof raw.source === 'string' ? raw.source.trim() : '';
  const dateKey = typeof raw.dateKey === 'string' ? raw.dateKey : '';
  if (!eventId || !source || source.length > 80 || !isDayKey(dateKey)) return null;

  const baseReward = normalizeAmount(raw.baseReward, Number.NaN);
  if (!Number.isFinite(baseReward)) return null;
  const awardedReward = Math.min(baseReward, normalizeAmount(raw.awardedReward, baseReward));
  const createdAt = Number.isFinite(Number(raw.createdAt)) ? Number(raw.createdAt) : 0;
  const bucket = normalizeBucket(raw.bucket) || source;

  return {
    eventId,
    source,
    dateKey,
    bucket,
    baseReward,
    awardedReward,
    createdAt,
    metadata: isPlainObject(raw.metadata) ? { ...raw.metadata } : {}
  };
}

function addDailyBucketAmount(totals, dateKey, bucket, amount) {
  const currentDay = totals.get(dateKey) || new Map();
  const current = currentDay.get(bucket) || 0;
  currentDay.set(bucket, normalizeAmount(Math.min(Number.MAX_SAFE_INTEGER, current + normalizeAmount(amount))));
  totals.set(dateKey, currentDay);
}

function normalizeDailyBucketTotals(raw) {
  const totals = new Map();
  if (!isPlainObject(raw)) return totals;
  for (const [dateKey, buckets] of Object.entries(raw)) {
    if (!isDayKey(dateKey) || !isPlainObject(buckets)) continue;
    for (const [rawBucket, rawAmount] of Object.entries(buckets)) {
      const bucket = normalizeBucket(rawBucket);
      const amount = normalizeAmount(rawAmount, Number.NaN);
      if (!bucket || !Number.isFinite(amount)) continue;
      addDailyBucketAmount(totals, dateKey, bucket, amount);
    }
  }
  return totals;
}

function serializeDailyBucketTotals(totals) {
  return Object.fromEntries([...totals.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([dateKey, buckets]) => [
      dateKey,
      Object.fromEntries([...buckets.entries()].sort(([left], [right]) => left.localeCompare(right)))
    ]));
}

function totalsFromEvents(events) {
  const totals = new Map();
  for (const event of events) addDailyBucketAmount(totals, event.dateKey, event.bucket, event.awardedReward);
  return totals;
}

function mergeDailyBucketTotals(authoritative, visibleMinimums) {
  for (const [dateKey, buckets] of visibleMinimums) {
    const currentDay = authoritative.get(dateKey) || new Map();
    for (const [bucket, amount] of buckets) {
      currentDay.set(bucket, Math.max(currentDay.get(bucket) || 0, amount));
    }
    authoritative.set(dateKey, currentDay);
  }
  return authoritative;
}

function normalizeRewardLedger(raw, options = {}) {
  const maxEvents = Number.isInteger(options.maxEvents) && options.maxEvents > 0 ? options.maxEvents : Number.POSITIVE_INFINITY;
  const source = isPlainObject(raw) ? raw : {};
  const sourceEvents = Array.isArray(raw) ? raw : Array.isArray(source.events) ? source.events : [];
  const eventIds = new Set();
  if (Array.isArray(source.seenEventIds)) {
    for (const candidate of source.seenEventIds) {
      const eventId = normalizeEventId(candidate);
      if (eventId) eventIds.add(eventId);
    }
  }
  const displayEventIds = new Set();
  const events = [];
  for (const candidate of sourceEvents) {
    const event = normalizeRewardEvent(candidate);
    if (!event || displayEventIds.has(event.eventId)) continue;
    displayEventIds.add(event.eventId);
    eventIds.add(event.eventId);
    events.push(event);
  }
  events.sort((a, b) => a.createdAt - b.createdAt || a.eventId.localeCompare(b.eventId));
  // v1 stored only the display events. During migration those events seed both
  // the permanent identity index and the authoritative daily-cap totals. In
  // v2, persisted totals remain authoritative even when old display rows are
  // trimmed; visible events only repair an obviously missing/lower aggregate.
  const dailyBucketTotals = mergeDailyBucketTotals(
    normalizeDailyBucketTotals(source.dailyBucketTotals),
    totalsFromEvents(events)
  );
  return {
    version: REWARD_LEDGER_VERSION,
    events: events.slice(-maxEvents),
    seenEventIds: [...eventIds].sort(),
    dailyBucketTotals: serializeDailyBucketTotals(dailyBucketTotals),
    stepBudgets: normalizeStepBudgets(source.stepBudgets)
  };
}

function createRewardLedger() {
  return {
    version: REWARD_LEDGER_VERSION,
    events: [],
    seenEventIds: [],
    dailyBucketTotals: {},
    stepBudgets: {}
  };
}

// Schema 8 introduced a lifetime step-reward allowance. Older stores may
// already have a reward ledger, but that ledger cannot contain this new index.
// Reconstruct only the spent allowance from the lossless task snapshots; keep
// the existing event identities and aggregates authoritative.
function backfillLegacyStepBudgets(rawLedger, tasks, dateKey, options = {}) {
  if (!isDayKey(dateKey)) throw new TypeError('A valid local date key is required to backfill legacy step budgets');
  const ledger = normalizeRewardLedger(rawLedger, options);
  const stepBudgets = { ...ledger.stepBudgets };

  for (const task of Array.isArray(tasks) ? tasks : []) {
    if (!isPlainObject(task)) continue;
    const completedSteps = (Array.isArray(task.steps) ? task.steps : [])
      .filter(step => isPlainObject(step) && step.done)
      .length;
    if (completedSteps <= 0) continue;
    const key = stepBudgetKey(task, dateKey);
    stepBudgets[key] = Math.max(
      normalizeAmount(stepBudgets[key], 0),
      Math.min(STEP_REWARD_BUDGET, completedSteps * DEFAULT_BASE_REWARDS['step-complete'])
    );
  }

  return { ...ledger, stepBudgets: normalizeStepBudgets(stepBudgets) };
}

// Stores created before the reward ledger existed can already contain paid
// completed tasks and steps. Seed only their permanent identities: inventing
// display events or aggregate amounts would count historical XP a second time.
// Step budgets are the one exception — recording an already spent allowance is
// bookkeeping, not a payout, and it can only ever reduce future payouts.
function seedLegacyCompletionRewardIds(rawLedger, tasks, dateKey, options = {}) {
  if (!isDayKey(dateKey)) throw new TypeError('A valid local date key is required to seed legacy rewards');
  const ledger = backfillLegacyStepBudgets(rawLedger, tasks, dateKey, options);
  const seenEventIds = new Set(ledger.seenEventIds);

  for (const task of Array.isArray(tasks) ? tasks : []) {
    if (!isPlainObject(task)) continue;
    if (task.done) seenEventIds.add(taskCompletionRewardId(task, dateKey));
    for (const step of Array.isArray(task.steps) ? task.steps : []) {
      if (isPlainObject(step) && step.done) {
        seenEventIds.add(stepCompletionRewardId(task, step.id, dateKey));
      }
    }
  }

  return {
    ...ledger,
    seenEventIds: [...seenEventIds].sort()
  };
}

function baseRewardFor(source, overrides = {}) {
  if (Object.prototype.hasOwnProperty.call(overrides, source)) return normalizeAmount(overrides[source]);
  return DEFAULT_BASE_REWARDS[source] ?? 0;
}

function createRewardEvent(input, options = {}) {
  if (!isPlainObject(input)) throw new TypeError('Reward event must be an object');
  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
  const source = typeof input.source === 'string' ? input.source.trim() : '';
  const event = normalizeRewardEvent({
    eventId: input.eventId,
    source,
    dateKey: input.dateKey || localDayKey(now, options.calendar || {}),
    bucket: input.bucket || source,
    baseReward: input.baseReward === undefined
      ? baseRewardFor(source, options.baseRewards)
      : input.baseReward,
    awardedReward: input.baseReward === undefined
      ? baseRewardFor(source, options.baseRewards)
      : input.baseReward,
    createdAt: input.createdAt === undefined ? now : input.createdAt,
    metadata: input.metadata
  });
  if (!event) throw new TypeError('Reward event has invalid eventId, source, dateKey, or reward amount');
  return event;
}

function hasRewardEvent(ledger, eventId) {
  const normalizedId = normalizeEventId(eventId);
  return Boolean(normalizedId && normalizeRewardLedger(ledger).seenEventIds.includes(normalizedId));
}

function rewardTotal(ledger, filter = {}) {
  const normalized = normalizeRewardLedger(ledger);
  // Every reward belongs to a local day and bucket, so these aggregates remain
  // exact even after the human-readable event history has been trimmed.
  if (!filter.source) {
    let total = 0;
    for (const [dateKey, buckets] of Object.entries(normalized.dailyBucketTotals)) {
      if (filter.dateKey && dateKey !== filter.dateKey) continue;
      for (const [bucket, amount] of Object.entries(buckets)) {
        if (filter.bucket && bucket !== filter.bucket) continue;
        total += amount;
      }
    }
    return total;
  }
  return normalized.events.reduce((sum, event) => {
    if (filter.dateKey && event.dateKey !== filter.dateKey) return sum;
    if (filter.source && event.source !== filter.source) return sum;
    if (filter.bucket && event.bucket !== filter.bucket) return sum;
    return sum + event.awardedReward;
  }, 0);
}

// Records a reward exactly once. Callers should derive eventId from the domain
// transition (for example `task:<id>:completion:<cycle>`) rather than generate a
// new ID on every retry.
function recordReward(rawLedger, rawEvent, options = {}) {
  const ledger = normalizeRewardLedger(rawLedger, options);
  const event = normalizeRewardEvent(rawEvent) || createRewardEvent(rawEvent, options);
  const existing = ledger.events.find(candidate => candidate.eventId === event.eventId) || null;
  if (ledger.seenEventIds.includes(event.eventId)) {
    return {
      ledger,
      recorded: false,
      duplicate: true,
      awardedReward: 0,
      event: existing || event
    };
  }

  let awardedReward = event.baseReward;
  const budgetKey = options.bucketCap ? normalizeStepBudgetKey(options.bucketCap.key) : null;
  if (options.dailyCap !== undefined) {
    const dailyCap = normalizeAmount(options.dailyCap);
    const alreadyAwarded = rewardTotal(ledger, { dateKey: event.dateKey, bucket: event.bucket });
    awardedReward = Math.min(awardedReward, Math.max(0, dailyCap - alreadyAwarded));
  }
  if (budgetKey) {
    // A day-independent allowance. `min(base, cap - spent)` still records the
    // event so the identity stays idempotent; only the payout shrinks to zero.
    const cap = normalizeAmount(options.bucketCap.cap);
    const spent = normalizeAmount(ledger.stepBudgets[budgetKey], 0);
    awardedReward = Math.min(awardedReward, Math.max(0, cap - spent));
  }

  const recordedEvent = { ...event, awardedReward };
  const maxEvents = Number.isInteger(options.maxEvents) && options.maxEvents > 0 ? options.maxEvents : Number.POSITIVE_INFINITY;
  const dailyBucketTotals = normalizeDailyBucketTotals(ledger.dailyBucketTotals);
  addDailyBucketAmount(dailyBucketTotals, event.dateKey, event.bucket, awardedReward);
  const stepBudgets = { ...ledger.stepBudgets };
  if (budgetKey && awardedReward > 0) {
    stepBudgets[budgetKey] = normalizeAmount(normalizeAmount(stepBudgets[budgetKey], 0) + awardedReward);
  }
  const events = [...ledger.events, recordedEvent]
    .sort((left, right) => left.createdAt - right.createdAt || left.eventId.localeCompare(right.eventId))
    .slice(-maxEvents);
  return {
    ledger: {
      version: REWARD_LEDGER_VERSION,
      // Keep writes in the exact canonical order used by normalization. Some
      // domain rewards intentionally use a stable day timestamp, so insertion
      // order is not necessarily chronological.
      events,
      seenEventIds: [...ledger.seenEventIds, event.eventId].sort(),
      dailyBucketTotals: serializeDailyBucketTotals(dailyBucketTotals),
      stepBudgets: normalizeStepBudgets(stepBudgets)
    },
    recorded: true,
    duplicate: false,
    awardedReward,
    event: recordedEvent
  };
}

function makeRewardEventId(source, entityId, cycle) {
  const rawFields = [source, entityId, cycle].map(value => String(value));
  const fields = rawFields.map(value => encodeURIComponent(value));
  if (fields.some(value => !value)) throw new TypeError('Reward event ID fields must be non-empty');
  const readable = fields.join(':');
  if (readable.length <= MAX_REWARD_EVENT_ID_LENGTH) return readable;
  // Business IDs may be up to 200 UTF-16 code units. Percent-encoding (and the
  // legacy step-ID compatibility encoding) can expand them far beyond the
  // event-key limit, so only overlong tuples use a deterministic compact key.
  const digest = createHash('sha256').update(JSON.stringify(rawFields)).digest('hex');
  return `reward-sha256:${digest}`;
}

// Schema 8 derives the reward cycle from the immutable occurrence date instead
// of `category === 'daily'`. For a task migrated out of the old daily category
// the migrator sets `occurrenceDate` to the same monotonic business day the
// legacy seeding used, so historical event IDs keep matching and an already
// paid completion cannot be paid again.
function taskRewardCycle(task, dateKey) {
  if (!task || typeof task !== 'object') throw new TypeError('Task is required for a reward identity');
  if (!isDayKey(dateKey)) throw new TypeError('A valid local date key is required for a reward identity');
  if (typeof task.occurrenceDate === 'string' && isDayKey(task.occurrenceDate)) return task.occurrenceDate;
  // Legacy input only: the schema-7 migrator still reads `category` to decide
  // which tasks become recurrence series.
  return task.category === 'daily' ? dateKey : 'lifetime';
}

function stepBudgetKey(task, dateKey) {
  if (!task || typeof task.id !== 'string' || !task.id.trim()) throw new TypeError('Task ID is required');
  return `${task.id.trim()}|${taskRewardCycle(task, dateKey)}`;
}

function stepBudgetSpent(ledger, key) {
  const normalizedKey = normalizeStepBudgetKey(key);
  if (!normalizedKey) return 0;
  return normalizeAmount(normalizeRewardLedger(ledger).stepBudgets[normalizedKey], 0);
}

function stepBudgetRemaining(ledger, key, cap = STEP_REWARD_BUDGET) {
  return Math.max(0, normalizeAmount(cap) - stepBudgetSpent(ledger, key));
}

function taskCompletionRewardId(task, dateKey) {
  if (!task || typeof task.id !== 'string' || !task.id.trim()) throw new TypeError('Task ID is required');
  return makeRewardEventId('task-complete', task.id.trim(), taskRewardCycle(task, dateKey));
}

function stepCompletionRewardId(task, stepId, dateKey) {
  if (!task || typeof task.id !== 'string' || !task.id.trim()) throw new TypeError('Task ID is required');
  const normalizedStepId = typeof stepId === 'string' ? stepId.trim() : '';
  if (!normalizedStepId) throw new TypeError('Step ID is required');
  // Numeric IDs are migrated legacy indices. Keep their former event ID
  // shape so an already-awarded step cannot be paid again after migration.
  const entityId = /^\d+$/.test(normalizedStepId)
    ? `${task.id.trim()}-${normalizedStepId}`
    : `${encodeURIComponent(task.id.trim())}|${encodeURIComponent(normalizedStepId)}`;
  return makeRewardEventId('step-complete', entityId, taskRewardCycle(task, dateKey));
}

module.exports = {
  REWARD_LEDGER_VERSION,
  MAX_REWARD_EVENT_ID_LENGTH,
  MAX_STEP_BUDGET_KEYS,
  STEP_REWARD_BUDGET,
  DEFAULT_BASE_REWARDS,
  createRewardLedger,
  backfillLegacyStepBudgets,
  seedLegacyCompletionRewardIds,
  normalizeRewardLedger,
  normalizeRewardEvent,
  createRewardEvent,
  baseRewardFor,
  hasRewardEvent,
  rewardTotal,
  recordReward,
  makeRewardEventId,
  taskRewardCycle,
  taskCompletionRewardId,
  stepCompletionRewardId,
  stepBudgetKey,
  stepBudgetSpent,
  stepBudgetRemaining
};
