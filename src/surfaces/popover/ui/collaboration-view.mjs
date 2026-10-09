import { t, getLocale } from '../../shared/interface/i18n.mjs';
'use strict';

const MODE_LABELS = Object.freeze({ talk: '先聊聊', 'small-step': '找一个小动作', plan: '一起安排' });

// Original, decorative vector marks. Text labels, not the avatar, identify roles.
const CHAT_AVATARS = Object.freeze({
  assistant: '<svg viewBox="0 0 32 32" width="28" height="28" fill="none" aria-hidden="true" focusable="false"><path d="M6 22c-2-8 2-16 10-16s12 8 10 16c-1 4-6 5-10 5S7 26 6 22Z" fill="currentColor" fill-opacity=".12" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="17" r="1.5" fill="currentColor"/><circle cx="20" cy="17" r="1.5" fill="currentColor"/><path d="M13 22q3 2 6 0M16 3v3M14 3h4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  user: '<svg viewBox="0 0 32 32" width="28" height="28" fill="none" aria-hidden="true" focusable="false"><rect x="3" y="3" width="26" height="26" rx="9" fill="currentColor" fill-opacity=".08" stroke="currentColor" stroke-width="1.5"/><circle cx="16" cy="12" r="4" stroke="currentColor" stroke-width="1.6"/><path d="M9 25v-2a7 7 0 0 1 14 0v2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>'
});

function taskDraftFromMessage(message) {
  const ref = message && message.proposal;
  if (!ref || ref.kind !== 'task-draft' || typeof ref.body !== 'string') return null;
  try {
    const body = JSON.parse(ref.body);
    return body && typeof body === 'object' && typeof body.title === 'string' ? body : null;
  } catch (_) { return null; }
}

function changeCandidateFromMessage(message) {
  if (message?.proposal?.kind !== 'change-set' || typeof message.proposal.body !== 'string') return null;
  try {
    const value = JSON.parse(message.proposal.body);
    return value && Array.isArray(value.operations) ? value : null;
  } catch (_) { return null; }
}

function memoryCandidateFromMessage(message) {
  if (message?.proposal?.kind !== 'memory-candidate' || typeof message.proposal.body !== 'string') return null;
  try {
    const value = JSON.parse(message.proposal.body)?.memoryCandidate;
    return value && typeof value.subject === 'string' && typeof value.body === 'string' ? value : null;
  } catch (_) { return null; }
}
function memoryChangeFromMessage(message) {
  if (message?.proposal?.kind !== 'memory-candidate' || typeof message.proposal.body !== 'string') return null;
  try {
    const body = JSON.parse(message.proposal.body), value = body?.memoryChange;
    if (!value || Object.keys(body).length !== 1 || typeof value.id !== 'string' || !/^[a-zA-Z0-9_.:-]{1,200}$/.test(value.id)) return null;
    if (value.operation === 'forget' && Object.keys(value).every(key => ['operation', 'id'].includes(key))) return value;
    const input = value.input;
    return value.operation === 'update' && Object.keys(value).every(key => ['operation', 'id', 'input'].includes(key))
      && input && Object.keys(input).length === 5 && Object.keys(input).every(key => ['kind', 'subject', 'body', 'scope', 'expiresAt'].includes(key))
      && ['rhythm', 'friction', 'preference', 'context', 'pattern'].includes(input.kind)
      && typeof input.subject === 'string' && input.subject.trim() && [...input.subject].length <= 200
      && typeof input.body === 'string' && input.body.trim() && [...input.body].length <= 500
      && ['global', 'work', 'personal'].includes(input.scope)
      && (input.expiresAt === null || Number.isSafeInteger(input.expiresAt) && input.expiresAt >= 0 && input.expiresAt <= 8.64e15) ? value : null;
  } catch (_) { return null; }
}
function planningCandidateFromMessage(message) {
  if (message?.proposal?.kind !== 'planning-preference-candidate' || typeof message.proposal.body !== 'string') return null;
  try {
    const value = JSON.parse(message.proposal.body)?.planningPreference;
    return value && Number.isInteger(value.startMinute) && Number.isInteger(value.endMinute)
      && value.startMinute >= 0 && value.endMinute <= 1440 && value.endMinute > value.startMinute
      && ['low', 'medium', 'high'].includes(value.demand) && ['today', '7days', 'saved'].includes(value.scope) ? value : null;
  } catch (_) { return null; }
}

