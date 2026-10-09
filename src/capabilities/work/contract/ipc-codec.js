'use strict';

const { trimmedString } = require('../../../core/field-normalizers');
const { createCapabilityCodec, emptyPayload } = require('../../../shared/ipc-validation');
const { describeRoutes } = require('../../../shared/ipc-routes');
const { decodeOrganize, decodeInboxHistory, decodeKeepAll } = require('./inbox-codec');
const { decodeTaskInput, decodeTaskUpdate, decodeSeriesUpdate } = require('./task-input');

function objectId(validation) {
  const object = validation.requireObject();
  if (!object) return undefined;
  validation.rejectUnknown(object, ['id']);
  return { id: validation.validateId(object.id) };
}

function decodeHistory(validation) {
  const object = validation.payload === undefined || validation.payload === null ? {} : validation.requireObject();
  if (!object) return undefined;
  validation.rejectUnknown(object, ['cursor', 'limit', 'seriesId']);
  const cursor = object.cursor === undefined || object.cursor === null ? null : object.cursor;
  if (cursor !== null && (typeof cursor !== 'string' || !/^offset:\d+$/.test(cursor))) validation.fail('cursor is invalid');
  const limit = object.limit === undefined ? 30 : object.limit;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) validation.fail('limit must be an integer from 1 to 100');
  return { cursor, limit, seriesId: validation.validateTaskId(object.seriesId) };
}

const codec = createCapabilityCodec({
  'impulses:organize': decodeOrganize,
  'impulses:history': decodeInboxHistory,
  'impulses:keep-all': decodeKeepAll,
  'tasks:add': validation => decodeTaskInput(validation, false),
  'tasks:add-with-breakdown': validation => decodeTaskInput(validation, true),
  'tasks:update': decodeTaskUpdate,
  // 完成之后几秒内的撤销。参数只有一次性的凭据，撤销哪件事由主进程记着，渲染端指定不了。
  'tasks:undo-complete': validation => validation.validateId(validation.payload),
  'tasks:complete': validation => {
    const object = validation.requireObject();
    if (!object) return undefined;
    validation.rejectUnknown(object, ['id', 'confirmUnfinishedSteps']);
    const id = validation.validateId(object.id);
    if (object.confirmUnfinishedSteps !== undefined && typeof object.confirmUnfinishedSteps !== 'boolean') {
      validation.fail('confirmUnfinishedSteps must be boolean');
    }
    return { id, confirmUnfinishedSteps: object.confirmUnfinishedSteps === true };
  },
  'tasks:complete-step': validation => {
    const object = validation.requireObject();
    if (!object) return undefined;
    validation.rejectUnknown(object, ['taskId', 'stepId']);
    return {
      taskId: validation.validateId(object.taskId, 'taskId'),
      stepId: validation.validateId(object.stepId, 'stepId')
    };
  },
  'tasks:renew': validation => {
    const object = validation.requireObject();
    if (!object) return undefined;
    validation.rejectUnknown(object, ['id', 'expiresAt']);
    return { id: validation.validateId(object.id), expiresAt: validation.validateDateField(object.expiresAt, 'expiresAt') };
  },
  'series:update': decodeSeriesUpdate,
  'tasks:delete': validation => validation.validateId(validation.payload),
  'tasks:archive': validation => validation.validateId(validation.payload),
  'tasks:restore': validation => validation.validateId(validation.payload),
  'tasks:skip-occurrence': objectId,
  'tasks:duplicate': objectId,
  'history:list': decodeHistory,
  'impulses:add': validation => {
    const value = trimmedString(validation.payload, null, 500);
    if (!value || typeof validation.payload !== 'string' || validation.payload.trim().length > 500) {
      validation.fail('text must be a non-empty string of at most 500 characters');
    }
    return value;
  },
  'impulses:promote': validation => validation.validateId(validation.payload),
  'impulses:delete': validation => validation.validateId(validation.payload),
  // 把一条闪念留成只有自己看得到的情绪记录（同一笔事务里消费闪念）。
  'impulses:keep-mood': validation => validation.validateId(validation.payload),
  'impulses:review': validation => {
    const object = validation.requireObject();
    if (!object) return undefined;
    validation.rejectUnknown(object, ['id', 'action']);
    const id = validation.validateId(object.id);
    const action = object.action;
    if (!['delete', 'next-step', 'schedule', 'someday'].includes(action)) validation.fail('impulse review action is invalid');
    return { id, action };
  },
  'impulse:open': emptyPayload,
  'impulse:hide': emptyPayload,
  'pet:openImpulse': emptyPayload
});

const surfaces = Object.freeze({
  'impulses:organize': ['popover'],
  'impulses:history': ['popover'],
  'impulses:keep-all': ['popover'],
  'tasks:add': ['popover'],
  'tasks:add-with-breakdown': ['popover'],
  'tasks:update': ['popover', 'impulse'],
  'tasks:complete': ['popover', 'impulse'],
  'tasks:undo-complete': ['popover'],
  'tasks:complete-step': ['popover', 'impulse'],
  'tasks:renew': ['popover'],
  'series:update': ['popover'],
  'tasks:delete': ['popover'],
  'tasks:archive': ['popover'],
  'tasks:restore': ['popover'],
  'tasks:skip-occurrence': ['popover'],
  'tasks:duplicate': ['popover'],
  'history:list': ['popover'],
  'impulses:add': ['popover', 'impulse'],
  'impulses:promote': ['popover'],
  'impulses:delete': ['popover'],
  'impulses:keep-mood': ['popover'],
  'impulses:review': ['popover'],
  'impulse:open': ['popover'],
  'impulse:hide': ['impulse'],
  'pet:openImpulse': ['pet']
});

const ipcRoutes = describeRoutes('work', codec, surfaces, ['history:list', 'impulses:history']);

module.exports = { ipcRoutes };
