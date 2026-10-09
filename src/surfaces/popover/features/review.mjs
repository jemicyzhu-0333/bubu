import { t, getLocale, onLocaleChanged } from '../../shared/interface/i18n.mjs';
'use strict';

import { localCalendarDayDiff } from '../../../renderer/task-dates.mjs';

// 每日回顾:启动与收口那两张卡,以及点开之后那一屏事实。
//
// 卡片标题跟着卡片自己的日期走,而不是一律写“今日”:早上看到的上一天收口是
// “昨天的收口”,当天的是“今天的收口 / 今天的启动”,更早的写日期。
function reviewTitle(card, reference = Date.now()) {
  const [year, month, day] = String(card && card.dayKey || '').split('-').map(Number);
  const diff = year ? localCalendarDayDiff(new Date(year, month - 1, day), reference) : null;
  const when = diff === 0 ? t('今天') : diff === -1 ? t('昨天') : year ? t('{month}月{day}日', { month, day }) : '';
  return t(card && card.kind === 'closeout' ? '{when}的收口' : '{when}的启动', { when });
}
//
// 这一层拥有的状态只有一样——此刻打开的是哪一张回顾卡。以前它是面板顶上的模块
// 级 activeReview,而三个按钮(关闭 / 忽略 / 完成)各自都要读它、还要各自决定
// 关闭时保不保存进度,这种「一个 let 被三处读写」正是应该被一层收起来的东西。
//
// 它不认识落点提示。它只知道两件事:打开之前如果有一个待表态的落点,就让给它;
// 关掉之后如果落点还在等,焦点直接交给落点而不是从背景里闪一下。这两件事由组合
// 根接线注进来。
//
// 它也不认识 state 的形状之外的东西:回顾卡从投影里读,一切写入都走 surfaceClient。
function createPopoverReviewFeature({
  document, $, $$, getState, surfaceClient,
  activeLandingPrompt, isLandingModalOpen, renderLanding, rememberLandingReturnFocus
} = {}) {
  if (!document || typeof $ !== 'function' || typeof $$ !== 'function') {
    throw new TypeError('popover review requires document, $ and $$');
  }
  for (const [name, fn] of Object.entries({
    getState, activeLandingPrompt, isLandingModalOpen, renderLanding, rememberLandingReturnFocus
  })) {
    if (typeof fn !== 'function') throw new TypeError(`popover review requires ${name}`);
  }
  if (!surfaceClient) throw new TypeError('popover review requires surfaceClient');

  let active = null;   // 此刻打开的是哪一张回顾卡
  let mounted = false;
  const teardown = [];
  let cardCopies = [], factCopies = [];
  let lastCardData = '', lastCardKey = '';
  function factCopy(node, source, parameters = {}) {
    const paint = () => { node.textContent = t(source, parameters); };
    factCopies.push(paint); paint();
  }
  function repaintActive() {
    if (!active) return;
    $('#reviewTitle').textContent = reviewTitle(active.card, getState()?.serverNow || Date.now());
    const done = $('#reviewDone');
    if (done) done.textContent = t(active.card.kind === 'startup' ? '就这样开始' : '完成回顾');
    factCopies.forEach(paint => paint());
  }

  function listen(target, type, handler) {
    if (!target) return;
    target.addEventListener(type, handler);
    teardown.push(() => target.removeEventListener(type, handler));
  }

  function isOpen() {
    return !$('#reviewMask').classList.contains('hidden');
  }

  function factGroup(title, items, options = {}) {
    const section = document.createElement('section');
    section.className = 'review-fact-group';
    const heading = document.createElement('h3');
    factCopy(heading, title);
    section.appendChild(heading);
    if (!items || !items.length) {
      const empty = document.createElement('p');
      empty.className = 'capability-note';
      factCopy(empty, '这里暂时没有内容。');
      section.appendChild(empty);
      return section;
    }
    for (const item of items) {
      const row = document.createElement('label');
      if (options.selectable) {
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.dataset.reviewTaskId = item.id;
        input.checked = options.checked === true;
        row.appendChild(input);
      }
      const text = document.createTextNode(item.title || item.text || t('未命名'));
      if (item.copySource) factCopy(text, item.copySource, item.parameters);
      else if (!item.title && !item.text) factCopy(text, '未命名');
      row.appendChild(text);
      section.appendChild(row);
    }
    return section;
  }

  function renderCards() {
    const state = getState();
    if (!state) return;
    const pending = state.reviews && Array.isArray(state.reviews.pending)
      ? state.reviews.pending.filter(item => item.status === 'pending')
      : [];
    const dataKey = JSON.stringify([pending, state.serverNow]);
    const key = `${getLocale()}|${dataKey}`;
    if (key === lastCardKey) return;
    lastCardKey = key;
    if (dataKey === lastCardData) { cardCopies.forEach(paint => paint()); return; }
    lastCardData = dataKey; cardCopies = [];
    $('#reviewStrip').classList.toggle('hidden', pending.length === 0);
    const count = $('#reviewCount');
    if (count) { count.textContent = String(pending.length); count.setAttribute('aria-hidden', 'true'); count.classList.remove('hidden'); }
    $('#reviewEmpty')?.classList.toggle('hidden', pending.length > 0);
    const countCopy = () => $('#btnReviewInbox')?.setAttribute('aria-label', t('待回顾 {count} 条', { count: pending.length }));
    cardCopies.push(countCopy); countCopy();
    const host = $('#reviewCards');
    host.innerHTML = '';
    for (const item of pending) {
      const row = document.createElement('div');
      row.className = 'review-card-row';
      const label = document.createElement('span');
      const labelCopy = () => { label.textContent = `${reviewTitle(item, state.serverNow || Date.now())}${item.progress ? ` · ${item.progress}%` : ''}`; };
      cardCopies.push(labelCopy); labelCopy();
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'pixel-btn btn-mini';
      const buttonCopy = () => { button.textContent = t(item.progress ? '继续' : '打开'); };
      cardCopies.push(buttonCopy); buttonCopy();
      button.addEventListener('click', () => { void open(item.id); });
      row.append(label, button);
      host.appendChild(row);
    }
  }

  async function open(id) {
    const result = await surfaceClient.openReview(id);
    if (!result || result.ok === false) return;
    // 打开这一屏要占住 aria-modal 层。这期间如果有一个待表态的落点,就把这一层
    // 让给它:回顾随时可以再点开,那一问只在此刻有意义。
    if (activeLandingPrompt() || isLandingModalOpen()) {
      renderLanding();
      return;
    }
    const inbox = $('#reviewInbox');
    if (inbox?.close) inbox.close();
    active = result; factCopies = [];
    const state = getState();
    $('#reviewTitle').textContent = reviewTitle(result.card, (state && state.serverNow) || Date.now());
    const done = $('#reviewDone');
    if (done) done.textContent = t(result.card.kind === 'startup' ? '就这样开始' : '完成回顾');
    const body = $('#reviewBody');
    body.innerHTML = '';
    body.className = 'modal-body review-facts';
    const facts = result.facts;
    if (facts.kind === 'closeout') {
      body.append(
        factGroup('真实完成', facts.completed),
        factGroup('专注片段', [{ copySource: '{minutes} 分钟（来自本地会话事实）', parameters: { minutes: Math.round(facts.focusMs / 60000) } }]),
        factGroup('留下的落点', facts.landings),
        factGroup('仍在收件箱', facts.impulses)
      );
    } else {
      body.append(
        factGroup('昨日延续', facts.carryovers),
        factGroup('今天先做这几件（勾掉不想做的；第一件会设为“现在”）', facts.picks || facts.deadlineCandidates, { selectable: true, checked: true }),
        factGroup('今天新增', facts.newlyAdded),
        factGroup('带自动失效', facts.expiring)
      );
    }
    $('#reviewError').classList.add('hidden');
    $('#reviewMask').classList.remove('hidden');
    $('#reviewMask').setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => $('#reviewClose').focus());
  }

  async function close({ saveProgress = true } = {}) {
    if (saveProgress && active) {
      await surfaceClient.resolveReview(active.card.id, 'progress', {
        progress: Math.max(1, active.card.progress || 50)
      });
    }
    active = null; factCopies = [];
    $('#reviewMask').classList.add('hidden');
    $('#reviewMask').setAttribute('aria-hidden', 'true');
    $('#btnReviewInbox')?.focus();
    if (activeLandingPrompt()) {
      rememberLandingReturnFocus($('#reviewClose'));
      renderLanding();
    }
  }

  function mount() {
    if (mounted) return;
    mounted = true;
    teardown.push(onLocaleChanged(() => {
      // Repaint only authored copy, retaining checked tasks and pending receipt owners.
      renderCards(); repaintActive();
    }));
    listen($('#reviewClose'), 'click', () => { void close(); });
    listen($('#reviewDismiss'), 'click', async () => {
      if (!active) return;
      await surfaceClient.resolveReview(active.card.id, 'dismissed');
      await close({ saveProgress: false });
    });
    listen($('#reviewDone'), 'click', async () => {
      if (!active) return;
      const confirmedTaskIds = [...$$('#reviewBody [data-review-task-id]:checked')]
        .map(input => input.dataset.reviewTaskId)
        .slice(0, 3);
      await surfaceClient.resolveReview(active.card.id, 'done', { confirmedTaskIds });
      await close({ saveProgress: false });
    });
  }

  function dispose() {
    if (!mounted) return;
    mounted = false;
    while (teardown.length) teardown.pop()();
    active = null; cardCopies = []; factCopies = []; lastCardData = ''; lastCardKey = '';
  }

  return Object.freeze({ mount, dispose, isOpen, open, close, renderCards });
}


export { createPopoverReviewFeature, reviewTitle };
