import { t, getLocale } from '../../shared/interface/i18n.mjs';
'use strict';

const KIND_LABELS = Object.freeze({ rhythm: '节律', friction: '卡点', preference: '偏好', context: '背景', pattern: '完成模式' });
const SOURCE_LABELS = Object.freeze({ 'user-statement': '本人陈述', 'user-edit': '本人编辑或确认', deterministic: '由记录汇总',
  'model-proposed': '模型建议，尚未确认', 'legacy-import': '旧版导入，确认记录未知' });
const STATUS_LABELS = Object.freeze({ active: '有效', candidate: '待确认', paused: '暂停使用', removed: '已移除' });
const SCOPE_LABELS = Object.freeze({ global: '通用', work: '工作', personal: '个人' });
const OP_LABELS = Object.freeze({ add: '新增记忆', update: '修改记忆', activate: '确认并启用', pause: '暂停这条记忆', remove: '移到回收区', restore: '恢复为暂停使用', 'permanent-remove': '永久移除', undo: '撤销记忆修改' });
const FIELDS = Object.freeze({ subject: '主题', body: '内容', kind: '类别', status: '状态', scope: '适用范围', validFrom: '开始生效', expiresAt: '有效至', recycleUntil: '回收保留至', privacyLevel: '隐私范围', sourceType: '来源', confirmedAt: '本人确认时间' });
const TABS = Object.freeze({ active: 'memoryTabActive', candidate: 'memoryTabCandidate', paused: 'memoryTabPaused', removed: 'memoryTabRemoved' });
const date = value => Number.isFinite(value) ? new Date(value).toLocaleString(getLocale()) : t('无');
function shown(field, value) {
  if (value === null || value === undefined) return t(field === 'expiresAt' ? '不设到期' : '无');
  if (['validFrom', 'expiresAt', 'recycleUntil', 'confirmedAt'].includes(field)) return date(value);
  if (field === 'kind') return KIND_LABELS[value] ? t(KIND_LABELS[value]) : value;
  if (field === 'status') return STATUS_LABELS[value] ? t(STATUS_LABELS[value]) : value;
  if (field === 'scope') return SCOPE_LABELS[value] ? t(SCOPE_LABELS[value]) : value;
  if (field === 'sourceType') return t(SOURCE_LABELS[value] || '来源未知');
  if (field === 'privacyLevel') return t(value === 'sensitive' ? '敏感，仅在本机保留' : '普通');
  return String(value);
}

