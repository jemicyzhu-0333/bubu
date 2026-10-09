'use strict';

const KINDS = Object.freeze({ task: '任务', inbox: '收件原文', routine: '普通日常排程', memory: '已确认记忆' });
const FIELD = Object.freeze({ task: 'taskIds', inbox: 'inboxIds', routine: 'routineIds', memory: 'memoryIds' });
const empty = () => ({ taskIds: [], inboxIds: [], routineIds: [], memoryIds: [] });

// Local choices are not a grant and are never sent to a model by this feature.
// Only the application's renewed disclosure can authorize the next turn.
function createCollaborationContextSelection({ $, escapeHTML, surfaceClient, getConversation,
  isOpen, isBusy, onChange, onApply, status }) {
  let selection = empty(), accepted = empty(), dirty = false, epoch = 0, loading = false;
  let items = [], nextCursor = null, kind = 'task';
  const supported = typeof surfaceClient.getConversationContextChoices === 'function';
  const teardown = [];
  const node = id => $(`#${id}`);
  function summary() {
    const counts = Object.entries(FIELD).filter(([, field]) => selection[field].length)
      .map(([key, field]) => `${KINDS[key]} ${selection[field].length}`);
    if (node('draftChatScopeSelection')) node('draftChatScopeSelection').textContent = counts.length ? `已选：${counts.join(' · ')}` : '未选择额外内容';
    if (node('draftChatScopePending')) {
      node('draftChatScopePending').textContent = dirty ? '选择有变，更新预览后才可发送。' : '仅参考已选内容 · 今天';
    }
    if (node('btnDraftChatScopeApply')) node('btnDraftChatScopeApply').disabled = !dirty || isBusy();
  }
  function render() {
    const target = node('draftChatContextChoices');
    if (target) target.innerHTML = items.length ? items.map(item => {
      const unavailable = item.availability === 'unavailable' || item.selectable === false
        || kind === 'routine' && ['medication', 'stimulant', 'custom'].includes(item.kind);
      const selected = selection[FIELD[kind]].includes(item.id);
      return `<label class="chat-context-choice"><input type="checkbox" data-context-id="${escapeHTML(item.id)}"`
        + `${selected ? ' checked' : ''}${unavailable || isBusy() ? ' disabled' : ''}>`
        + `<span>${escapeHTML(item.title || item.text || item.subject || item.name || item.id)}`
        + `${item.textTruncated ? '<small>原文仅显示前 500 字；发送范围见本轮预览</small>' : ''}`
        + `${unavailable ? '<small>不在可选范围内</small>' : ''}</span></label>`;
    }).join('') : '<p class="chat-empty">暂无可选内容，可搜索或更换类别。</p>';
    node('btnDraftChatContextMore')?.classList.toggle('hidden', !nextCursor);
    summary();
  }
  function reset(record, actualSelection) {
    ++epoch; loading = false; dirty = false; items = []; nextCursor = null;
    selection = empty();
    if ((record?.relatedEntity?.kind || record?.relatedEntity?.type) === 'task') selection.taskIds = [record.relatedEntity.id];
    if (actualSelection) for (const field of Object.values(FIELD)) selection[field] = [...(actualSelection[field] || [])];
    accepted = structuredClone(selection);
    node('draftChatContextPicker')?.classList.toggle('hidden', !supported);
    render();
  }
  async function load({ more = false } = {}) {
    const record = getConversation();
    if (!supported || !record || isBusy() || loading || !isOpen()) return;
    const query = node('draftChatContextSearch')?.value?.trim() || '';
    if (Array.from(query).length > 200) { status('本机搜索最多 200 字；输入仍在。'); return; }
    const chosen = node('draftChatContextKind')?.value || 'task';
    if (!Object.hasOwn(FIELD, chosen)) return;
    const token = ++epoch; loading = true;
    if (!more || chosen !== kind) { items = []; nextCursor = null; }
    kind = chosen;
    try {
      const result = await surfaceClient.getConversationContextChoices({ conversationId: record.id, kind,
        ...(query ? { query } : {}), ...(more && nextCursor ? { cursor: nextCursor } : {}) });
      if (token !== epoch || getConversation()?.id !== record.id || !isOpen()) return;
      if (!result?.ok || ['unavailable', 'disabled'].includes(result.availability)) {
        items = []; nextCursor = null; render();
        status(result?.availability === 'disabled' ? '长期记忆已关闭，启用后可选择。' : '这类内容暂不可用，不能据此判断没有记录。'); return;
      }
      items = [...new Map([...items, ...(result.items || [])].map(item => [item.id, item])).values()];
      nextCursor = result.nextCursor || null; render();
      status('');
    } catch (_) { if (token === epoch && isOpen()) status('本机内容读取未完成，可以重试。'); }
    finally { if (token === epoch) loading = false; }
  }
  function toggle(id, checked) {
    if (isBusy() || !supported) return false;
    const item = items.find(value => value.id === id);
    if (!item || item.selectable === false || item.availability === 'unavailable'
      || kind === 'routine' && ['medication', 'stimulant', 'custom'].includes(item.kind)) return false;
    const values = new Set(selection[FIELD[kind]]);
    if (checked && values.size >= (kind === 'memory' ? 8 : 50) && !values.has(id)) {
      status(kind === 'memory' ? '每轮最多选择 8 条记忆，正文合计最多 1200 字。' : '每类最多选择 50 项，可以先取消一些条目。'); render(); return false;
    }
    if (checked) values.add(id); else values.delete(id);
    selection[FIELD[kind]] = [...values];
    dirty = JSON.stringify(selection) !== JSON.stringify(accepted);
    onChange(); render(); return true;
  }
  function applied(ok, actualSelection) {
    if (ok) {
      if (actualSelection) for (const field of Object.values(FIELD)) selection[field] = [...(actualSelection[field] || [])];
      accepted = structuredClone(selection); dirty = false;
    }
    else selection = structuredClone(accepted);
    if (!ok) dirty = true;
    render();
  }
  function listen(id, type, handler) {
    const target = node(id); if (!target) return;
    target.addEventListener(type, handler); teardown.push(() => target.removeEventListener(type, handler));
  }
  function mount() {
    listen('btnDraftChatContextSearch', 'click', () => void load());
    listen('btnDraftChatContextMore', 'click', () => void load({ more: true }));
    listen('draftChatContextKind', 'change', () => void load());
    listen('draftChatContextSearch', 'keydown', event => {
      if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); void load(); }
    });
    listen('draftChatContextChoices', 'change', event => {
      const target = event.target.closest?.('[data-context-id]');
      if (target) toggle(target.dataset.contextId, target.checked);
    });
    listen('btnDraftChatScopeApply', 'click', () => void onApply());
  }
  return Object.freeze({ mount, reset, load, toggle, applied, render,
    selection: () => supported ? structuredClone(selection) : {}, isDirty: () => dirty,
    invalidate: () => { ++epoch; loading = false; }, dispose: () => { ++epoch; while (teardown.length) teardown.pop()(); } });
}

export { createCollaborationContextSelection };
