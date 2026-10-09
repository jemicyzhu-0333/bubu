'use strict';

// ARCHITECTURE「事实流与长期记忆」: timeline:getDay is a read-only projection of one local day's stored
// events, for the gantt/timeline to render. Progress owns the timeline contract
// (it is the only capability that derives history); the timeline fact-store
// repository is injected in main.js. The channel is a query (no mutation) and
// takes a single required dayKey (local YYYY-MM-DD).

const { createCapabilityCodec } = require('../../../shared/ipc-validation');
const { describeRoutes } = require('../../../shared/ipc-routes');

const codec = createCapabilityCodec({
  'timeline:getDay': validation => {
    const object = validation.requireObject();
    if (!object) return undefined;
    validation.rejectUnknown(object, ['dayKey']);
    // validateDayKeyField treats null/empty as "no filter" and returns null; a
    // day view needs a concrete day, so an absent or malformed key is rejected.
    const dayKey = validation.validateDayKeyField(object.dayKey, 'dayKey');
    if (!dayKey) validation.fail('dayKey is required and must be a local YYYY-MM-DD date');
    return { dayKey };
  }
});

const surfaces = Object.fromEntries(codec.channels.map(channel => [channel, ['popover']]));
const ipcRoutes = describeRoutes('progress', codec, surfaces, ['timeline:getDay']);

module.exports = { ipcRoutes };