// This view renders canonical messages, including every inert proposal version.
// It never turns model text into markup, commands, task state or success receipts.
function createCollaborationView({ $, escapeHTML, fallbackReasonText = () => '' }) {
  const PAGE_SIZE = 200;
  let historyId = null, start = 0, end = 0, previousCount = 0, latestRecord = null, latestSelected = null;
  const historyWindows = new Map();
  let listedSessions = null, listedCursor = null;
  let currentPage = 'detail';
  let proposalStates = new Map();
  const textCopies = new Map(), markupCopies = new Map();
  let region = '';
  const text = (selector, value, { raw = false } = {}) => {
    const paint = () => { const next = typeof value === 'function' ? value() : raw ? value : t(value || '');
      const node = $(selector); if (node) node.textContent = next || ''; return next; };
    textCopies.set(selector, paint); return paint();
  };
  const startRegion = selector => { region = selector; markupCopies.set(selector, []); };
  const register = paint => { const copies = markupCopies.get(region), index = copies.length; copies.push(paint); return index; };
  const leaf = (tag, attributes, paint) => `<${tag} data-chat-copy="${register(paint)}" ${attributes}>${escapeHTML(paint())}</${tag}>`;
  const copyValue = paint => `<span data-chat-copy="${register(paint)}">${escapeHTML(paint())}</span>`;
  const copy = (source, parameters = {}) => copyValue(() => t(source, typeof parameters === 'function' ? parameters() : parameters));
  const copyAria = (source, parameters = {}) => {
    const paint = () => t(source, typeof parameters === 'function' ? parameters() : parameters);
    return `data-chat-copy-aria="${register(paint)}" aria-label="${escapeHTML(paint())}"`;
  };
  function repaintCopy() {
    textCopies.forEach(paint => paint());
    $('#draftChatLog')?.querySelectorAll?.('details.chat-proposal-note > summary').forEach(node => { node.textContent = t('记录详情'); });
    markupCopies.forEach((copies, selector) => {
      $(selector)?.querySelectorAll?.('[data-chat-copy]').forEach(node => {
        const paint = copies[Number(node.dataset.chatCopy)]; if (paint) node.textContent = paint();
      });
      $(selector)?.querySelectorAll?.('[data-chat-copy-aria]').forEach(node => {
        const paint = copies[Number(node.dataset.chatCopyAria)]; if (paint) node.setAttribute('aria-label', paint());
      });
    });
  }
  const hidden = (selector, value) => { const node = $(selector); if (node) node.classList.toggle('hidden', value); };
  const value = (selector, next) => { const node = $(selector); if (node) node.value = next; };
  function showPage(name = 'detail', { focus = true } = {}) {
    if (!['detail', 'list', 'settings'].includes(name)) return;
    currentPage = name;
    if ($('#draftChatMask')) $('#draftChatMask').dataset.chatPage = name;
    hidden('#draftChatDetail', name !== 'detail');
    hidden('#draftChatComposeShell', name !== 'detail');
    hidden('#draftChatLibrary', name !== 'list');
    hidden('#draftChatSettings', name !== 'settings');
    hidden('#btnDraftChatBack', name === 'detail');
    hidden('#draftChatPageActions', name !== 'detail');
    text('#draftChatTitle', name === 'list' ? '对话' : name === 'settings' ? '对话设置'
      : latestRecord?.purpose === 'stuck' ? '一起理一理' : 'AI 协作');
    hidden('#draftChatSessionTitle', name !== 'detail');
    if (focus) $(name === 'detail' ? '#draftChatInput' : name === 'list' ? '#btnDraftChatNew' : '#draftChatMode')?.focus();
  }
  function status(message = '') {
    const shown = text('#draftChatStatus', message);
    hidden('#draftChatStatus', !shown);
  }
  function busy(on) {
    for (const selector of ['#btnDraftChatSend', '#draftChatInput', '#draftChatRetention',
      '#draftChatRetentionDays', '#draftChatPinned', '#draftChatFocusSummary', '#btnDraftChatNew',
      '#btnDraftChatList', '#btnDraftChatSettings', '#btnDraftChatRefresh', '#btnDraftChatMore', '#btnDraftChatAdopt', '#draftChatMode']) {
      const node = $(selector);
      if (node) node.disabled = on;
    }
    text('#btnDraftChatSend', on ? '正在生成…' : '发送');
    hidden('#btnDraftChatCancel', !on);
    $('#draftChatLog')?.setAttribute('aria-busy', String(on));
  }
  function draft(input, selected) {
    value('#draftChatInput', input);
    const count = Array.from(input || '').length;
    text('#draftChatInputCount', () => t('{count} / 8,000 字', { count }));
    const button = $('#btnDraftChatAdopt');
    if (button) button.dataset.proposalId = selected || '';
  }
  function sourceMarkup(message) {
    if (message.role !== 'assistant' || message.provenance?.source !== 'local') return '';
    const reason = message.provenance.reason;
    return leaf('p', 'class="chat-turn-source" data-chat-source="local"', () => t('本地模板')
      + (reason ? ` · ${fallbackReasonText(reason)}` : ''));
  }
  function proposalMarkup(message, selected, purpose) {
    const body = taskDraftFromMessage(message);
    const ref = message.proposal;
    const candidate = changeCandidateFromMessage(message);
    const memory = memoryCandidateFromMessage(message);
    const memoryChange = memoryChangeFromMessage(message);
    const planning = planningCandidateFromMessage(message);
    const state = proposalStates.get(ref?.id);
    const stateMarkup = ref ? proposalStatusMarkup(ref.id, state) : '';
    const reviewed = state && ['applied', 'reverted', 'removed'].includes(state.status);
    if (memoryChange) return `<section class="chat-proposal" ${copyAria('待核对的记忆变更建议')}><p class="chat-proposal-version">${copy('{kind} · 版本 {version}', () => ({ kind: t(memoryChange.operation === 'forget' ? '永久遗忘建议' : '记忆修改建议'), version: Number(ref.version) || 1 }))}</p>`
      + `<p>${copy('目标记忆：{id}', { id: memoryChange.id })}</p>`
      + (memoryChange.input ? `<h3>${escapeHTML(memoryChange.input.subject)}</h3><p>${escapeHTML(memoryChange.input.body)}</p>` : '')
      + `<p class="chat-proposal-note">${copy(memoryChange.operation === 'forget' ? '核对原文、关联来源和全部影响范围后，永久遗忘需单独确认，无法撤销。' : '核对当前内容与差异，确认后更新原条目。')}</p>`
      + stateMarkup + `<button type="button" class="pixel-btn btn-mini" data-chat-memory="${escapeHTML(ref.id)}">${copy(reviewed ? '核对记录' : memoryChange.operation === 'forget' ? '核对永久遗忘范围' : '核对记忆修改')}</button></section>`;
    if (planning) {
      const time = minute => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
      const demand = { low: '轻一些的事', medium: '一般难度的事', high: '需要更多投入的事' }[planning.demand];
      const scope = { today: '今天', '7days': '七天', saved: '保存为偏好' }[planning.scope];
      return `<section class="chat-proposal" ${copyAria('待核对的安排建议')}><p class="chat-proposal-version">${copy('安排建议 · 版本 {version}', { version: Number(ref.version) || 1 })}</p>`
        + `<p>${time(planning.startMinute)}–${time(planning.endMinute)} · ${copy(demand)} · ${copy(scope)}</p>`
        + `<p class="chat-proposal-note">${copy('可编辑并单独确认，不改变自评或能量曲线。')}</p>`
        + stateMarkup + `<button type="button" class="pixel-btn btn-mini" data-chat-planning="${escapeHTML(ref.id)}">${copy(reviewed ? '核对记录' : '核对安排建议')}</button></section>`;
    }
    if (memory) return `<section class="chat-proposal" ${copyAria('待核对的记忆建议')}><p class="chat-proposal-version">${copy('记忆建议 · 版本 {version}', { version: Number(ref.version) || 1 })}</p>`
      + `<h3>${escapeHTML(memory.subject)}</h3><p>${escapeHTML(memory.body)}</p>`
      + `<p class="chat-proposal-note">${copy('内容、范围和有效期确认后才保存。')}</p>`
      + stateMarkup + `<button type="button" class="pixel-btn btn-mini" data-chat-memory="${escapeHTML(ref.id)}">${copy(reviewed ? '核对记录' : '核对记忆建议')}</button></section>`;
    if (candidate) return `<section class="chat-proposal" ${copyAria('变更建议版本 {version}', { version: Number(ref.version) || 1 })}>`
      + `<p class="chat-proposal-version">${copy('变更建议 · 版本 {version}', { version: Number(ref.version) || 1 })}</p>`
      + `<p>${copy('{count} 项建议，查看差异后确认。', { count: candidate.operations.length })}</p>`
      + stateMarkup + `<button type="button" class="pixel-btn btn-mini" data-chat-change="${escapeHTML(ref.id)}">${copy(reviewed ? '核对记录' : '查看变更差异')}</button></section>`;
    if (!body) return '';
    const steps = Array.isArray(body.steps) ? body.steps : [];
    return `<section class="chat-proposal" ${copyAria('草稿版本 {version}', { version: Number(ref.version) || 1 })}>`
      + `<p class="chat-proposal-version">${copy('草稿 · 版本 {version}', { version: Number(ref.version) || 1 })}</p>`
      + stateMarkup
      + `<h3>${escapeHTML(body.title)}</h3>`
      + (body.notes ? `<p>${escapeHTML(body.notes)}</p>` : '')
      + (body.nextAction ? `<p>${copy('下一动作：{action}', { action: body.nextAction })}</p>` : '')
      + `<ol>${steps.map(step => `<li>${escapeHTML(step.title || '')}</li>`).join('')}</ol>`
      + `<button type="button" class="pixel-btn btn-mini" data-chat-proposal="${escapeHTML(ref.id)}" aria-pressed="${ref.id === selected}">`
      + `${copy(ref.id === selected ? '已选版本' : '选择这个版本')}</button>`
      + `<p class="chat-proposal-note">${copy(purpose === 'stuck' ? '填入当前任务的下一步草稿，确认后保存' : '填入新任务草稿，可编辑后保存')}</p></section>`;
  }
  function proposalStatusMarkup(id, item) {
    const label = { proposal: '建议记录 · 尚无对应提交回执', applied: '已提交', reverted: '已撤销', removed: '已移除', unavailable: '提交状态暂不可用' };
    const store = { config: '任务与日常', memory: '记忆', planning: '安排偏好' };
    const details = [item?.receiptId ? copy('回执 {receipt}', { receipt: item.receiptId }) : '',
      item?.version ? copy('当前版本 {version}', { version: item.version }) : '',
      item?.targetId ? copy('目标 {id}', { id: item.targetId }) : ''].filter(Boolean).join(' · ');
    return leaf('p', `class="chat-proposal-note" data-proposal-status="${escapeHTML(id)}"`, () =>
      (item ? `${t(store[item.store])} · ${t(label[item.status])}` : t('提交状态待核对'))
      + (item?.historyStatus ? ` · ${t(item.historyStatus === 'pending' ? '时间线待同步' : '时间线已同步')}` : ''))
      + (details ? `<details class="chat-proposal-note"><summary>${t('记录详情')}</summary><p>${details}</p></details>` : '');
  }
  function conversation(record, selected, { scrollTop, toBottom = false, page = false, projectionOnly = false } = {}) {
    const log = $('#draftChatLog');
    const messages = record?.messages || [];
    const previousScroll = log?.scrollTop || 0;
    const atBottom = !log || !Number.isFinite(log.clientHeight)
      ? previousScroll === 0 : log.scrollHeight - log.clientHeight - previousScroll <= 32;
    latestRecord = record; latestSelected = selected;
    if (historyId !== record?.id) {
      proposalStates = new Map();
      for (const selector of ['#draftChatSettings', '#draftChatLibrary', '#draftChatManage']) {
        const panel = $(selector);
        if (panel) panel.open = false;
      }
      historyId = record?.id;
      if (listedSessions) sessions(listedSessions, listedCursor);
      const saved = historyWindows.get(historyId);
      end = saved ? Math.min(saved.end, messages.length) : messages.length;
      start = saved ? Math.min(saved.start, Math.max(0, end - 1)) : Math.max(0, end - PAGE_SIZE);
    }
    else if (!page && toBottom && atBottom && end >= previousCount) { end = messages.length; start = Math.max(0, end - PAGE_SIZE); }
    else if (!page) end = Math.min(messages.length, Math.max(end, Math.min(PAGE_SIZE, messages.length)));
    previousCount = messages.length;
    if (historyId) historyWindows.set(historyId, { start, end });
    if (log) {
      startRegion('#draftChatLog');
      log.innerHTML = messages.length ? messages.slice(start, end).map(message => {
        const role = message.role === 'user' ? 'user' : 'assistant';
        return `<article class="chat-turn chat-turn-${role}" data-message-id="${escapeHTML(message.id)}">`
          + `<div class="chat-turn-heading"><span class="chat-avatar chat-avatar-${role}" aria-hidden="true">${CHAT_AVATARS[role]}</span>${leaf('span', 'class="chat-turn-role"', () => t(role === 'user' ? '你' : 'AI 伙伴'))}</div>`
          + sourceMarkup(message)
          + `<div class="chat-turn-content">${escapeHTML(message.content || '')}</div>`
          + proposalMarkup(message, selected, record.purpose) + '</article>';
      }).join('') : `<p class="chat-empty">${copy('可以先聊聊，也可以一起找下一步。')}</p>`;
      log.scrollTop = toBottom && atBottom ? log.scrollHeight : (scrollTop ?? previousScroll);
    }
    hidden('#btnDraftChatEarlier', start === 0);
    hidden('#btnDraftChatLater', end >= messages.length);
    hidden('#btnDraftChatLatest', end >= messages.length);
    const paginated = start > 0 || end < messages.length;
    hidden('#draftChatHistoryNav', !paginated);
    const rangeStart = start + 1, rangeEnd = end, count = messages.length;
    text('#draftChatHistoryRange', () => paginated ? t('第 {start}–{end} 条，共 {count} 条', { start: rangeStart, end: rangeEnd, count }) : '');
    if (projectionOnly) return;
    const title = record?.displayTitle || record?.title || messages.find(message => message.role === 'user')?.content;
    if (title) text('#draftChatSessionTitle', Array.from(title).slice(0, 60).join(''), { raw: true });
    else text('#draftChatSessionTitle', '新对话');
    const mode = record?.mode || 'talk';
    value('#draftChatMode', mode);
    showPage(currentPage, { focus: false });
    const selectedMessage = messages.find(message => message.proposal?.id === selected);
    hidden('#btnDraftChatAdopt', !taskDraftFromMessage(selectedMessage));
    text('#btnDraftChatAdopt', record?.purpose === 'stuck' ? '放进下一步草稿' : '放进任务草稿');
    const retention = record?.retention || {};
    value('#draftChatRetention', retention.mode || 'ephemeral');
    value('#draftChatRetentionDays', String(retention.days || 30));
    if ($('#draftChatPinned')) $('#draftChatPinned').checked = Boolean(retention.pinned);
    hidden('#draftChatRetentionOptions', retention.mode !== 'saved');
    text('#draftChatSaveState', () => record?.saveState === 'unsaved' ? t('尚未保存到本机；内容仍保留在本次运行中')
      : record?.saveState === 'saved' ? t('已保存到本机 · {retention}', { retention: retention.pinned ? t('已固定') : t('{days} 天', { days: retention.days || 30 }) })
        : t('仅本次 · 关闭只暂停，退出应用后不保留'));
    text('#draftChatCurrentMode', MODE_LABELS[mode] || MODE_LABELS.talk);
  }
  function context(disclosure, contextPreview) {
    const fields = Array.isArray(disclosure?.fields) ? disclosure.fields : [];
    text('#draftChatDisclosureText', () => fields.length ? t('本轮参考字段：{fields}', { fields: fields.join(getLocale() === 'en' ? ', ' : '、') }) : t('仅参考你在这段对话中提供的内容'));
    text('#draftChatProvider', () => disclosure?.provider ? t('接收模型：{model} · {endpoint}', { model: disclosure.provider.model || t('未提供'), endpoint: disclosure.provider.endpoint || t('未提供地址') }) : t('接收模型：尚未提供模型信息；以发送前的配置为准'));
    if (contextPreview !== undefined) {
      if (contextPreview) text('#draftChatContextPreview', JSON.stringify(contextPreview, null, 2), { raw: true });
      else text('#draftChatContextPreview', '没有附加上下文');
      const task = Array.isArray(contextPreview) ? contextPreview.flatMap(read => read.items || []).find(item => typeof item.title === 'string') : null;
      text('#draftChatTaskContext', () => task ? t('当前任务：{title}', { title: task.title }) : '');
      hidden('#draftChatTaskContext', !task);
    }
  }
  function pageHistory(direction) {
    if (!latestRecord) return;
    const count = latestRecord.messages.length;
    if (direction === 'earlier') { end = start; start = Math.max(0, end - PAGE_SIZE); }
    else if (direction === 'later') { start = end; end = Math.min(count, start + PAGE_SIZE); }
    else { end = count; start = Math.max(0, end - PAGE_SIZE); }
    conversation(latestRecord, latestSelected, { page: true, scrollTop: 0 });
  }
  function visibleProposalRefs() {
    const stores = { 'task-draft': 'config', 'change-set': 'config', 'memory-candidate': 'memory', 'planning-preference-candidate': 'planning' };
    return [...new Map((latestRecord?.messages || []).slice(start, end)
      .filter(message => message.role === 'assistant' && message.proposal?.id && stores[message.proposal.kind])
      .map(message => [message.proposal.id, { id: message.proposal.id, store: stores[message.proposal.kind] }])).values()];
  }
  function proposalStatuses(conversationId, items) {
    if (latestRecord?.id !== conversationId) return;
    proposalStates = new Map(items.map(item => [item.proposalId, item]));
    conversation(latestRecord, latestSelected, { page: true, projectionOnly: true });
  }
  function sessions(items, nextCursor) {
    listedSessions = items; listedCursor = nextCursor;
    const node = $('#draftChatSessions');
    startRegion('#draftChatSessions');
    if (node) node.innerHTML = items.length ? items.map(item => {
      const title = item.displayTitle || item.title || item.relatedEntity?.title || item.messages?.find(message => message.role === 'user')?.content;
      const saved = item.saveState === 'unsaved' ? '尚未保存' : item.retention?.mode === 'saved' ? '保留在本机' : '仅本次';
      const date = () => item.updatedAt ? new Date(item.updatedAt).toLocaleString(getLocale()) : '';
      return `<button type="button" class="chat-session" data-chat-resume="${escapeHTML(item.id)}" aria-current="${item.id === latestRecord?.id}">`
        + `<span class="chat-session-title-row"><span>${title ? escapeHTML(title) : copy('一段对话')}</span><span class="chat-session-arrow" aria-hidden="true">›</span></span><small>${item.id === latestRecord?.id ? copy('当前对话 · ') : ''}${copy(MODE_LABELS[item.mode] || '先聊聊')} · ${copy(saved)}</small>${item.updatedAt ? `<small class="chat-session-date">${copyValue(date)}</small>` : ''}</button>`;
    }).join('') : `<p class="chat-empty">${copy('还没有可继续的对话')}</p>`;
    hidden('#btnDraftChatMore', !nextCursor);
  }
  return Object.freeze({ text, repaintCopy, status, busy, draft, conversation, context, sessions, pageHistory, visibleProposalRefs, proposalStatuses, page: showPage, currentPage: () => currentPage });
}

export { createCollaborationView, taskDraftFromMessage, changeCandidateFromMessage, memoryCandidateFromMessage, memoryChangeFromMessage };
