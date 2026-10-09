'use strict';

// 完成确认：只有还剩未完步骤时才会出现的那一问。
//
// 完成不可逆，所以入口先不带确认地问一次主进程，让它告诉我们还差几步，再拿具体
// 数字回来问用户。因此“从任务行按下勾选”和“这一问”是同一件事的两半，归同一层：
// 把 completeTask 留在面板上、只把弹层搬走，等于让待确认的那件任务在两处各存一
// 份，而这两份不同步的表现是“取消之后再点勾，直接就完成了”。
//
// 待确认的任务 id 与打开它的那个控件都只在这一层里存在。以前它们是面板顶上的两
// 个模块级 let：弹层关掉以后 pendingCompletion 还留着，任何后来的确认动作都会把
// 上一件任务完成掉——一次不可逆的误操作。
function createPopoverCompleteConfirm({
  document,
  $,
  surfaceClient,
  celebrate,
  onCompleted = () => {},
  requestFrame = globalThis.requestAnimationFrame,
  restoreModalFocus,
  showPanelStatus,
  taskActionMessage
} = {}) {
  if (!document || typeof $ !== 'function') {
    throw new TypeError('popover complete confirm requires document and $');
  }
  for (const [name, fn] of [
    ['celebrate', celebrate],
    ['onCompleted', onCompleted],
    ['restoreModalFocus', restoreModalFocus],
    ['showPanelStatus', showPanelStatus],
    ['taskActionMessage', taskActionMessage]
  ]) {
    if (typeof fn !== 'function') throw new TypeError(`popover complete confirm requires ${name}`);
  }
  if (!surfaceClient || typeof surfaceClient.completeTask !== 'function') {
    throw new TypeError('popover complete confirm requires surfaceClient');
  }

  let pending = null;  // 正等着确认的那件任务；关掉弹层就是真的什么都没发生
  let trigger = null;  // 打开它的那个控件；关闭后焦点回到这里
  let mounted = false;
  let submitting = false;
  let presentationVersion = 0;
  const teardown = [];

  function listen(target, type, handler) {
    if (!target) return;
    target.addEventListener(type, handler);
    teardown.push(() => target.removeEventListener(type, handler));
  }

  function isOpen() {
    const mask = $('#completeConfirmMask');
    return Boolean(mask && !mask.classList.contains('hidden'));
  }

  function close() {
    presentationVersion += 1;
    const mask = $('#completeConfirmMask');
    const closing = trigger;
    if (mask) {
      mask.classList.add('hidden');
      mask.setAttribute('aria-hidden', 'true');
    }
    pending = null;
    trigger = null;
    restoreModalFocus(closing);
  }

  function open(task, unfinishedCount) {
    const mask = $('#completeConfirmMask');
    if (!mask) return;
    const version = ++presentationVersion;
    trigger = document.activeElement && document.activeElement !== document.body
      ? document.activeElement
      : $('#taskInput');
    pending = task.id;
    $('#completeConfirmTask').textContent = `「${task.title}」还有 ${unfinishedCount} 步没勾。`;
    $('#completeConfirmError').classList.add('hidden');
    mask.classList.remove('hidden');
    mask.setAttribute('aria-hidden', 'false');
    requestFrame(() => {
      if (version === presentationVersion) $('#completeConfirmCancel').focus();
    });
  }

  // 完成不可逆，所以第一次不带确认：让主进程告诉我们还差几步，再拿具体数字
  // 去问用户。用户取消就是真的什么都没发生。
  async function completeTask(task) {
    if (submitting) return;
    submitting = true;
    const version = presentationVersion;
    let result;
    try {
      result = await surfaceClient.completeTask(task.id);
    } catch (_) {
      if (version === presentationVersion) showPanelStatus(taskActionMessage('task-complete-rejected'));
      return;
    } finally {
      submitting = false;
    }
    if (result && result.ok) {
      presentCompleted(result);
      return;
    }
    if (version !== presentationVersion) return;
    if (result && result.reason === 'unfinished-steps-need-confirmation') {
      open(task, result.unfinishedCount || 0);
      return;
    }
    showPanelStatus(taskActionMessage(result && result.reason));
  }

  async function confirm() {
    if (!pending || submitting) return;
    const version = presentationVersion;
    const taskId = pending;
    submitting = true;
    const okButton = $('#completeConfirmOk');
    const error = $('#completeConfirmError');
    okButton.disabled = true;
    let result;
    try {
      result = await surfaceClient.completeTask(taskId, { confirmUnfinishedSteps: true });
      if (!result || result.ok === false) throw new Error((result && result.reason) || 'task-complete-rejected');
    } catch (_) {
      if (version !== presentationVersion) return;
      error.textContent = '这次没有完成成功，任务与步骤都保留，请重试。';
      error.classList.remove('hidden');
      return;
    } finally {
      submitting = false;
      okButton.disabled = false;
    }
    if (version === presentationVersion) close();
    presentCompleted(result);
  }

  function presentCompleted(result) {
    for (const effect of [celebrate, onCompleted]) {
      try {
        effect(result);
      } catch (_) {
        continue;
      }
    }
  }

  function mount() {
    if (mounted) return;
    mounted = true;
    listen($('#completeConfirmOk'), 'click', confirm);
    listen($('#completeConfirmClose'), 'click', close);
    listen($('#completeConfirmCancel'), 'click', close);
  }

  function dispose() {
    presentationVersion += 1;
    if (!mounted) return;
    mounted = false;
    while (teardown.length) teardown.pop()();
    pending = null;
    trigger = null;
  }

  return Object.freeze({ mount, dispose, isOpen, close, completeTask });
}


export { createPopoverCompleteConfirm };
