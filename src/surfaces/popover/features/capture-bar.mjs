'use strict';

// 随手记：面板底部常驻的一行输入。
//
// 脑子里冒出的东西——想起来要做的事、一句吐槽、一阵情绪——最怕的是“等我切到对的地方
// 再记”，切过去的那几秒它就没了。所以入口只有一个，永远在同一个位置，任何页签都能用，
// 专注中也能用：写一句，回车，它进收件箱，你回到刚才在做的事。
//
// 这一层只负责“收下”，不负责判断它是任务还是情绪：分拣在收件箱和后面的模型链路里。
// 快捷键：面板里没有在输入时按 `/` 直接聚焦到这里；Esc 清空并离开。
const STATUS_MS = 2600;

function createPopoverCaptureBar({ document, $, surfaceClient } = {}) {
  if (!document || typeof $ !== 'function' || !surfaceClient || typeof surfaceClient.addImpulse !== 'function') {
    throw new TypeError('capture bar requires document, $, and surfaceClient.addImpulse');
  }
  const listeners = [];
  let statusTimer = null;
  let busy = false;

  function listen(target, type, handler) {
    if (!target || typeof target.addEventListener !== 'function') return;
    target.addEventListener(type, handler);
    listeners.push({ target, type, handler });
  }

  function setStatus(text, tone = '') {
    const status = $('#captureStatus');
    if (!status) return;
    status.textContent = text;
    status.dataset.tone = tone;
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = text ? setTimeout(() => { status.textContent = ''; status.dataset.tone = ''; }, STATUS_MS) : null;
  }

  function placeholderFor(session) {
    return session === 'focus' || session === 'paused'
      ? '专注中想到别的？先丢这里，不打断'
      : '脑子里冒出什么，写一句丢进来';
  }

  async function submit(event) {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    const input = $('#captureInput');
    if (!input || busy) return;
    const text = String(input.value || '').trim();
    if (!text) return;
    busy = true;
    try {
      const result = await surfaceClient.addImpulse(text);
      if (result && result.ok === false) {
        setStatus('没存上，文字还在，稍后再试一次', 'error');
        return;
      }
      input.value = '';
      setStatus('收下了，在收件箱里等你处理', 'ok');
    } catch {
      setStatus('没存上，文字还在，稍后再试一次', 'error');
    } finally {
      busy = false;
    }
  }

  function inputOwnsKeys(target) {
    return Boolean(target) && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'
      || target.tagName === 'SELECT' || target.isContentEditable);
  }

  function mount() {
    const form = $('#captureBar');
    const input = $('#captureInput');
    if (!form || !input) return;
    listen(form, 'submit', submit);
    listen(input, 'focus', () => {
      const session = document.body && document.body.dataset ? document.body.dataset.session : '';
      input.placeholder = placeholderFor(session);
    });
    listen(input, 'keydown', event => {
      if (event.key === 'Escape' && input.value) {
        event.preventDefault();
        event.stopPropagation();
        input.value = '';
        input.blur();
      }
    });
    listen(document, 'keydown', event => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      if (inputOwnsKeys(event.target)) return;
      if (document.querySelector && document.querySelector('.modal-mask:not(.hidden), .settings-mask:not(.hidden)')) return;
      event.preventDefault();
      input.focus();
    });
  }

  function dispose() {
    for (const { target, type, handler } of listeners) target.removeEventListener(type, handler);
    listeners.length = 0;
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = null;
  }

  return Object.freeze({ mount, dispose, submit, placeholderFor });
}

export { createPopoverCaptureBar };
