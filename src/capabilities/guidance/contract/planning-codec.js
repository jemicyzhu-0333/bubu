'use strict';
const { createCapabilityCodec } = require('../../../shared/ipc-validation');
const { describeRoutes } = require('../../../shared/ipc-routes');
const { preferenceInputValid } = require('../domain/planning-preferences');
const { TRIAL_PARAMETERS, exact, integer } = require('./planning-state');
function object(validation, keys) {
  const value = validation.requireObject();
  if (value) validation.rejectUnknown(value, keys);
  return value;
}
function ticket(validation) {
  const value = object(validation, ['previewId']);
  return value ? { previewId: validation.validateId(value.previewId, 'previewId') } : undefined;
}
function undo(validation, field) {
  const value = object(validation, [field, 'expectedVersion']);
  if (!value) return;
  if (!integer(value.expectedVersion, 1)) validation.fail('expectedVersion is invalid');
  return { [field]: validation.validateId(value[field], field), expectedVersion: value.expectedVersion };
}
const codec = createCapabilityCodec({
  'planning:get': validation => {
    if (validation.payload !== undefined && validation.payload !== null) validation.fail('payload must be empty');
    return undefined;
  },
  'planning:preview-cancel': validation => {
    const value = object(validation, ['kind', 'previewId']);
    if (!value) return;
    if (!exact(value, ['kind', 'previewId']) || !['preference', 'history', 'trial'].includes(value.kind)) validation.fail('preview kind is invalid');
    return { kind: value.kind, previewId: validation.validateId(value.previewId, 'previewId') };
  },
  'planning:proposal-preview': validation => {
    const value = object(validation, ['conversationId', 'proposalId', 'input', 'replacePreviewId']);
    if (!value) return;
    const result = { conversationId: validation.validateId(value.conversationId, 'conversationId'),
      proposalId: validation.validateId(value.proposalId, 'proposalId') };
    if (Object.hasOwn(value, 'input')) {
      if (!preferenceInputValid(value.input)) validation.fail('planning proposal input is invalid');
      result.input = value.input;
    }
    if (Object.hasOwn(value, 'replacePreviewId')) result.replacePreviewId = validation.validateId(value.replacePreviewId, 'replacePreviewId');
    return result;
  },
  'planning:preference-preview': validation => {
    const value = object(validation, ['id', 'startMinute', 'endMinute', 'demand', 'scope']);
    if (!value) return;
    if (!preferenceInputValid(value)) validation.fail('planning preference is invalid');
    return { id: value.id, startMinute: value.startMinute, endMinute: value.endMinute, demand: value.demand, scope: value.scope };
  },
  'planning:preference-confirm': ticket,
  'planning:preference-undo': validation => undo(validation, 'receiptId'),
  'planning:history-preview': validation => {
    const value = object(validation, ['enabled', 'clearHistory']);
    if (!value) return;
    if (!exact(value, ['enabled', 'clearHistory']) || typeof value.enabled !== 'boolean'
      || typeof value.clearHistory !== 'boolean') validation.fail('history consent is invalid');
    return { enabled: value.enabled, clearHistory: value.clearHistory };
  },
  'planning:history-confirm': ticket,
  'planning:trial-preview': validation => {
    const value = object(validation, ['parameter', 'to', 'scope']);
    if (!value) return;
    if (!exact(value, ['parameter', 'to', 'scope']) || !TRIAL_PARAMETERS.includes(value.parameter)
      || !Number.isInteger(value.to) || !['today', '7days'].includes(value.scope)) validation.fail('curve trial is invalid');
    return { parameter: value.parameter, to: value.to, scope: value.scope };
  },
  'planning:trial-confirm': ticket,
  'planning:trial-undo': validation => undo(validation, 'trialId')
});
const surfaces = Object.fromEntries(codec.channels.map(channel => [channel, ['popover']]));
module.exports = { ipcRoutes: describeRoutes('guidance', codec, surfaces, ['planning:get']) };
