'use strict';

// Payload validation for the five routine channels.
//
// Every payload is closed with `rejectUnknown` and every field is checked
// explicitly. That matters more here than elsewhere: an unvalidated `timesOfDay`
// is a reminder firing at a time the user never configured, which is the one
// failure this feature cannot afford.
//
// `routines:log` is the only channel the nudge surfaces may call — "I took it" has
// to work from the reminder itself, otherwise the user has to open the panel to
// answer a question the reminder just asked. Nothing else is reachable from a
// nudge: a corner window cannot edit or delete a routine.
//
// No dose field anywhere (ARCHITECTURE「日常与能量」). `magnitude` is an unitless 1–100 self-report —
// "a big coffee", not "200 mg" — and there is deliberately no channel through
// which a milligram could arrive.

const { createCapabilityCodec } = require('../../../shared/ipc-validation');
const { describeRoutes } = require('../../../shared/ipc-routes');
const {
  ROUTINE_LOGGABLE_STATUSES,
  MAX_ROUTINE_TITLE,
  MAX_ROUTINE_TIMES_OF_DAY,
  MAX_ROUTINE_LEVEL,
  MIN_ROUTINE_WINDOW_MINUTES,
  MAX_ROUTINE_WINDOW_MINUTES,
  SCHEDULE_FREQUENCIES,
  TIME_OF_DAY_PATTERN
} = require('../../../core/routine-model');
const { ROUTINE_KINDS } = require('../../../content/energy-effects.mjs');

const MAX_ROUTINE_NOTE = 200;
const PATCH_FIELDS = Object.freeze(['title', 'kind', 'customLabel', 'schedule', 'effect', 'maxLevel', 'active']);

function decodeSchedule(validation, raw) {
  if (raw === null || raw === undefined) return null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    validation.fail('schedule must be an object or null');
    return null;
  }
  validation.rejectUnknown(raw, ['frequency', 'timesOfDay', 'weekdays', 'windowMinutes']);
  if (!SCHEDULE_FREQUENCIES.includes(raw.frequency)) {
    validation.fail(`schedule frequency must be one of ${SCHEDULE_FREQUENCIES.join(', ')}`);
  }
  if (!Array.isArray(raw.timesOfDay) || raw.timesOfDay.length === 0
      || raw.timesOfDay.length > MAX_ROUTINE_TIMES_OF_DAY) {
    validation.fail(`schedule timesOfDay must hold 1 to ${MAX_ROUTINE_TIMES_OF_DAY} entries`);
  } else if (raw.timesOfDay.some(time => typeof time !== 'string' || !TIME_OF_DAY_PATTERN.test(time))) {
    // Zero-padded HH:mm only. A `9:05` accepted here would sort after `10:00` as
    // text, and text order is what the occurrence ids rely on.
    validation.fail('schedule times must be zero-padded HH:mm');
  }
  if (raw.frequency === 'weekly') {
    const weekdays = raw.weekdays;
    if (!Array.isArray(weekdays) || weekdays.length === 0 || weekdays.length > 7
        || weekdays.some(day => !Number.isInteger(day) || day < 1 || day > 7)) {
      validation.fail('weekly schedules need 1 to 7 weekdays numbered 1 to 7');
    }
  } else if (raw.weekdays !== undefined && !Array.isArray(raw.weekdays)) {
    validation.fail('schedule weekdays must be an array');
  }
  if (raw.windowMinutes !== undefined
      && (!Number.isInteger(raw.windowMinutes)
        || raw.windowMinutes < MIN_ROUTINE_WINDOW_MINUTES
        || raw.windowMinutes > MAX_ROUTINE_WINDOW_MINUTES)) {
    validation.fail(`schedule windowMinutes must be an integer from ${MIN_ROUTINE_WINDOW_MINUTES} to ${MAX_ROUTINE_WINDOW_MINUTES}`);
  }
  return {
    frequency: raw.frequency,
    timesOfDay: Array.isArray(raw.timesOfDay) ? [...raw.timesOfDay] : [],
    weekdays: Array.isArray(raw.weekdays) ? [...raw.weekdays] : [],
    ...(raw.windowMinutes === undefined ? {} : { windowMinutes: raw.windowMinutes })
  };
}

// Only the two parameters the content table calls editable ever cross the wire.
// The shape, onset and half-life belong to the profile, and a payload that could
// set them would let a surface invent a curve the user was never shown.
function decodeEffect(validation, raw) {
  if (raw === null || raw === undefined) return null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    validation.fail('effect must be an object or null');
    return null;
  }
  validation.rejectUnknown(raw, ['amplitude', 'durationMin']);
  if (raw.amplitude !== undefined
      && (!Number.isInteger(raw.amplitude) || raw.amplitude < -100 || raw.amplitude > 100)) {
    validation.fail('effect amplitude must be an integer from -100 to 100');
  }
  if (raw.durationMin !== undefined
      && (!Number.isInteger(raw.durationMin) || raw.durationMin < 1 || raw.durationMin > 1440)) {
    validation.fail('effect durationMin must be an integer from 1 to 1440');
  }
  return {
    ...(raw.amplitude === undefined ? {} : { amplitude: raw.amplitude }),
    ...(raw.durationMin === undefined ? {} : { durationMin: raw.durationMin })
  };
}

function decodeTitle(validation, value) {
  if (typeof value !== 'string' || !value.trim()) {
    validation.fail('title is required');
    return '';
  }
  const title = value.trim();
  if (title.length > MAX_ROUTINE_TITLE) validation.fail(`title must be at most ${MAX_ROUTINE_TITLE} characters`);
  return title;
}

