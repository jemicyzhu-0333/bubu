'use strict';

// 统一任务编辑面板：一件任务的全部属性只有这一个入口。
//
// 这一层拥有那张编辑草稿——步骤的增删改排、这次修改的影响范围、打开它的那个
// 控件——以及把草稿折成一串 add / rename / remove / reorder 的那套规则。以前草稿
// 是面板顶上的两个模块级 let：弹层关掉以后它还在，下一次打开只要哪个字段没被
// 重新赋值，用户看到的就是上一件任务的残留。现在它只在这一层里存在。
//
// 它不认识 state：当前任务记录与它的重复系列都从注入的读取器来。它也不认识别
// 的弹层：关闭后焦点归还给谁由注入的 restoreModalFocus 决定，被拒绝的操作说什
// 么由注入的 taskActionMessage 翻译。
function createPopoverTaskEditor({
  document, $, $$, escapeHTML, syncPressedButtons, readNumberInput,
  localDateInputValue, localDateTimeInputValue, scheduledFromDateTimeInput, endOfLocalDateISO,
  bindStepTitleField, parseTagList, tagInputError, estimateInputError, recurrenceIntervalError,
  maxSteps, surfaceClient, taskActionMessage, describeSeriesRule,
  findTask, seriesForTask, restoreModalFocus, showPanelStatus
} = {}) {
  if (!document || typeof $ !== 'function' || typeof $$ !== 'function') {
    throw new TypeError('popover task editor requires document, $ and $$');
  }
  for (const [name, fn] of [
    ['escapeHTML', escapeHTML],
    ['syncPressedButtons', syncPressedButtons],
    ['readNumberInput', readNumberInput],
    ['localDateInputValue', localDateInputValue],
    ['localDateTimeInputValue', localDateTimeInputValue],
    ['scheduledFromDateTimeInput', scheduledFromDateTimeInput],
    ['endOfLocalDateISO', endOfLocalDateISO],
    ['bindStepTitleField', bindStepTitleField],
    ['parseTagList', parseTagList],
    ['tagInputError', tagInputError],
    ['estimateInputError', estimateInputError],
    ['recurrenceIntervalError', recurrenceIntervalError],
    ['taskActionMessage', taskActionMessage],
    ['describeSeriesRule', describeSeriesRule],
    ['findTask', findTask],
    ['seriesForTask', seriesForTask],
    ['restoreModalFocus', restoreModalFocus],
    ['showPanelStatus', showPanelStatus]
  ]) {
    if (typeof fn !== 'function') throw new TypeError(`popover task editor requires ${name}`);
  }
  if (!Number.isFinite(maxSteps)) throw new TypeError('popover task editor requires maxSteps');
  if (!surfaceClient || typeof surfaceClient.updateTask !== 'function'
    || typeof surfaceClient.updateSeries !== 'function') {
    throw new TypeError('popover task editor requires surfaceClient');
  }

  let draft = null;    // 每次打开都有独立身份；关闭只撤销界面归属，不撤销已发出的命令。
  let trigger = null;  // 打开它的那个控件；关闭后焦点回到这里
  let operation = null;
  let mounted = false;
  const teardown = [];
  const operationControls = ['#taskEditConfirm', '#editSeriesSave', '#editSeriesPause', '#editSeriesResume', '#editSeriesEnd'];

  function isCurrent(display) {
    return mounted && draft === display && display !== null && isOpen();
  }

  // 三类保存共用提示区，单轮只承接一个命令。busy 和回执都属于本次 display。
  function beginOperation() {
    if (!isCurrent(draft) || operation) return null;
    const owner = { display: draft, controls: operationControls.map(selector => [$(selector), $(selector)?.disabled]) };
    operation = owner;
    for (const [control] of owner.controls) if (control) control.disabled = true;
    showError('');
    return owner;
  }

  function ownsOperation(owner) {
    return operation === owner && isCurrent(owner.display);
  }

  function finishOperation(owner) {
    if (!ownsOperation(owner)) return;
    operation = null;
    for (const [control, disabled] of owner.controls) if (control) control.disabled = disabled;
  }

  function listen(target, type, handler) {
    if (!target) return;
    target.addEventListener(type, handler);
    teardown.push(() => target.removeEventListener(type, handler));
  }

  function isOpen() {
    const mask = $('#taskEditMask');
    return Boolean(mask && !mask.classList.contains('hidden'));
  }

  function close() {
    const mask = $('#taskEditMask');
    const closing = trigger;
    if (mask) {
      mask.classList.add('hidden');
      mask.setAttribute('aria-hidden', 'true');
    }
    draft = null;
    trigger = null;
    operation = null;
    if (closing) restoreModalFocus(closing);
  }

  function showError(message = '') {
    const error = $('#taskEditError');
    if (!error) return;
    error.textContent = message;
    error.classList.toggle('hidden', !message);
  }

  // core 的 add 只能追加到末尾，所以草稿里还没有 ID 的新步骤必须待在末尾：
  // 让它排到已保存的步骤之前，就是当场承诺一个这次事务交付不了的顺序。
  function newStepsStayAtTail(steps) {
    const firstNew = steps.findIndex(step => !step.id);
    return firstNew === -1 || steps.slice(firstNew).every(step => !step.id);
  }

  function moveStep(from, to) {
    if (!draft) return;
    const steps = draft.steps;
    if (to < 0 || to >= steps.length) return;
    const next = steps.slice();
    [next[from], next[to]] = [next[to], next[from]];
    if (!newStepsStayAtTail(next)) {
      showError('新加的步骤会先排在末尾；保存之后就能自由调整顺序了。');
      return;
    }
    draft.steps = next;
    showError('');
    renderSteps();
  }

  // 步骤编辑先在本地草稿上改，保存时才折成一串 add / rename / remove / reorder
  // 操作。这样取消就是真的什么都没发生，而不是一半改动已经落库。
  function renderSteps() {
    const host = $('#editSteps');
    if (!host || !draft) return;
    host.innerHTML = '';
    const display = draft;
    const steps = draft.steps;
    const ownsRow = () => isCurrent(display) && draft.steps === steps;
    draft.steps.forEach((step, index) => {
      const row = document.createElement('div');
      row.className = 'bd-step edit-step';
      row.innerHTML = `
      <textarea class="pixel-input edit-step-title" maxlength="200" rows="1" aria-label="第 ${index + 1} 步标题"${step.done ? ' disabled' : ''}>${escapeHTML(step.title)}</textarea>
      <button type="button" class="icon-btn edit-step-up" aria-label="把第 ${index + 1} 步往上移"${index === 0 ? ' disabled' : ''}>↑</button>
      <button type="button" class="icon-btn edit-step-down" aria-label="把第 ${index + 1} 步往下移"${index === draft.steps.length - 1 ? ' disabled' : ''}>↓</button>
      <button type="button" class="icon-btn edit-step-remove" aria-label="删除第 ${index + 1} 步"${step.done ? ' disabled' : ''}>✕</button>`;
      bindStepTitleField(row.querySelector('.edit-step-title'), value => {
        if (ownsRow()) step.title = value;
      });
      row.querySelector('.edit-step-up').addEventListener('click', () => { if (ownsRow()) moveStep(index, index - 1); });
      row.querySelector('.edit-step-down').addEventListener('click', () => { if (ownsRow()) moveStep(index, index + 1); });
      row.querySelector('.edit-step-remove').addEventListener('click', () => {
        if (!ownsRow()) return;
        draft.steps = draft.steps.filter((_, position) => position !== index);
        renderSteps();
      });
      host.appendChild(row);
    });
    const addButton = $('#editAddStep');
    if (addButton) {
      addButton.disabled = draft.steps.length >= maxSteps;
      addButton.title = addButton.disabled ? `每个任务最多 ${maxSteps} 个步骤` : '';
    }
  }

  function open(task) {
    const mask = $('#taskEditMask');
    if (!mounted || !mask || !task) return;
    // 完成是终态：已完成的任务不提供编辑，出口是“再做一遍”。
    if (task.done || task.skippedAt) {
      showPanelStatus(task.skippedAt
        ? '这一次已经跳过，只作为历史保留。'
        : '已完成的任务不再修改；需要的话可以再做一遍。');
      return;
    }
    trigger = document.activeElement && document.activeElement !== document.body
      ? document.activeElement
      : $('#btnOpenTaskCreate');
    const series = seriesForTask(task);
    draft = {
      id: task.id,
      seriesId: task.seriesId || null,
      scope: null,
      originalStepIds: (task.steps || []).map(step => step.id),
      steps: (task.steps || []).map(step => ({ id: step.id, title: step.title, done: Boolean(step.done) }))
    };
    operation = null;
    for (const selector of operationControls) {
      const control = $(selector);
      if (control) control.disabled = false;
    }
    $('#taskEditTitle').textContent = '编辑任务';
    for (const id of ['#editDates', '#editAttributes']) {
      const details = $(id);
      if (details) details.open = false;
    }
    const dateSummary = $('#editDatesSummary');
    if (dateSummary) dateSummary.textContent = [task.plannedFor && '已安排', task.scheduledFor && '有开始时间',
      task.deadline && '有截止日期', task.expiresAt && '有有效期限'].filter(Boolean).join(' · ') || '未设置';
    const attributeSummary = $('#editAttributesSummary');
    if (attributeSummary) attributeSummary.textContent = [task.estimateMinutes && `${task.estimateMinutes} 分钟`,
      task.tags?.length && `${task.tags.length} 个标签`].filter(Boolean).join(' · ') || '能量、估时、标签';
    $('#editTitle').value = task.title || '';
    $('#editDescription').value = task.description || '';
    $('#editPlannedFor').value = task.plannedFor || '';
    $('#editScheduledFor').value = task.scheduledFor ? localDateTimeInputValue(task.scheduledFor) : '';
    $('#editDeadline').value = task.deadline ? localDateInputValue(task.deadline) : '';
    $('#editExpiresAt').value = task.expiresAt ? localDateInputValue(task.expiresAt) : '';
    $('#editEstimate').value = task.estimateMinutes === null || task.estimateMinutes === undefined
      ? ''
      : String(task.estimateMinutes);
    $('#editTags').value = (task.tags || []).join(', ');
    syncPressedButtons('.edit-energy-chip', button => button.dataset.editEnergy === (task.energyAuto ? 'auto' : task.energy));
    $('#editScopeRow').classList.toggle('hidden', !task.seriesId);
    syncPressedButtons('.edit-scope-chip', () => false);
    $('#editSeriesRow').classList.toggle('hidden', !series);
    if (series) {
      $('#editSeriesSummary').textContent = `重复：${describeSeriesRule(series)}`;
      $('#editSeriesFrequency').value = series.rule.frequency;
      $('#editSeriesInterval').value = String(series.rule.interval);
      $('#editSeriesStrategy').value = series.rule.strategy;
      syncPressedButtons('.edit-series-weekday', button => (
        (series.rule.weekdays || []).includes(Number(button.dataset.weekday))
      ));
      $('#editSeriesWeekdays').classList.toggle('hidden', series.rule.frequency !== 'weekly');
      const ended = series.state === 'ended';
      $('#editSeriesSave').disabled = ended;
      $('#editSeriesPause').classList.toggle('hidden', series.state !== 'active');
      $('#editSeriesResume').classList.toggle('hidden', series.state !== 'paused');
      $('#editSeriesEnd').classList.toggle('hidden', ended);
    }
    renderSteps();
    showError('');
    mask.classList.remove('hidden');
    mask.setAttribute('aria-hidden', 'false');
    const display = draft;
    requestAnimationFrame(() => { if (isCurrent(display)) $('#editTitle').focus(); });
  }

  // 只发真正变了的字段。全量上传会把用户没碰过的字段也计作一次修改，
  // 在 current-and-future 范围下那等于用默认值重写系列模版。
  function buildPatch(task) {
    const patch = {};
    const title = $('#editTitle').value.trim();
    if (title && title !== task.title) patch.title = title;
    const description = $('#editDescription').value.trim();
    if (description !== (task.description || '')) patch.description = description || null;
    const energyButton = [...$$('.edit-energy-chip')].find(button => button.classList.contains('active'));
    const energy = energyButton ? energyButton.dataset.editEnergy : null;
    if (energy && energy !== (task.energyAuto ? 'auto' : task.energy)) patch.energy = energy;
    const plannedFor = $('#editPlannedFor').value || null;
    if (plannedFor !== (task.plannedFor || null)) patch.plannedFor = plannedFor;
    const scheduledInput = $('#editScheduledFor');
    const currentScheduled = task.scheduledFor ? localDateTimeInputValue(task.scheduledFor) : '';
    if (scheduledInput.value !== currentScheduled) {
      patch.scheduledFor = scheduledFromDateTimeInput(scheduledInput.value);
    }
    for (const [selector, field] of [
      ['#editDeadline', 'deadline'],
      ['#editExpiresAt', 'expiresAt']
    ]) {
      const next = endOfLocalDateISO($(selector).value) || null;
      const currentDay = task[field] ? localDateInputValue(task[field]) : '';
      if ($(selector).value !== currentDay) patch[field] = next;
    }
    const estimate = readNumberInput('#editEstimate');
    if (estimate !== (task.estimateMinutes === undefined ? null : task.estimateMinutes)) {
      patch.estimateMinutes = estimate;
    }
    const tags = parseTagList($('#editTags').value);
    if (tags.join('\u0000') !== (task.tags || []).join('\u0000')) patch.tags = tags;
    const steps = buildStepOperations();
    if (steps.length) patch.steps = steps;
    return patch;
  }

  // 操作的先后顺序本身就是契约：core 按数组顺序逐条应用，而 reorder 要求
  // stepIds 是应用到那一步时的完整名单。所以 remove 在前（名单变短），reorder
  // 紧随其后，add 必须排在最后——新步骤此刻还没有 ID，先 add 会让名单少一个，
  // 整个 patch 以 step-order-mismatch 被拒，用户这一次的全部修改一起丢失。
  function buildStepOperations() {
    if (!draft) return [];
    const operations = [];
    const keptIds = new Set(draft.steps.filter(step => step.id).map(step => step.id));
    for (const id of draft.originalStepIds) {
      if (!keptIds.has(id)) operations.push({ op: 'remove', stepId: id });
    }
    const currentTaskRecord = findTask(draft.id);
    const originalTitles = new Map(((currentTaskRecord && currentTaskRecord.steps) || []).map(step => [step.id, step.title]));
    for (const step of draft.steps) {
      const title = step.title.trim();
      if (step.id && title && originalTitles.get(step.id) !== title) {
        operations.push({ op: 'rename', stepId: step.id, title });
      }
    }
    // 名单按身份取，不按标题过滤：标题是内容，顺序是身份，用内容筛名单会把
    // 一份完整名单悄悄变成残缺名单，重排就跟着一起丢了。
    const keptOrder = draft.steps.filter(step => step.id).map(step => step.id);
    const originalOrder = draft.originalStepIds.filter(id => keptIds.has(id));
    if (keptOrder.join(',') !== originalOrder.join(',')) {
      operations.push({ op: 'reorder', stepIds: keptOrder });
    }
    for (const step of draft.steps) {
      const title = step.title.trim();
      if (!step.id && title) operations.push({ op: 'add', title });
    }
    return operations;
  }

  async function submit() {
    if (!isCurrent(draft) || operation) return;
    const task = findTask(draft.id);
    if (!task) {
      showError('这件任务已不在列表中，请关闭后重新选择。');
      return;
    }
    // 空标题不能当成“没改”悄悄咽下去：用户清空了输入框并按了保存，就得听到
    // 一句为什么没生效，否则他会以为改动已经存下了。
    if (!$('#editTitle').value.trim()) {
      showError('标题不能为空。想放弃这次修改就按取消。');
      return;
    }
    const blankStep = draft.steps.findIndex(step => !step.title.trim());
    if (blankStep !== -1) {
      showError(`第 ${blankStep + 1} 步还没有标题；要删掉它请按 ✕。`);
      return;
    }
    const tagsError = tagInputError($('#editTags').value);
    if (tagsError) {
      showError(tagsError);
      return;
    }
    const estimateError = estimateInputError('#editEstimate');
    if (estimateError) {
      showError(estimateError);
      return;
    }
    const patch = buildPatch(task);
    if (Object.keys(patch).length === 0) { close(); return; }
    if (task.seriesId && !draft.scope) {
      showError('请选择这次修改只影响本次，还是同时影响以后。');
      return;
    }
    const owner = beginOperation();
    if (!owner) return;
    try {
      const result = await surfaceClient.updateTask(task.id, patch, owner.display.scope || undefined);
      if (!ownsOperation(owner)) return;
      if (result && result.ok === false) throw new Error(result.reason || 'task-update-rejected');
      close();
    } catch (_) {
      if (ownsOperation(owner)) showError('这次没有保存成功。修改仍在输入框里，请检查后重试。');
    } finally {
      finishOperation(owner);
    }
  }

  function addStep() {
    if (!draft) return;
    if (draft.steps.length >= maxSteps) {
      showError(`每个任务最多 ${maxSteps} 个步骤。`);
      return;
    }
    draft.steps = [...draft.steps, { id: null, title: '', done: false }];
    showError('');
    renderSteps();
    const inputs = $$('#editSteps .edit-step-title');
    if (inputs.length) inputs[inputs.length - 1].focus();
  }

  // 系列规则只往前生效：保存不回写历史，也不回写当前这一次。
  async function saveSeriesRule() {
    if (!isCurrent(draft) || operation || !draft.seriesId || $('#editSeriesSave').disabled) return;
    const frequency = $('#editSeriesFrequency').value;
    const interval = Number($('#editSeriesInterval').value);
    const weekdays = frequency === 'weekly'
      ? [...$$('.edit-series-weekday.active')].map(button => Number(button.dataset.weekday)).sort((a, b) => a - b)
      : null;
    const intervalError = recurrenceIntervalError(interval);
    if (intervalError) {
      showError(intervalError);
      return;
    }
    if (frequency === 'weekly' && weekdays.length === 0) {
      showError('每周规则至少选择一个星期。');
      return;
    }
    await updateSeries({
      rule: { frequency, interval, weekdays, strategy: $('#editSeriesStrategy').value }
    }, '未来重复规则已保存；历史和当前这一次没有被回写。');
  }

  // 暂停 / 恢复 / 结束只动系列，不回写历史。恢复一个已经关闭的系列时，主
  // 进程会在同一事务里物化至多一个当前可用 occurrence。
  const SERIES_STATE_ACTIONS = [
    ['#editSeriesPause', 'paused', '重复已暂停；当前这一次仍然可以做完。'],
    ['#editSeriesResume', 'active', '重复已恢复；如果没有开放实例，下一次已经排好。'],
    ['#editSeriesEnd', 'ended', '重复已结束；当前这一次仍然可以做完。']
  ];

  async function setSeriesState(seriesState, note) {
    if (!isCurrent(draft) || operation || !draft.seriesId) return;
    await updateSeries({ state: seriesState }, note);
  }

  async function updateSeries(patch, note) {
    const owner = beginOperation();
    if (!owner) return;
    try {
      const result = await surfaceClient.updateSeries(owner.display.seriesId, patch);
      if (!ownsOperation(owner)) return;
      showError(result && result.ok === false ? taskActionMessage(result.reason) : note);
    } catch (_) {
      if (ownsOperation(owner)) showError('这次没有保存成功。修改仍在输入框里，请检查后重试。');
    } finally {
      finishOperation(owner);
    }
  }

  function mount() {
    if (mounted) return;
    mounted = true;
    listen($('#taskEditConfirm'), 'click', submit);
    listen($('#taskEditClose'), 'click', close);
    listen($('#taskEditCancel'), 'click', close);
    listen($('#editAddStep'), 'click', addStep);
    for (const chip of $$('.edit-energy-chip')) {
      listen(chip, 'click', () => syncPressedButtons('.edit-energy-chip', button => button === chip));
    }
    for (const chip of $$('.edit-scope-chip')) {
      listen(chip, 'click', () => {
        if (!draft) return;
        draft.scope = chip.dataset.scope;
        syncPressedButtons('.edit-scope-chip', button => button === chip);
      });
    }
    listen($('#editSeriesFrequency'), 'change', () => {
      $('#editSeriesWeekdays').classList.toggle('hidden', $('#editSeriesFrequency').value !== 'weekly');
    });
    for (const button of $$('.edit-series-weekday')) {
      listen(button, 'click', () => {
        button.classList.toggle('active');
        button.setAttribute('aria-pressed', String(button.classList.contains('active')));
      });
    }
    listen($('#editSeriesSave'), 'click', saveSeriesRule);
    for (const [selector, seriesState, note] of SERIES_STATE_ACTIONS) {
      listen($(selector), 'click', () => setSeriesState(seriesState, note));
    }
  }

  function dispose() {
    mounted = false;
    while (teardown.length) teardown.pop()();
    draft = null;
    trigger = null;
    operation = null;
  }

  return Object.freeze({ mount, dispose, isOpen, open, close });
}


export { createPopoverTaskEditor };
