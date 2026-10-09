'use strict';

const { ID_PATTERN } = require('../../../core/companion-state');
const { MAX_NATIVE_COORDINATE, numberInRange, nonNegativeInteger } = require('../../../core/field-normalizers');
const { createCapabilityCodec, emptyPayload } = require('../../../shared/ipc-validation');
const { describeRoutes } = require('../../../shared/ipc-routes');
const { FOOD_IDS, PET_STATES } = require('./constants');
const { AGENT_PLUGIN_TOOLS } = require('../../../content/agent-plugin');
const AGENT_PLUGIN_TOOL_IDS = AGENT_PLUGIN_TOOLS.map(tool => tool.id);
function decodePosition(validation, allowNull) {
  const object = validation.requireObject();
  if (!object) return undefined;
  validation.rejectUnknown(object, ['x', 'y']);
  for (const axis of ['x', 'y']) {
    const coordinate = object[axis];
    if (!((Number.isFinite(coordinate) && Math.abs(coordinate) <= MAX_NATIVE_COORDINATE)
        || (allowNull && (coordinate === null || coordinate === undefined)))) {
      validation.fail(`${axis} must be finite within ±${MAX_NATIVE_COORDINATE}${allowNull ? ' or null' : ''}`);
    }
  }
  return {
    x: object.x === null || object.x === undefined ? null : Math.round(object.x),
    y: object.y === null || object.y === undefined ? null : Math.round(object.y)
  };
}

function decodeFoodRequest(validation) {
  const object = validation.requireObject();
  if (!object) return undefined;
  validation.rejectUnknown(object, ['foodId', 'commandId', 'issuedAt']);
  if (!FOOD_IDS.includes(object.foodId)) validation.fail(`foodId must be one of: ${FOOD_IDS.join(', ')}`);
  if (!Number.isSafeInteger(object.issuedAt) || object.issuedAt < 0 || object.issuedAt > 8.64e15) validation.fail('issuedAt must be a non-negative safe integer');
  if (typeof object.commandId !== 'string' || object.commandId.length > 80
      || !/^[0-9]+-[a-zA-Z0-9_-]{1,50}$/.test(object.commandId)
      || !object.commandId.startsWith(`${object.issuedAt}-`)) validation.fail('commandId must bind issuedAt and nonce');
  return { foodId: object.foodId, commandId: object.commandId, issuedAt: object.issuedAt };
}

const codec = createCapabilityCodec({
  'skin:switch': validation => validation.validateId(validation.payload, 'skinId'),
  'pet:getBounds': emptyPayload,
  'pet:setPosition': validation => decodePosition(validation, true),
  'pet:savePosition': validation => decodePosition(validation, false),
  'pet:dragStart': emptyPayload,
  'pet:dragEnd': emptyPayload,
  'pet:updateRuntime': validation => {
    const object = validation.requireObject();
    if (!object) return undefined;
    const fields = ['visible', 'menuOpen', 'dragging', 'prefersReducedMotion'];
    validation.rejectUnknown(object, fields);
    for (const field of fields) {
      if (typeof object[field] !== 'boolean') validation.fail(`${field} must be boolean`);
    }
    return {
      visible: object.visible,
      menuOpen: object.menuOpen,
      dragging: object.dragging,
      prefersReducedMotion: object.prefersReducedMotion
    };
  },
  'pet:cueAck': validation => {
    const object = validation.requireObject();
    if (!object) return undefined;
    validation.rejectUnknown(object, ['decisionId', 'status']);
    if (typeof object.decisionId !== 'string' || !ID_PATTERN.test(object.decisionId)) {
      validation.fail('decisionId is invalid');
    }
    if (!['received', 'started', 'completed', 'cancelled', 'rejected'].includes(object.status)) {
      validation.fail('cue acknowledgement status is invalid');
    }
    return { decisionId: object.decisionId, status: object.status };
  },
  'pet:setMenuOpen': validation => {
    if (typeof validation.payload !== 'boolean') validation.fail('open must be boolean');
    return validation.payload;
  },
  'pet:getFeedState': emptyPayload,
  'pet:feed': decodeFoodRequest,
  'pet:buy-food': decodeFoodRequest,
  'pet:interaction': validation => {
    if (typeof validation.payload !== 'string'
        || !/^(fling|click-(3|5|10|20|50))$/.test(validation.payload)) {
      validation.fail('pet interaction is invalid');
    }
    return validation.payload;
  },
  'pet:getContent': emptyPayload,
  'pet:getContextualLine': validation => {
    const object = validation.requireObject();
    if (!object) return undefined;
    validation.rejectUnknown(object, ['hour', 'state', 'energyLevel', 'hoursIdle', 'workStart', 'workEnd']);
    return {
      hour: numberInRange(object.hour, 12, 0, 23.999),
      state: PET_STATES.includes(object.state) ? object.state : 'idle',
      energyLevel: numberInRange(object.energyLevel, 50, 0, 100),
      hoursIdle: numberInRange(object.hoursIdle, 0, 0, 24 * 365),
      workStart: numberInRange(object.workStart, 10, 0, 22, true),
      workEnd: numberInRange(object.workEnd, 21, 1, 24, true)
    };
  },
  'pet:getState': emptyPayload,
  'pet:setState': validation => {
    if (!PET_STATES.includes(validation.payload)) validation.fail('pet state is invalid');
    return validation.payload;
  },
  'pet:openPanel': emptyPayload,
  // Shape only, deliberately. Whether this group exists and whether the level and
  // the unlocked skins reach that item are judgments the catalog decides, and the
  // catalog belongs to the domain — the same split `skin:switch` already makes by
  // checking the id shape here and letting `select-skin` answer `skin-not-found`.
  //
  // `itemId: null` is a payload, not a missing field: it is how the wardrobe says
  // "take this group off", so it has to survive validation rather than be treated
  // as an omission.
  'appearance:equip': validation => {
    const object = validation.requireObject();
    if (!object) return undefined;
    validation.rejectUnknown(object, ['group', 'itemId']);
    const group = validation.validateId(object.group, 'group');
    const itemId = object.itemId === null ? null : validation.validateId(object.itemId, 'itemId');
    return { group, itemId };
  },
  'appearance:reset': emptyPayload,
  // Only a tool id crosses: the main process builds the install text it puts on the clipboard.
  'activity:copy-plugin-command': validation => {
    const object = validation.requireObject();
    if (!object) return undefined;
    validation.rejectUnknown(object, ['tool']);
    if (!AGENT_PLUGIN_TOOL_IDS.includes(object.tool)) validation.fail(`tool must be one of: ${AGENT_PLUGIN_TOOL_IDS.join(', ')}`);
    return { tool: object.tool };
  }
});

const surfaces = Object.fromEntries(codec.channels.map(channel => [channel, ['pet']]));
surfaces['skin:switch'] = ['popover'];
surfaces['appearance:equip'] = ['popover'];
surfaces['appearance:reset'] = ['popover'];
surfaces['pet:buy-food'] = ['popover'];
surfaces['activity:copy-plugin-command'] = ['popover'];
const ipcRoutes = describeRoutes('companion', codec, surfaces, [
  'pet:getBounds', 'pet:getFeedState', 'pet:getContent', 'pet:getContextualLine', 'pet:getState'
]);

module.exports = { ipcRoutes };
