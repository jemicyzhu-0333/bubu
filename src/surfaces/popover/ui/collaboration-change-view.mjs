import { t } from '../../shared/interface/i18n.mjs';
'use strict';

import { editorMarkup } from './collaboration-change-edit.mjs';

const OP_LABELS = Object.freeze({ 'task.create': '新建任务', 'task.update': '修改任务', 'task.steps': '修改未完成步骤',
  'inbox.convert-task': '收件转任务', 'inbox.keep': '收件留存', 'routine.schedule': '普通日常排程',
  'task.restore': '撤销任务修改', 'routine.restore-schedule': '撤销日常排程' });
const FIELD_LABELS = Object.freeze({ title: '标题', description: '备注', steps: '步骤', tags: '标签', estimateMinutes: '估时（分钟）',
  plannedFor: '计划日', energy: '任务能量', energyAuto: '自动能量', suggestedMin: '建议时长', estimateSource: '估时来源',
  nextAction: '下一动作', stepTitles: '后续任务步骤', classification: '分类', resolution: '去向', energySignalIds: '相关能量信号', schedule: '提醒排程' });
const UNDO_REASONS = Object.freeze({ 'creation-not-reversible': '新建任务不支持从此处撤销',
  'inbox-consumption-not-reversible': '收件处理不支持从此处撤销', 'no-change': '没有变化', 'compensation-not-reversible': '撤销操作不提供再次撤销' });
const display = value => value === null || value === undefined ? t('无') : typeof value === 'string' ? value : JSON.stringify(value, null, 2);

