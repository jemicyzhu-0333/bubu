'use strict';

const {
  isPlainObject,
  trimmedString,
  validDayKey,
  validIsoOrNull
} = require('../core/field-normalizers');

class PayloadValidationError extends TypeError {
  constructor(channel, errors) {
    super(`Invalid IPC payload for ${channel}: ${errors.join('; ')}`);
    this.name = 'PayloadValidationError';
    this.channel = channel;
    this.errors = errors;
  }
}

function createValidation(payload, context = {}) {
  const errors = [];
  const fail = message => errors.push(message);
  const rejectUnknown = (object, allowed) => {
    for (const key of Object.keys(object)) {
      if (!allowed.includes(key)) fail(`unknown field: ${key}`);
    }
  };
  const requireObject = () => {
    if (!isPlainObject(payload)) {
      fail('payload must be an object');
      return null;
    }
    return payload;
  };
  const validateId = (candidate, field = 'id') => {
    if (typeof candidate !== 'string' || !candidate.trim() || candidate.length > 200) {
      fail(`${field} must be a non-empty string of at most 200 characters`);
      return null;
    }
    return candidate.trim();
  };
  const validateTaskId = candidate => (
    candidate === null || candidate === undefined ? null : validateId(candidate, 'taskId')
  );
  const validateDateField = (candidate, field) => {
    if (candidate === null || candidate === undefined || candidate === '') return null;
    const result = validIsoOrNull(candidate);
    if (!result) fail(`${field} must be null or a valid ISO date`);
    return result;
  };
  const validateDayKeyField = (candidate, field) => {
    if (candidate === null || candidate === undefined || candidate === '') return null;
    const result = validDayKey(candidate);
    if (!result) fail(`${field} must be null or a local YYYY-MM-DD date`);
    return result;
  };
  const validateBoundedString = (candidate, field, maxLength) => {
    const result = trimmedString(candidate, null, maxLength);
    if (typeof candidate !== 'string' || !result || candidate.trim().length > maxLength) {
      fail(`${field} must be a non-empty string of at most ${maxLength} characters`);
      return null;
    }
    return result;
  };
  const finish = value => errors.length ? { ok: false, errors } : { ok: true, value };

  return {
    payload,
    context,
    fail,
    rejectUnknown,
    requireObject,
    validateId,
    validateTaskId,
    validateDateField,
    validateDayKeyField,
    validateBoundedString,
    finish
  };
}

function emptyPayload(validation) {
  if (validation.payload !== undefined && validation.payload !== null) {
    validation.fail('payload must be empty');
  }
  return undefined;
}

function createCapabilityCodec(decoders) {
  const channels = Object.freeze(Object.keys(decoders));
  return Object.freeze({
    channels,
    decode(channel, payload, context = {}) {
      const decoder = decoders[channel];
      if (!decoder) return null;
      const validation = createValidation(payload, context);
      return validation.finish(decoder(validation));
    }
  });
}

module.exports = { PayloadValidationError, createCapabilityCodec, emptyPayload };
