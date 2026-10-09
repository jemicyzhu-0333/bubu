import { t } from '../../shared/interface/i18n.mjs';
'use strict';

const COPY_KEYS = Object.freeze({
  'task.create': ['input'], 'task.update': ['entityId', 'scope', 'patch'],
  'task.steps': ['entityId', 'scope', 'steps'], 'inbox.convert-task': ['entityId', 'input'],
  'inbox.keep': ['entityId', 'classification'], 'routine.schedule': ['entityId', 'schedule']
});
const LABELS = Object.freeze({ title: '标题', description: '备注', tags: '标签（逗号分隔）',
  estimateMinutes: '估时（分钟）', plannedFor: '计划日' });

// Strip application-only IDs, versions and hashes before sending an edited
// candidate back through the closed application validator for a new preview.
function editableOperation(operation) {
  const keys = COPY_KEYS[operation.type];
  if (!keys) return null;
  return Object.fromEntries(['opId', 'type', ...keys].filter(key => operation[key] !== undefined)
    .map(key => [key, structuredClone(operation[key])]));
}
function editorMarkup(operation, escapeHTML, copy = (source, params = {}) => escapeHTML(t(source, params))) {
  const op = editableOperation(operation);
  if (!op) return '';
  const attr = field => `data-change-edit="${escapeHTML(op.opId)}" data-change-field="${field}"`;
  const input = (field, title, value, type = 'text', parameters = {}) => `<label class="chat-change-edit">${copy(title, parameters)}<input type="${type}" ${attr(field)} value="${escapeHTML(value ?? '')}"></label>`;
  const fields = op.input || op.patch;
  let markup = fields ? Object.keys(fields).filter(key => Object.hasOwn(LABELS, key)).map(key => input(key, LABELS[key],
    Array.isArray(fields[key]) ? fields[key].join(', ') : fields[key], key === 'plannedFor' ? 'date' : key === 'estimateMinutes' ? 'number' : 'text')).join('') : '';
  const steps = op.steps || op.input?.steps;
  if (steps) markup += steps.map((step, index) => input(`step:${index}`, step.op === 'rename' ? '改写步骤 {index}' : '新增步骤 {index}', step.title, 'text', { index: index + 1 })).join('');
  if (op.type === 'task.update' || op.type === 'task.steps') markup += `<label class="chat-change-edit">${copy('重复任务作用范围')}<select ${attr('scope')}>`
    + `<option data-change-option-copy="仅本次" value="current"${op.scope !== 'current-and-future' ? ' selected' : ''}>${t('仅本次')}</option>`
    + `<option data-change-option-copy="本次及以后" value="current-and-future"${op.scope === 'current-and-future' ? ' selected' : ''}>${t('本次及以后')}</option></select></label>`;
  if (op.type === 'inbox.keep') markup += `<label class="chat-change-edit">${copy('留存分类')}<select ${attr('category')}>`
    + [['unclassified', '未分类'], ['task', '要做的事'], ['note', '想法']].map(([key, title]) => `<option data-change-option-copy="${escapeHTML(title)}" value="${key}"${op.classification.category === key ? ' selected' : ''}>${t(title)}</option>`).join('') + '</select></label>';
  if (op.type === 'routine.schedule' && op.schedule) {
    markup += `<label class="chat-change-edit">${copy('重复范围')}<select ${attr('frequency')}>`
      + [['daily', '每天'], ['weekdays', '工作日'], ['weekly', '所选星期']].map(([key, title]) => `<option data-change-option-copy="${escapeHTML(title)}" value="${key}"${op.schedule.frequency === key ? ' selected' : ''}>${t(title)}</option>`).join('') + '</select></label>';
    markup += input('timesOfDay', '提醒时间（HH:MM，逗号分隔）', op.schedule.timesOfDay.join(', '));
    markup += input('weekdays', '星期（1–7，逗号分隔；仅所选星期时使用）', op.schedule.weekdays.join(', '));
    markup += input('windowMinutes', '提醒时间窗口（分钟）', op.schedule.windowMinutes, 'number');
  }
  return markup ? `<details class="chat-change-editor"><summary>${copy('编辑这项建议')}</summary>${markup}<p>${copy('编辑后需要重新查看差异，旧确认失效。')}</p></details>` : '';
}
function editOperation(operation, field, value) {
  const op = editableOperation(operation);
  if (!op || typeof value !== 'string') return null;
  const fields = op.input || op.patch;
  if (fields && Object.hasOwn(LABELS, field) && Object.hasOwn(fields, field)) {
    fields[field] = field === 'tags' ? value.split(/[,，]/).map(text => text.trim()).filter(Boolean)
      : field === 'estimateMinutes' ? (value === '' ? null : Number(value))
        : ['description', 'plannedFor'].includes(field) ? value.trim() || null : value.trim();
  } else if (/^step:\d+$/.test(field)) {
    const step = (op.steps || op.input?.steps)?.[Number(field.slice(5))];
    if (!step) return null;
    step.title = value.trim();
  } else if (field === 'scope' && ['task.update', 'task.steps'].includes(op.type)
    && ['current', 'current-and-future'].includes(value)) op.scope = value;
  else if (field === 'category' && op.type === 'inbox.keep'
    && ['unclassified', 'task', 'note'].includes(value)) op.classification.category = value;
  else if (op.type === 'routine.schedule' && op.schedule && ['frequency', 'timesOfDay', 'weekdays', 'windowMinutes'].includes(field)) {
    if (field === 'frequency') {
      if (!['daily', 'weekdays', 'weekly'].includes(value)) return null;
      op.schedule.frequency = value;
      if (value !== 'weekly') op.schedule.weekdays = [];
    } else if (field === 'timesOfDay') op.schedule.timesOfDay = value.split(/[,，]/).map(text => text.trim()).filter(Boolean);
    else if (field === 'weekdays') op.schedule.weekdays = value.split(/[,，]/).map(text => text.trim()).filter(Boolean).map(Number);
    else op.schedule.windowMinutes = Number(value);
  } else return null;
  return op;
}

export { editableOperation, editorMarkup, editOperation };
