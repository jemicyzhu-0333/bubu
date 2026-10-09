'use strict';

const { trimmedString } = require('../../../core/field-normalizers');
const { MIN_FOCUS_MINUTES, MAX_FOCUS_MINUTES } = require('./session-duration.mjs');
const { createCapabilityCodec, emptyPayload } = require('../../../shared/ipc-validation');
const { describeRoutes } = require('../../../shared/ipc-routes');
const { readClarification } = require('./quick-start-input');

function decodeMinutes(validation, includeTask) {
  const object = validation.requireObject();
  if (!object) return undefined;
  validation.rejectUnknown(object, includeTask ? ['taskId', 'minutes'] : ['minutes']);
  const taskId = includeTask ? validation.validateTaskId(object.taskId) : undefined;
  if (!Number.isInteger(object.minutes)
      || object.minutes < MIN_FOCUS_MINUTES
      || object.minutes > MAX_FOCUS_MINUTES) {
    validation.fail(`minutes must be an integer from ${MIN_FOCUS_MINUTES} to ${MAX_FOCUS_MINUTES}`);
  }
  return includeTask ? { taskId, minutes: object.minutes } : { minutes: object.minutes };
}

function landingNote(validation, object) {
  const value = object.landingNote === undefined || object.landingNote === null || object.landingNote === ''
    ? null : trimmedString(object.landingNote, null, 200);
  if (object.landingNote !== undefined && object.landingNote !== null && object.landingNote !== ''
      && (typeof object.landingNote !== 'string' || !value || object.landingNote.trim().length > 200)) {
    validation.fail('landingNote must be null or a non-empty string of at most 200 characters');
  }
  return value;
}

const codec = createCapabilityCodec({
  'tasks:set-now': validation => validation.validateId(validation.payload),
  'tasks:clarify-now': validation => {
    const object = validation.requireObject();
    if (!object) return undefined;
    validation.rejectUnknown(object, ['taskId', 'blocker', 'nextAction']);
    const taskId = validation.validateId(object.taskId, 'taskId');
    const blocker = object.blocker === undefined ? null : trimmedString(object.blocker, null, 80);
    const nextAction = object.nextAction === undefined ? null : trimmedString(object.nextAction, null, 200);
    if (object.blocker !== undefined
        && (typeof object.blocker !== 'string' || !blocker || object.blocker.trim().length > 80)) {
      validation.fail('blocker must be a non-empty string of at most 80 characters');
    }
    if (object.nextAction !== undefined
        && (typeof object.nextAction !== 'string' || !nextAction || object.nextAction.trim().length > 200)) {
      validation.fail('nextAction must be a non-empty string of at most 200 characters');
    }
    return { taskId, blocker, nextAction };
  },
  'pomodoro:start': validation => decodeMinutes(validation, true),
  'pomodoro:kickstart': validation => {
    const object = validation.requireObject();
    if (!object) return undefined;
    validation.rejectUnknown(object, ['taskId', 'nextAction', 'taskVersion']);
    const parsed = readClarification(object);
    if (!parsed.ok) validation.fail('nextAction and taskVersion must be a valid paired clarification');
    return { taskId: validation.validateId(object.taskId, 'taskId'), ...(parsed.clarification || {}) };
  },
  'pomodoro:stop': validation => {
    if (validation.payload === undefined || validation.payload === null) return undefined;
    const object = validation.requireObject();
    if (!object) return undefined;
    validation.rejectUnknown(object, ['sessionId']);
    return { sessionId: validation.validateId(object.sessionId, 'sessionId') };
  },
  'pomodoro:pause': emptyPayload,
  'pomodoro:resume': validation => {
    const object = validation.requireObject();
    if (!object) return undefined;
    validation.rejectUnknown(object, ['sessionId', 'intent']);
    const sessionId = validation.validateId(object.sessionId, 'sessionId');
    if (!['resume', 'confirm-completion'].includes(object.intent)) validation.fail('resume intent is invalid');
    return { sessionId, intent: object.intent };
  },
  'pomodoro:adjust-duration': validation => decodeMinutes(validation, false),
  'pomodoro:resolve-quick-start': validation => {
    const aliases = ['stop', 'done', 'enough', 'extend', 'continue', 'extend-8', 'full', 'full-round', 'full-session'];
    const object = validation.requireObject();
    if (!object) return undefined;
    validation.rejectUnknown(object, ['sessionId', 'action', 'landingNote', 'progressMade']);
    const sessionId = validation.validateId(object.sessionId, 'sessionId');
    if (typeof object.progressMade !== 'boolean') validation.fail('progressMade must be a boolean');
    if (!aliases.includes(object.action)) validation.fail('quick-start action is invalid');
    return { sessionId, action: object.action, landingNote: landingNote(validation, object), progressMade: object.progressMade };
  },
  'pomodoro:resolve-focus-landing': validation => {
    const object = validation.requireObject();
    if (!object) return undefined;
    validation.rejectUnknown(object, ['sessionId', 'action', 'landingNote', 'progressMade']);
    if (typeof object.progressMade !== 'boolean') validation.fail('progressMade must be a boolean');
    const sessionId = validation.validateId(object.sessionId, 'sessionId');
    if (!['save', 'skip'].includes(object.action)) validation.fail('focus landing action must be save or skip');
    const note = landingNote(validation, object);
    if (object.action === 'save' && !note) validation.fail('save requires a landingNote');
    if (object.action === 'skip' && note) validation.fail('skip must not include a landingNote');
    return { sessionId, action: object.action, landingNote: note, progressMade: object.progressMade };
  },
  'pet:startFocus': emptyPayload
});

const popover = ['popover'];
const ipcRoutes = describeRoutes('execution', codec, {
  'tasks:set-now': popover,
  'tasks:clarify-now': popover,
  'pomodoro:start': ['popover', 'impulse'],
  'pomodoro:kickstart': ['popover', 'impulse'],
  'pomodoro:stop': ['popover', 'impulse'],
  'pomodoro:pause': ['popover', 'impulse'],
  'pomodoro:resume': ['popover', 'impulse'],
  'pomodoro:adjust-duration': popover,
  'pomodoro:resolve-quick-start': popover,
  'pomodoro:resolve-focus-landing': popover,
  'pet:startFocus': ['pet']
});

module.exports = { ipcRoutes };
