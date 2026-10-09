'use strict';

const { trimmedString } = require('../../../core/field-normalizers');
const { createCapabilityCodec } = require('../../../shared/ipc-validation');
const { describeRoutes } = require('../../../shared/ipc-routes');

const codec = createCapabilityCodec({
  'nudge:dismiss': validation => {
    const value = validation.payload === undefined || validation.payload === null
      ? 'dismiss' : trimmedString(validation.payload, null, 40);
    if (!value || (typeof validation.payload === 'string' && validation.payload.trim().length > 40)) {
      validation.fail('actionId must be a string of at most 40 characters');
    }
    return value;
  },
  'nudge:pointer-interactive': validation => {
    if (typeof validation.payload !== 'boolean') validation.fail('interactive must be boolean');
    return validation.payload;
  },
  'nudge:test': validation => {
    const object = validation.requireObject();
    if (!object) return undefined;
    validation.rejectUnknown(object, ['kind', 'level']);
    if (!['focus', 'rest'].includes(object.kind)) validation.fail('kind must be focus or rest');
    if (!Number.isInteger(object.level) || object.level < 1 || object.level > 4) {
      validation.fail('level must be an integer from 1 to 4');
    }
    return { kind: object.kind, level: object.level };
  }
});

const ipcRoutes = describeRoutes('attention', codec, {
  'nudge:dismiss': ['nudgeCorner', 'nudgeFullscreen'],
  'nudge:pointer-interactive': ['nudgeCorner'],
  'nudge:test': ['popover']
});

module.exports = { ipcRoutes };