function createMemoryManagementView({ $, escapeHTML, now = () => Date.now() }) {
  const node = id => $(`#${id}`);
  const textCopies = new Map(), markupCopies = new Map();
  let region = '';
  const text = (id, value) => {
    const paint = () => { if (node(id)) node(id).textContent = typeof value === 'function' ? value() : t(value || ''); };
    textCopies.set(id, paint); paint();
  };
  const startRegion = id => { region = id; markupCopies.set(id, []); };
  const valueCopy = paint => {
    const copies = markupCopies.get(region), index = copies.length; copies.push(paint);
    return `<span data-memory-copy="${index}">${escapeHTML(paint())}</span>`;
  };
  const copy = (source, parameters = {}) => valueCopy(() => t(source, typeof parameters === 'function' ? parameters() : parameters));
  function repaintCopy() {
    textCopies.forEach(paint => paint());
    node('memoryList')?.querySelectorAll('.memory-meta summary').forEach(summary => { summary.textContent = t('来源与使用记录'); });
    markupCopies.forEach((copies, id) => node(id)?.querySelectorAll('[data-memory-copy]').forEach(target => {
      const paint = copies[Number(target.dataset.memoryCopy)]; if (paint) target.textContent = paint();
    }));
  }
  const hide = (id, hidden) => node(id)?.classList.toggle('hidden', hidden);
  function row(memory, disabled) {
    const recycleExpired = memory.status === 'removed' && Number.isFinite(memory.recycleUntil) && memory.recycleUntil <= now();
    const button = (operation, label) => `<button type="button" class="chip chip-action" data-memory-action="${operation}" data-memory-id="${escapeHTML(memory.id)}" data-memory-version="${memory.version}"${disabled || recycleExpired && operation !== 'permanent-remove' ? ' disabled' : ''}>${copy(label)}</button>`;
    const actions = memory.status === 'removed' ? button('restore', '查看恢复差异') + button('permanent-remove', '永久移除…')
      : button('edit', '修改') + (memory.status === 'active' ? button('pause', '暂停这条记忆') : button('activate', memory.status === 'candidate' ? '核对并确认' : '恢复使用')) + button('remove', '移到回收区');
    return `<article class="memory-row" data-memory="${escapeHTML(memory.id)}"><div class="memory-row-head"><span class="memory-kind">${copy(KIND_LABELS[memory.kind] || '未知类别')}</span>`
      + `<strong class="memory-subject">${escapeHTML(memory.subject)}</strong></div>`
      + `<p class="memory-body">${recycleExpired || memory.retentionCleanupPending ? copy('保留期已到，等待完成清理') : escapeHTML(memory.body)}</p>`
      + `<p class="memory-meta">${copy(SOURCE_LABELS[memory.sourceType] || '来源未知')} · ${copy(SCOPE_LABELS[memory.scope] || '范围未知')} · ${copy(memory.privacyLevel === 'sensitive' ? '仅本机' : '普通')}</p>`
      + (Number.isFinite(memory.expiresAt) ? `<p class="memory-meta">${copy('有效至：{expiry}', () => ({ expiry: date(memory.expiresAt) }))}</p>` : '')
      + `<details class="memory-meta"><summary>${t('来源与使用记录')}</summary>`
      + `<p>${copy('版本 {version}', { version: memory.version })}</p>`
      + `<p class="memory-meta">${copy('最近使用：{used} · 有效至：{expiry}', () => ({ used: memory.lastUsedAt === null ? t('尚无使用记录') : date(memory.lastUsedAt), expiry: memory.expiresAt === null ? t('不设到期') : date(memory.expiresAt) }))}</p>`
      + `<p class="memory-meta">${copy('来源引用：{sources}', () => ({ sources: (memory.sourceRefs || []).map(ref => `${ref.kind}:${ref.id}`).join('、') || t('未提供') }))}</p></details>`
      + (memory.conflictIds?.length ? `<p class="memory-conflict">${copy('与 {ids} 有冲突，暂不用于模型上下文。', { ids: memory.conflictIds.join('、') })}</p>` : '')
      + (memory.contextAllowed === false && !memory.conflictIds?.length ? `<p class="memory-note">${copy('当前不用于对话。')}</p>` : '')
      + (memory.status === 'removed' ? `<p class="memory-note">${copy('已停止使用，正文仍留在本机回收区。')}${Number.isFinite(memory.recycleUntil)
        ? copy('回收保留至 {expiry}（30 天）；{effect}', () => ({ expiry: date(memory.recycleUntil), effect: t(recycleExpired ? '期限已过，永久清理待完成，不能再恢复。涉及其他关联记忆时，需要另行核对扩大后的永久移除范围。' : '到期后自动永久清理本条；涉及其他关联记忆时，扩大范围需另行确认。') }))
        : copy('回收期限尚未确认；永久移除另行核对。')}</p>` : '')
      + `<div class="memory-actions">${actions}</div></article>`;
  }
  function list({ items, status, loaded, unavailable, nextCursor, busy, blocked }) {
    startRegion('memoryList');
    for (const [key, id] of Object.entries(TABS)) {
      node(id)?.setAttribute('aria-selected', String(status === key));
      if (node(id)) node(id).tabIndex = status === key ? 0 : -1;
    }
    node('memoryList')?.setAttribute('aria-labelledby', TABS[status]);
    text('memoryCount', () => unavailable ? t('暂不可用') : loaded ? t('{count} 条{more}', { count: items.length, more: nextCursor ? t(' · 还有更多') : '' }) : '');
    if (node('memoryList')) node('memoryList').innerHTML = unavailable ? `<p class="memory-empty">${copy('本机记忆库暂不可用；不能据此判断没有记忆。')}</p>`
      : !loaded ? `<p class="memory-empty">${copy('展开这一组时读取本机记录。')}</p>`
        : items.length ? items.map(item => row(item, busy || blocked)).join('') : `<p class="memory-empty">${copy('暂无{status}的记忆。', () => ({ status: t(STATUS_LABELS[status]) }))}</p>`;
    hide('btnMoreMemories', !nextCursor);
    for (const id of ['btnMoreMemories', 'btnNewMemory', 'btnRememberMemory']) if (node(id)) node(id).disabled = busy || blocked || unavailable;
    node('memoryList')?.setAttribute('aria-busy', String(busy));
  }
  function review(preview, { busy, acknowledge, blocked } = {}) {
    startRegion('memoryReviewContent');
    hide('memoryReview', !preview);
    if (!preview) {
      if (node('memoryReviewContent')) node('memoryReviewContent').innerHTML = '';
      if (node('btnConfirmMemoryChange')) node('btnConfirmMemoryChange').disabled = true;
      if (node('btnCancelMemoryChange')) node('btnCancelMemoryChange').disabled = true;
      return;
    }
    const changes = Object.entries(FIELDS).filter(([field]) => JSON.stringify(preview.before?.[field]) !== JSON.stringify(preview.after?.[field]));
    text('memoryReviewTitle', OP_LABELS[preview.operation] || '记忆变更核对');
    if (node('memoryReviewContent')) node('memoryReviewContent').innerHTML = `<p>${copy('目标：{id} · {version}', () => ({ id: preview.before?.id || preview.after?.id || '', version: preview.expectedVersion === null ? t('新增') : t('当前版本 {version}', { version: preview.expectedVersion }) }))}</p>`
      + `<p>${copy('尚未提交；只有核对后的确认会保存。')}</p><dl class="memory-diff">`
      + changes.map(([field, title]) => `<div><dt>${copy(title)}</dt><dd>${copy('原来')}<pre>${valueCopy(() => preview.before ? shown(field, preview.before[field]) : t('无此记忆'))}</pre></dd><dd>${copy('变为')}<pre>${valueCopy(() => preview.after ? shown(field, preview.after[field]) : t('移除'))}</pre></dd></div>`).join('') + '</dl>'
      + `<p>${copy('影响的记忆：{ids}', () => ({ ids: (preview.affectedIds || []).join('、') || t('无') }))}</p>`
      + `<p>${copy('来源引用：{sources}', () => ({ sources: (preview.after?.sourceRefs || preview.before?.sourceRefs || []).map(ref => `${ref.kind}:${ref.id}`).join('、') || t('未提供；不推断来源') }))}</p>`
      + `<p>${copy('停止用于上下文的来源：{sources}', () => ({ sources: (preview.invalidatedSourceRefs || []).map(ref => `${ref.kind}:${ref.id}`).join('、') || t('无') }))}</p>`
      + (preview.operation === 'remove' ? `<p>${copy('回收区保留 30 天，至 {expiry}。到期后将自动永久清理本条及其旧版本，无法撤销；若同一来源关联其他记忆或派生内容，将暂停清理并另行核对扩大后的范围。已发送给外部模型服务商的副本不在清理范围内。', () => ({ expiry: Number.isFinite(preview.after?.recycleUntil) ? date(preview.after.recycleUntil) : t('期限尚未确认') }))}</p>` : '')
      + `<p>${preview.undoExpiresAt && !preview.permanent ? copy('可申请撤销至 {expiry}；撤销前仍会核对版本。', () => ({ expiry: date(preview.undoExpiresAt) })) : copy('此操作不提供撤销。')}</p>`;
    hide('memoryPermanentNotice', !preview.permanent);
    text('btnConfirmMemoryChange', preview.permanent ? '确认永久移除这些内容' : preview.operation === 'undo' ? '确认这次撤销' : '确认以上变更');
    if (node('btnConfirmMemoryChange')) node('btnConfirmMemoryChange').disabled = busy || blocked || preview.permanent && !acknowledge;
    if (node('btnCancelMemoryChange')) node('btnCancelMemoryChange').disabled = busy || blocked;
  }
  function receipt(value, { historyStatus, undoAvailable, blocked } = {}) {
    hide('memoryReceipt', !value);
    if (!value) return;
    text('memoryReceiptText', () => t('已收到本机提交回执 {receipt} · {operation} · {status}', { receipt: value.receiptId, operation: t(OP_LABELS[value.operation] || '记忆修改'), status: t(historyStatus === 'pending' ? '时间线记录待同步' : historyStatus === 'synced' ? '时间线已同步' : '时间线同步状态未知') }));
    hide('btnUndoMemoryChange', !undoAvailable || blocked);
    hide('btnRefreshMemoryReceipt', false);
  }
  return Object.freeze({ list, review, receipt, text, hide, repaintCopy });
}

export { createMemoryManagementView, KIND_LABELS, SOURCE_LABELS, STATUS_LABELS, TABS };