function decodeLevel(validation, value) {
  if (!Number.isInteger(value) || value < 1 || value > MAX_ROUTINE_LEVEL) {
    validation.fail(`maxLevel must be an integer from 1 to ${MAX_ROUTINE_LEVEL}`);
  }
  return value;
}

const codec = createCapabilityCodec({
  'routines:add': validation => {
    const object = validation.requireObject();
    if (!object) return undefined;
    validation.rejectUnknown(object, ['title', 'kind', 'customLabel', 'schedule', 'effect', 'maxLevel', 'active']);
    const title = decodeTitle(validation, object.title);
    if (!ROUTINE_KINDS.includes(object.kind)) {
      validation.fail(`kind must be one of ${ROUTINE_KINDS.join(', ')}`);
    }
    const schedule = decodeSchedule(validation, object.schedule);
    const effect = decodeEffect(validation, object.effect);
    if (object.maxLevel !== undefined) decodeLevel(validation, object.maxLevel);
    if (object.active !== undefined && typeof object.active !== 'boolean') {
      validation.fail('active must be a boolean');
    }
    return {
      title,
      kind: object.kind,
      ...(object.customLabel === undefined ? {} : { customLabel: decodeTitle(validation, object.customLabel) }),
      schedule,
      effect,
      ...(object.maxLevel === undefined ? {} : { maxLevel: object.maxLevel }),
      ...(object.active === undefined ? {} : { active: object.active })
    };
  },

  // A patch, not a replacement, and every key is whitelisted one by one. An open
  // patch would be a write to any field the store happens to hold.
  'routines:update': validation => {
    const object = validation.requireObject();
    if (!object) return undefined;
    validation.rejectUnknown(object, ['routineId', 'patch']);
    const routineId = validation.validateId(object.routineId, 'routineId');
    const raw = object.patch;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      validation.fail('patch must be an object');
      return { routineId, patch: {} };
    }
    validation.rejectUnknown(raw, PATCH_FIELDS);
    if (!Object.keys(raw).length) validation.fail('patch must change at least one field');
    const patch = {};
    if ('title' in raw) patch.title = decodeTitle(validation, raw.title);
    if ('kind' in raw) {
      if (!ROUTINE_KINDS.includes(raw.kind)) validation.fail(`kind must be one of ${ROUTINE_KINDS.join(', ')}`);
      patch.kind = raw.kind;
    }
    if ('customLabel' in raw) patch.customLabel = decodeTitle(validation, raw.customLabel);
    if ('schedule' in raw) patch.schedule = decodeSchedule(validation, raw.schedule);
    if ('effect' in raw) patch.effect = decodeEffect(validation, raw.effect);
    if ('maxLevel' in raw) patch.maxLevel = decodeLevel(validation, raw.maxLevel);
    if ('active' in raw) {
      if (typeof raw.active !== 'boolean') validation.fail('active must be a boolean');
      patch.active = raw.active;
    }
    return { routineId, patch };
  },

  'routines:remove': validation => {
    const object = validation.requireObject();
    if (!object) return undefined;
    validation.rejectUnknown(object, ['routineId']);
    return { routineId: validation.validateId(object.routineId, 'routineId') };
  },

  'routines:log': validation => {
    const object = validation.requireObject();
    if (!object) return undefined;
    validation.rejectUnknown(object, ['routineId', 'occurrenceId', 'status', 'at', 'note', 'magnitude']);
    const routineId = validation.validateId(object.routineId, 'routineId');
    // Only what a person can tap. `notified` is the sampler's in-process mark and
    // `missed` is derived and never stored — accepting either here would let a
    // reminder surface forge a machine-only status through the one channel it is
    // granted (see ROUTINE_LOGGABLE_STATUSES in core/routine-model).
    if (!ROUTINE_LOGGABLE_STATUSES.includes(object.status)) {
      validation.fail(`status must be one of ${ROUTINE_LOGGABLE_STATUSES.join(', ')}`);
    }
    const occurrenceId = object.occurrenceId === undefined || object.occurrenceId === null
      ? undefined
      : validation.validateId(object.occurrenceId, 'occurrenceId');
    if (object.at !== undefined && (!Number.isSafeInteger(object.at) || object.at < 0)) {
      validation.fail('at must be a non-negative safe integer');
    }
    if (object.note !== undefined && object.note !== null) {
      validation.validateBoundedString(object.note, 'note', MAX_ROUTINE_NOTE);
    }
    // Unitless intensity, not a dose. See the header.
    if (object.magnitude !== undefined && object.magnitude !== null
        && (!Number.isInteger(object.magnitude) || object.magnitude < 1 || object.magnitude > 100)) {
      validation.fail('magnitude must be an integer from 1 to 100');
    }
    return {
      routineId,
      status: object.status,
      ...(occurrenceId === undefined ? {} : { occurrenceId }),
      ...(object.at === undefined ? {} : { at: object.at }),
      ...(object.note === undefined || object.note === null ? {} : { note: object.note }),
      ...(object.magnitude === undefined || object.magnitude === null ? {} : { magnitude: object.magnitude })
    };
  },

  'routines:undo-log': validation => {
    const object = validation.requireObject();
    if (!object) return undefined;
    validation.rejectUnknown(object, ['occurrenceId']);
    return { occurrenceId: validation.validateId(object.occurrenceId, 'occurrenceId') };
  }
});

const ipcRoutes = describeRoutes('routines', codec, {
  'routines:add': ['popover'],
  'routines:update': ['popover'],
  'routines:remove': ['popover'],
  // Answering the reminder from the reminder is the whole point; the panel is not
  // a required detour.
  'routines:log': ['popover', 'nudgeCorner', 'nudgeFullscreen'],
  'routines:undo-log': ['popover']
});

module.exports = { ipcRoutes };
