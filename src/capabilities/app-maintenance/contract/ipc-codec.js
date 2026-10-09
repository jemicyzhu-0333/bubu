'use strict';

const { createCapabilityCodec, emptyPayload } = require('../../../shared/ipc-validation');
const { describeRoutes } = require('../../../shared/ipc-routes');

const codec = createCapabilityCodec({
  'state:get': emptyPayload,
  'updates:get': emptyPayload,
  'updates:check': emptyPayload,
  'updates:download': emptyPayload,
  'updates:cancel': emptyPayload,
  'updates:install': emptyPayload,
  'notices:dismiss': validation => {
    const object = validation.requireObject();
    if (!object) return undefined;
    validation.rejectUnknown(object, ['id']);
    return { id: validation.validateId(object.id, 'noticeId') };
  },
  'window:hide': emptyPayload
});

const ipcRoutes = describeRoutes('app-maintenance', codec, {
  'state:get': ['popover', 'impulse'],
  'updates:get': ['popover'],
  'updates:check': ['popover'],
  'updates:download': ['popover'],
  'updates:cancel': ['popover'],
  'updates:install': ['popover'],
  'notices:dismiss': ['popover'],
  'window:hide': ['popover']
}, ['state:get', 'updates:get']);

module.exports = { ipcRoutes };
