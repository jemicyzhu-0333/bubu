'use strict';

// 面板这一面的 DOM 与格式化原语。它不认识任何业务概念，只提供“怎么读一个控件、
// 怎么把一段文本写到状态行、怎么把时间戳变成本地输入框的值”。
// 之前每个区块各写一份状态行开关（表单、面板、专注动作、策略提示），四份代码
// 说同一件事却各漏一条分支 —— 这里只留一份 setStatusLine。
function createPopoverDom({ document, window } = {}) {
  if (!document || !window) throw new TypeError('popover dom requires document and window');

  const $ = sel => document.querySelector(sel);
  const $$ = sel => document.querySelectorAll(sel);

  const pad2 = n => String(n).padStart(2, '0');

  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }

  function formatMs(ms) {
    const totalMin = Math.floor(ms / 60000);
    if (totalMin < 60) return `${totalMin}分`;
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return m ? `${h}h${m}m` : `${h}h`;
  }

  function localDateKey(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  function localDateInputValue(value = Date.now()) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  function localDateTimeInputValue(value = Date.now()) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    return `${localDateInputValue(date)}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  }

  function endOfDayISO(addDays) {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + addDays, 23, 59, 59, 999).toISOString();
  }

  function scheduledFromDateTimeInput(value) {
    if (!value) return null;
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
  }

  function syncPressedButtons(selector, isPressed) {
    $$(selector).forEach(button => {
      const pressed = Boolean(isPressed(button));
      button.classList.toggle('active', pressed);
      button.setAttribute('aria-pressed', String(pressed));
    });
  }

  function readNumberInput(selector) {
    const input = $(selector);
    if (!input) return null;
    if (!input.value.trim()) return null;
    const minutes = Number(input.value);
    return Number.isInteger(minutes) ? minutes : null;
  }

  // 空消息就是收起来。写文本与切 hidden 永远成对发生，分开写过一次就会留下
  // 一条空白但占位的状态行。
  function setStatusLine(selector, message = '') {
    const status = $(selector);
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('hidden', !message);
  }

  // 一条提示说完就该走。之前 #strategyStatus 只在请求成功这一条路径上 add('hidden')，
  // 失败与反馈路径只 remove('hidden')，所以“当前门禁下没有合适建议”一旦出现就永久
  // 挂在页面上，用户根本关不掉。
  const transientStatusTimers = new Map();

  function hideTransientStatus(selector) {
    const node = $(selector);
    if (!node) return;
    clearTimeout(transientStatusTimers.get(selector));
    transientStatusTimers.delete(selector);
    node.textContent = '';
    node.classList.add('hidden');
  }

  function showTransientStatus(selector, message, ms = 4000) {
    const node = $(selector);
    if (!node) return;
    clearTimeout(transientStatusTimers.get(selector));
    node.textContent = message;
    node.classList.toggle('hidden', !message);
    if (!message) {
      transientStatusTimers.delete(selector);
      return;
    }
    transientStatusTimers.set(selector, setTimeout(() => {
      node.textContent = '';
      node.classList.add('hidden');
      transientStatusTimers.delete(selector);
    }, ms));
  }

  function dispose() {
    for (const timer of transientStatusTimers.values()) clearTimeout(timer);
    transientStatusTimers.clear();
  }

  return Object.freeze({
    $,
    $$,
    pad2,
    escapeHTML,
    formatMs,
    localDateKey,
    localDateInputValue,
    localDateTimeInputValue,
    endOfDayISO,
    scheduledFromDateTimeInput,
    syncPressedButtons,
    readNumberInput,
    setStatusLine,
    showTransientStatus,
    hideTransientStatus,
    dispose
  });
}


export { createPopoverDom };
