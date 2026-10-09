'use strict';

// ARCHITECTURE「日常与能量」: the existing 30s sampler delivers one due occurrence
// at a time. Only an actual delivery followed by the canonical notified commit
// counts as a reminder. No work-session gate, persistent queue, or second writer.
const { buildDayPlan, dueOccurrences, witnessedMissedOccurrences } = require('../domain/day-plan');
const { MAX_ROUTINE_ENTRIES_PER_DAY } = require('../domain/routine-logging');
const { MAX_ROUTINE_LEVEL, DEFAULT_ROUTINE_LEVEL } = require('../../../core/routine-model');

function createRoutineReminder({
  now, dayKey, getRoutines, getRoutineLog, getSettings, remind, recordNotified, recordMissed
} = {}) {
  for (const [name, value] of Object.entries({
    now, dayKey, getRoutines, getRoutineLog, getSettings, remind, recordNotified, recordMissed
  })) {
    if (typeof value !== 'function') throw new TypeError(`routine reminder requires ${name}`);
  }

  const witnessed = new Set();
  let inFlight = null;
  let lastAttempted = null;

  function readCurrent() {
    const at = now();
    return {
      now: at, dayKey: dayKey(at), settings: getSettings() || {},
      routines: getRoutines() || [], routineLog: getRoutineLog() || { days: [] }
    };
  }

  function levelFor(routine, dnd) {
    if (dnd) return 1;
    const cap = Number.isInteger(routine.maxLevel) ? routine.maxLevel : DEFAULT_ROUTINE_LEVEL;
    return Math.max(1, Math.min(MAX_ROUTINE_LEVEL, cap));
  }

  function requestFor(occurrence, current) {
    const routine = current.routines.find(item => item && item.id === occurrence.routineId);
    const { settings } = current;
    return {
      type: 'routine', message: occurrence.title, resolvedAt: current.now,
      maxLevel: levelFor(routine, settings.dnd),
      character: settings.nudgeCharacter,
      whitelist: settings.dnd ? [] : (Array.isArray(settings.nudgeWhitelist)
        ? [...settings.nudgeWhitelist] : settings.nudgeWhitelist),
      themePrimary: settings.themePrimary,
      motionMode: settings.motionMode,
      stimulationMode: settings.stimulationMode,
      soundEnabled: settings.dnd ? false : settings.soundEnabled,
      context: {
        routineId: occurrence.routineId,
        occurrenceId: occurrence.occurrenceId,
        kind: occurrence.kind
      }
    };
  }

  function findEligible(identity, current) {
    if (!identity || typeof identity.routineId !== 'string' || !identity.routineId
      || typeof identity.occurrenceId !== 'string' || !identity.occurrenceId
      || current.settings.routineRemindersEnabled === false) return null;
    return buildDayPlan(current).occurrences.find(occurrence => occurrence.scheduled && occurrence.due
      && !occurrence.answered && occurrence.routineId === identity.routineId
      && occurrence.occurrenceId === identity.occurrenceId) || null;
  }

  // Explicit deferral is still eligible after `notified`: dueOccurrences drops
  // that row only for automatic sampling, not for a person's request to replay it.
  function resolveRequest(identity) {
    const current = readCurrent();
    const occurrence = findEligible(identity, current);
    return occurrence ? requestFor(occurrence, current) : null;
  }

  function hasCapacity(occurrence, current) {
    const day = current.routineLog.days?.find(item => item && item.dayKey === occurrence.dayKey);
    const entries = Array.isArray(day?.entries) ? day.entries : [];
    return entries.some(entry => entry && entry.occurrenceId === occurrence.occurrenceId)
      || entries.length < MAX_ROUTINE_ENTRIES_PER_DAY;
  }

  function followsLast(occurrence) {
    return !lastAttempted || occurrence.scheduledAt > lastAttempted.scheduledAt
      || (occurrence.scheduledAt === lastAttempted.scheduledAt
        && occurrence.occurrenceId.localeCompare(lastAttempted.occurrenceId) > 0);
  }

  async function deliverOne(current) {
    const candidates = dueOccurrences(current).filter(occurrence => hasCapacity(occurrence, current));
    const occurrence = candidates.find(followsLast) || candidates[0];
    if (!occurrence) return 0;
    // Advance even on refused delivery, so one blocked slot cannot starve peers.
    lastAttempted = { scheduledAt: occurrence.scheduledAt, occurrenceId: occurrence.occurrenceId };
    const receipt = await remind(requestFor(occurrence, current));
    if (receipt?.shown !== true || !Number.isInteger(receipt.level)
      || receipt.level < 1 || receipt.level > MAX_ROUTINE_LEVEL) return 0;

    // Delivery waits outside the transaction. Re-read every canonical input at
    // acceptance, including the original occurrence's day bucket across midnight.
    const latest = readCurrent();
    const eligible = findEligible(occurrence, latest);
    if (!eligible || eligible.loggedAt != null || !hasCapacity(eligible, latest)) return 0;
    const result = await recordNotified({
      routineId: eligible.routineId, occurrenceId: eligible.occurrenceId,
      level: receipt.level, at: latest.now
    });
    return result?.ok === true && result.changed === true ? 1 : 0;
  }

  async function recordWitnessedMisses(current) {
    if (current.settings.routineRemindersEnabled === false) return 0;
    let missed = 0;
    for (const occurrence of witnessedMissedOccurrences(current)) {
      if (witnessed.has(occurrence.occurrenceId)) continue;
      const latest = readCurrent();
      if (latest.settings.routineRemindersEnabled === false) break;
      const eligible = witnessedMissedOccurrences(latest).find(item => item.occurrenceId === occurrence.occurrenceId);
      if (!eligible) continue;
      await recordMissed({
        routineId: eligible.routineId, kind: eligible.kind,
        occurrenceId: eligible.occurrenceId, missedAt: latest.now
      });
      witnessed.add(occurrence.occurrenceId);
      missed += 1;
    }
    return missed;
  }

  async function runSample() {
    const current = readCurrent();
    if (current.settings.routineRemindersEnabled === false) {
      return { triggered: false, reminded: 0, missed: 0 };
    }
    const reminded = await deliverOne(current);
    const missed = await recordWitnessedMisses(readCurrent());
    return { triggered: reminded > 0, reminded, missed };
  }

  // Intentionally not async: overlapping callers receive the exact same Promise.
  // Install it before running ports, including ones which synchronously re-enter.
  function sample() {
    if (!inFlight) {
      inFlight = Promise.resolve().then(runSample).finally(() => { inFlight = null; });
    }
    return inFlight;
  }

  return Object.freeze({ sample, resolveRequest });
}

module.exports = { createRoutineReminder };
