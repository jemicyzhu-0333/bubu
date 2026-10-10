'use strict';
const { createCapabilityCodec, emptyPayload } = require('../../../shared/ipc-validation');
const { describeRoutes } = require('../../../shared/ipc-routes');
const codec = createCapabilityCodec({
  'ai:diagnostics-status': emptyPayload,
  'ai:diagnostics-start': emptyPayload,
  'ai:diagnostics-stop': emptyPayload,
  'ai:diagnostics-list': emptyPayload,
  'ai:diagnostics-clear': emptyPayload,
  'ai:diagnostics-export': emptyPayload,
  'ai:diagnostics-detail': validation => {
    const object = validation.requireObject();
    if (!object) return undefined;
    validation.rejectUnknown(object, ['id']);
    if (typeof object.id !== 'string' || !/^run-[1-9][0-9]{0,12}$/.test(object.id)) validation.fail('diagnostic run id is invalid');
    return { id: object.id };
  }
});
module.exports = { ipcRoutes: describeRoutes('guidance', codec,
  Object.fromEntries(codec.channels.map(channel => [channel, ['popover']])),
  ['ai:diagnostics-status', 'ai:diagnostics-list', 'ai:diagnostics-detail', 'ai:diagnostics-export']) };
