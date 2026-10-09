import { t, getLocale, onLocaleChanged } from '../shared/interface/i18n.mjs';
// A local draft is keyed by task + step, so projection refreshes cannot silently
// replace typed text or apply it to a newly selected session.
function createQuickStepEditor({ document, client, runCommand, releaseCommand, getTask, getSessionId, completeStep }) {
  let draft = null;
  let steps = [];
  let renderedKey = null;
  let renderedDraft = null;
  const copyNodes = [];
  function copy(node, source, attribute = null, parameters = {}) {
    copyNodes.push({ node, source, attribute, parameters });
    paintCopy(copyNodes[copyNodes.length - 1]);
  }
  function paintCopy({ node, source, attribute, parameters }) {
    if (attribute) node.setAttribute(attribute, t(source, parameters));
    else node.textContent = t(source, parameters);
  }
  const stopLocale = onLocaleChanged(() => copyNodes.forEach(paintCopy));
  const root = document.querySelector('#quickSteps');
  function button(label, action, className = 'step-edit-button') {
    const node = document.createElement('button');
    node.type = 'button'; node.textContent = label; node.className = className;
    node.addEventListener('click', action);
    return node;
  }
  function copyButton(source, action) {
    const node = button('', action);
    copy(node, source);
    return node;
  }
  function replaceDraft(next) {
    if (draft) releaseCommand(draft);
    draft = next;
  }
  function render(next) {
    const task = getTask();
    if (draft && (task?.id !== draft.taskId || getSessionId() !== draft.sessionId
        || !next.some(s => s.id === draft.id))) replaceDraft(null);
    const key = JSON.stringify([getLocale(), task?.id, getSessionId(), next.map(step => ({
      id: step.id, title: draft?.id === step.id ? null : step.title
    }))]);
    if (key === renderedKey && draft === renderedDraft) { steps = next; return; }
    steps = next;
    renderedKey = key;
    renderedDraft = draft;
    const focusOwner = draft?.input && document.activeElement === draft.input ? draft : null;
    const selection = focusOwner ? [draft.input.selectionStart, draft.input.selectionEnd] : null;
    copyNodes.length = 0;
    root.replaceChildren();
    for (const [index, step] of steps.entries()) {
      const row = document.createElement('div'); row.className = 'pending-step';
      if (draft?.id === step.id) {
        const form = document.createElement('form'); form.className = 'step-inline-editor';
        const owner = draft;
        const input = document.createElement('input');
        owner.input = input;
        input.value = owner.title; input.maxLength = 200; copy(input, '修改未完成步骤', 'aria-label');
        input.addEventListener('input', () => {
          if (draft !== owner || owner.input !== input) return;
          owner.title = input.value;
          owner.version++;
        });
        const save = copyButton('保存', () => { void submit(owner, input); });
        const cancel = copyButton('取消', () => {
          if (draft !== owner || owner.input !== input) return;
          replaceDraft(null); render(steps);
        });
        form.addEventListener('submit', event => { event.preventDefault(); void submit(owner, input); });
        form.append(input, save, cancel); row.appendChild(form);
      } else {
        const currentStep = () => getTask()?.id === task?.id
          ? steps.find(item => item.id === step.id && item.title === step.title) : null;
        const done = button(`${index + 1}  ${step.title}`, () => {
          const current = currentStep();
          if (current) completeStep(current);
        }, 'quick-row quick-step');
        copy(done, '完成步骤：{title}', 'aria-label', { title: step.title });
        const edit = copyButton('修改', () => {
          if (!currentStep()) return;
          replaceDraft({ taskId: task.id, sessionId: getSessionId(), id: step.id, title: step.title, version: 0 });
          render(steps); root.querySelector('input')?.focus();
        });
        row.append(done, edit);
      }
      root.appendChild(row);
    }
    if (focusOwner && draft === focusOwner) {
      draft.input.focus();
      if (selection && typeof draft.input.setSelectionRange === 'function') draft.input.setSelectionRange(...selection);
    }
    if (!steps.length) {
      const empty = document.createElement('p'); empty.className = 'quick-empty';
      copy(empty, '下一小步，随时补上。'); root.appendChild(empty);
    }
  }
  async function submit(saved, input) {
    const task = getTask();
    if (!saved || saved !== draft || saved.input !== input || saved.taskId !== task?.id || !saved.title.trim()) return;
    const version = saved.version;
    const title = saved.title.trim();
    const owns = () => draft === saved && saved.version === version
      && getTask()?.id === saved.taskId && getSessionId() === saved.sessionId;
    const result = await runCommand(() => client.renameTaskStep(task.id, saved.id, title, task.seriesId ? 'current' : undefined),
      { bindView: false, owner: saved, owns });
    if (result?.ok && owns()) { replaceDraft(null); render(steps); }
  }

  return { render, dispose() { stopLocale(); copyNodes.length = 0; replaceDraft(null); root?.replaceChildren(); } };
}
export { createQuickStepEditor };
