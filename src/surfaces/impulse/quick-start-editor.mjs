// One explicit local action belongs to one draft and panel visit. Closing it
// releases UI ownership only; a dispatched command is never cancelled/retried.
function createQuickStartEditor({ window, document, client, runCommand, releaseCommand,
  isBusy, getVisit, isVisitOpen, setStatus, refresh }) {
  const $ = selector => document.querySelector(selector);
  let draft = null;
  let generation = 0;
  let disposed = false;
  const teardown = [];
  const owns = owner => !disposed && draft === owner && owner.visit === getVisit() && isVisitOpen();
  function controls() {
    const form = $('#quickStartForm');
    if (form) form.classList.toggle('hidden', !draft || draft.intent !== 'clarify-and-start' || draft.committed);
    const confirm = $('#quickStartConfirm');
    if (confirm) confirm.disabled = !draft || draft.pending || draft.stale || draft.committed;
  }
  function reset() {
    generation++;
    const previous = draft;
    draft = null;
    if (previous) releaseCommand(previous);
    controls();
  }
  function cancel() {
    const sent = draft?.pending;
    reset();
    setStatus(sent ? '输入已收起；已发送的启动仍会按原任务处理。' : '');
    const cancelled = generation, visit = getVisit();
    window.requestAnimationFrame(() => {
      if (!disposed && generation === cancelled && visit === getVisit() && isVisitOpen()) $('#impInput')?.focus();
    });
  }
  function open(candidate) {
    if (disposed || !isVisitOpen() || isBusy()) return;
    const action = candidate?.quickStartAction;
    if (!action?.enabled || action.taskId !== candidate.id
        || !['start', 'clarify-and-start'].includes(action.intent) || !/^[a-f0-9]{64}$/.test(action.taskVersion || '')) return;
    reset();
    const owner = { taskId: candidate.id, taskVersion: action.taskVersion, intent: action.intent,
      visit: getVisit(), pending: false, stale: false, committed: false };
    draft = owner;
    setStatus('');
    if (owner.intent === 'start') { void submit(); return; }
    $('#quickStartTitle').textContent = candidate.title;
    $('#quickStartInput').value = '';
    controls();
    window.requestAnimationFrame(() => { if (owns(owner)) $('#quickStartInput')?.focus(); });
  }
  function update(view) {
    if (!draft || draft.committed) return;
    const candidate = view?.mode === 'idle' && view.candidates?.find(item => item.id === draft.taskId);
    const action = candidate?.quickStartAction;
    // Keep the original version and text even when a push invalidates it. A
    // pending command still owns its receipt, including its own postcommit push.
    if (!action?.enabled || action.taskVersion !== draft.taskVersion || action.intent !== draft.intent) {
      draft.stale = true;
      if (!draft.pending) setStatus('任务状态已变化；输入仍保留，取消后可重新选择。', 'quiet');
    }
    controls();
  }
  async function submit() {
    const owner = draft;
    if (!owner || !owns(owner) || owner.pending || owner.stale || owner.committed || isBusy()) return;
    let clarification;
    if (owner.intent === 'clarify-and-start') {
      const nextAction = $('#quickStartInput').value.trim();
      if (!nextAction || nextAction.length > 200) {
        setStatus('下一动作需要 1–200 个字，输入内容还在。', 'error'); return;
      }
      clarification = { nextAction, taskVersion: owner.taskVersion };
    }
    if (typeof client.kickstart !== 'function') {
      setStatus('两分钟启动暂不可用，请重新打开面板。', 'error'); return;
    }
    owner.pending = true;
    controls();
    const result = await runCommand(async () => {
      const receipt = await client.kickstart(owner.taskId, clarification);
      return typeof receipt?.ok === 'boolean' ? receipt : { ok: false, reason: 'quick-start-unavailable' };
    }, {
      refreshAfter: false, bindView: false, owner, owns: () => owns(owner)
    });
    if (!owns(owner)) return;
    owner.pending = false;
    if (!result || result.ok === false) { controls(); return; }
    owner.committed = true;
    controls();
    setStatus('两分钟已开始。');
    try {
      if (!owns(owner)) return;
      const hidden = await client.hideImpulse();
      if (hidden?.ok === false) throw new Error('window-hide-failed');
    } catch (_) {
      if (!owns(owner)) return;
      await refresh();
      if (owns(owner)) setStatus('两分钟已开始；窗口未能关闭，可以继续计时。', 'quiet');
    }
  }
  function mount() {
    for (const [selector, event, handler] of [
      ['#quickStartForm', 'submit', event => { event.preventDefault(); void submit(); }],
      ['#quickStartCancel', 'click', cancel]
    ]) {
      const node = $(selector);
      if (!node) continue;
      node.addEventListener(event, handler);
      teardown.push(() => node.removeEventListener(event, handler));
    }
    controls();
  }
  function dispose() {
    disposed = true;
    reset();
    while (teardown.length) teardown.pop()();
  }
  return Object.freeze({ mount, open, update, cancel, reset, dispose,
    isOpen: () => Boolean(draft && draft.intent === 'clarify-and-start' && !draft.committed),
    hasDraft: () => Boolean(draft) });
}

export { createQuickStartEditor };