function createCollaborationChangeView({ $, escapeHTML }) {
  const textCopies = new Map();
  let markupCopies = [];
  const text = (id, value) => {
    const paint = () => { const node = $(`#${id}`); if (node) node.textContent = t(value || ''); };
    textCopies.set(id, paint); paint();
  };
  const copy = (source, parameters = {}) => {
    const index = markupCopies.length;
    const paint = () => t(source, typeof parameters === 'function' ? parameters() : parameters);
    markupCopies.push(paint);
    return `<span data-change-copy="${index}">${escapeHTML(paint())}</span>`;
  };
  function repaintCopy() {
    textCopies.forEach(paint => paint());
    $('#draftChatChangeCards')?.querySelectorAll('[data-change-option-copy]').forEach(node => { node.textContent = t(node.dataset.changeOptionCopy); });
    $('#draftChatChangeCards')?.querySelectorAll('[data-change-copy]').forEach(node => {
      const paint = markupCopies[Number(node.dataset.changeCopy)];
      if (paint) node.textContent = paint();
    });
  }
  function diffMarkup(diff) {
    return (diff || []).map(row => {
      const fields = (rows, derived) => rows?.length ? `${derived ? `<p class="chat-change-derived">${copy('随此操作一起变化')}</p>` : ''}<dl class="chat-change-diff">`
        + rows.map(field => `<div><dt>${FIELD_LABELS[field.field] ? copy(FIELD_LABELS[field.field]) : escapeHTML(field.field)}</dt>`
          + `<dd>${copy('原来')}<pre>${field.before == null ? copy('无') : escapeHTML(display(field.before))}</pre></dd>`
          + `<dd>${copy('变为')}<pre>${field.after == null ? copy('无') : escapeHTML(display(field.after))}</pre></dd></div>`).join('') + '</dl>' : '';
      return `<section class="chat-change-target"><p>${escapeHTML(row.entityRef?.kind || '')} · ${escapeHTML(row.entityRef?.id || '')}</p>`
        + fields(row.fields, false) + fields(row.derivedChanges, true)
        + `<p class="chat-change-note">${copy(row.reversibility?.status === 'available' ? '撤销前会重新核对当前版本' : UNDO_REASONS[row.reversibility?.reason] || '此项不提供撤销')}</p></section>`;
    }).join('');
  }
  function render({ changeSet, operations, excluded, dirty, busy, receipt, historyStatus, durability, undoAvailable, message, uncertain, invalid }) {
    markupCopies = [];
    const panel = $('#draftChatChanges');
    if (!panel) return;
    panel.classList.toggle('hidden', !changeSet && !receipt && !message);
    text('draftChatChangeStatus', message);
    text('draftChatChangeTitle', receipt && durability === 'unconfirmed' ? '修改的保存状态待核对'
      : receipt ? (receipt.revertsReceiptId ? '已提交撤销' : receipt.status === 'reverted' ? '这次修改已撤销' : '已确认的修改') : changeSet?.revertsReceiptId ? '撤销前核对' : '变更前核对');
    const content = $('#draftChatChangeCards');
    if (content) {
      if (receipt) content.innerHTML = `<p>${copy('回执 {receipt} · 提交版本 {revision}', { receipt: receipt.receiptId, revision: Number(receipt.appliedRevision) })}</p>`
        + `<p>${copy(durability === 'unconfirmed' ? '变更已落入本机状态；持久保存尚未确认，时间线记录待同步。' : historyStatus === 'pending' ? '修改已提交，时间线记录待同步。重试同步不会再次执行修改。' : historyStatus === 'synced' ? '修改已提交，时间线记录已同步。' : '修改已提交，时间线同步状态尚未确认。')}</p>`
        + (receipt.details ? diffMarkup(receipt.details.diff) : `<p>${copy('详细内容已到期或移除，保留提交记录。')}</p>`)
        + (!undoAvailable || !receipt.details?.undo || receipt.status === 'reverted' ? `<p>${copy('这次修改目前无法撤销。')}</p>` : '');
      else if (changeSet) content.innerHTML = `<p>${copy('{status} · 版本 {version}', () => ({ status: t(uncertain ? '提交结果待核对' : '待确认'), version: Number(changeSet.proposalVersion) }))}</p>`
        + (changeSet.rationale ? `<p>${copy('建议原因：{reason}', { reason: changeSet.rationale })}</p>` : '')
        + `<p>${copy('来源：{sources}', () => ({ sources: (changeSet.evidenceRefs || []).map(ref => `${ref.kind}:${ref.id}${ref.revision ? `@${ref.revision}` : ''}`).join('、') || t('未提供额外来源') }))}</p>`
        + (changeSet.warnings || []).map(warning => `<p class="chat-change-warning">${escapeHTML(warning)}</p>`).join('')
        + (operations || []).map(op => `<section class="chat-change-operation${op.type.startsWith('routine.') ? ' chat-change-routine' : ''}" data-change-op="${escapeHTML(op.opId)}">`
          + `<label class="chat-check"><input type="checkbox" data-change-select="${escapeHTML(op.opId)}"${excluded.has(op.opId) ? '' : ' checked'}${busy || changeSet.revertsReceiptId ? ' disabled' : ''}>${OP_LABELS[op.type] ? copy(OP_LABELS[op.type]) : escapeHTML(op.type)}</label>`
          + (op.type.startsWith('routine.') ? `<p>${copy('时区：{timezone}。仅调整将来提醒，不改变已发生记录。', () => ({ timezone: op.timezone || changeSet.operations.find(item => item.opId === op.opId)?.timezone || t('未知') }))}</p>` : '')
          + diffMarkup(changeSet.diff.filter(row => row.opId === op.opId))
          + (!busy && !uncertain && !changeSet.revertsReceiptId ? editorMarkup(op, escapeHTML, copy) : '') + '</section>').join('');
      else content.innerHTML = '';
    }
    const show = (id, visible, disabled = false) => { const button = $(`#${id}`); if (button) { button.classList.toggle('hidden', !visible); button.disabled = disabled; } };
    show('btnDraftChatChangePreview', Boolean(changeSet && !receipt && (dirty || invalid) && !changeSet.revertsReceiptId), busy);
    show('btnDraftChatChangeConfirm', Boolean(changeSet && !receipt && !dirty && !invalid && !uncertain), busy);
    text('btnDraftChatChangeConfirm', changeSet?.revertsReceiptId ? '确认这次撤销' : '确认以上修改');
    show('btnDraftChatChangeRetry', Boolean(uncertain && (!receipt || durability === 'unconfirmed')), busy);
    text('btnDraftChatChangeRetry', durability === 'unconfirmed' ? '核对保存结果' : '核对提交结果');
    show('btnDraftChatChangeCancel', Boolean(changeSet && !receipt && !uncertain), busy);
    show('btnDraftChatReceiptRefresh', Boolean(receipt), busy);
    show('btnDraftChatUndo', Boolean(undoAvailable && receipt?.details?.undo && receipt.status === 'applied' && !receipt.revertsReceiptId), busy);
    $('#draftChatChanges')?.setAttribute('aria-busy', String(busy));
  }
  return Object.freeze({ render, repaintCopy, text });
}

export { createCollaborationChangeView };
