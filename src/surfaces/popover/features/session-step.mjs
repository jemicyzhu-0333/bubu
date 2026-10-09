// A running task accepts one append operation, never a snapshot of the task.
function createSessionStep({ $, getSession, surfaceClient, showStatus }) {
  let taskId = null;
  let saving = false;
  let mounted = false;
  function render(task) {
    const session = getSession();
    const active = task && !task.done && !task.skippedAt && session.mode !== 'break'
      && session.taskId === task.id && (session.running || session.paused);
    const nextId = active ? task.id : null;
    if (taskId !== nextId) {
      if ($('#sessionStepInput')) $('#sessionStepInput').value = '';
      if ($('#sessionStepForm')) $('#sessionStepForm').classList.add('hidden');
    }
    taskId = nextId;
    $('#btnAddSessionStep')?.classList.toggle('hidden', !active);
    $('#btnEditNowTask')?.classList.toggle('hidden', Boolean(!task || active || task.done || task.skippedAt));
  }
  function open() {
    if (!taskId) return;
    $('#sessionStepForm').classList.remove('hidden');
    $('#sessionStepInput').focus();
  }
  function close() { $('#sessionStepForm').classList.add('hidden'); $('#btnAddSessionStep').focus(); }
  async function submit(event) {
    event.preventDefault();
    const title = $('#sessionStepInput').value.trim();
    const target = taskId;
    if (!title || !target || saving || getSession().mode === 'break') return;
    saving = true; $('#saveSessionStep').disabled = true;
    try {
      const result = await surfaceClient.updateTask(target, { steps: [{ op: 'add', title }] }, 'current');
      if (!mounted) return;
      if (!result?.ok) { showStatus('没有添加：任务状态已变化，请重试。'); return; }
      if (taskId === target) { $('#sessionStepInput').value = ''; close(); }
      showStatus('已添加一步');
    } catch (_) { if (mounted) showStatus('没能保存，输入内容还在。'); }
    finally { saving = false; if (mounted) $('#saveSessionStep').disabled = false; }
  }
  return {
    render,
    mount() {
      if (mounted) return; mounted = true;
      $('#btnAddSessionStep')?.addEventListener('click', open);
      $('#cancelSessionStep')?.addEventListener('click', close);
      $('#sessionStepForm')?.addEventListener('submit', submit);
    },
    dispose() {
      mounted = false;
      $('#btnAddSessionStep')?.removeEventListener('click', open);
      $('#cancelSessionStep')?.removeEventListener('click', close);
      $('#sessionStepForm')?.removeEventListener('submit', submit);
    }
  };
}
export { createSessionStep };
