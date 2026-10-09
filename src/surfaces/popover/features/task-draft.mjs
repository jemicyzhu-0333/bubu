'use strict';

// 新任务弹层：一张草稿，一次提交。
//
// 这一层拥有草稿的全部可变状态——能量、步骤、步骤是不是 AI 给的、打开它的那个
// 控件——以及“什么时候”那一组字段（委托给 ui/task-when-fields）。之前这些状态是
// 面板顶上的十来个模块级 let：一张常驻表单里的模块级选择，等于替每一件新事预设
// 了上一件事的计划。现在它们只在这一层里存在，弹层关掉就随之作废。
//
// 它不认识 state：自动失效的默认区间与 AI 建议都从 surfaceClient / 注入的读取器
// 来，所以换一套状态源不用改这里一行。它也不认识别的弹层：关闭后焦点归还给谁，
// 由注入的 restoreModalFocus 统一决定。
function createPopoverTaskDraft({
  document, $, $$, escapeHTML, syncPressedButtons, readNumberInput,
  bindStepTitleField, parseTagList, tagInputError, estimateInputError, maxSteps,
  surfaceClient, breakdownProviderLabel, fallbackReasonSuffix,
  whenFields, restoreModalFocus, showStatus
} = {}) {
  if (!document || typeof $ !== 'function' || typeof $$ !== 'function') {
    throw new TypeError('popover task draft requires document, $ and $$');
  }
  for (const [name, fn] of [
    ['escapeHTML', escapeHTML],
    ['syncPressedButtons', syncPressedButtons],
    ['readNumberInput', readNumberInput],
    ['bindStepTitleField', bindStepTitleField],
    ['parseTagList', parseTagList],
    ['tagInputError', tagInputError],
    ['estimateInputError', estimateInputError],
    ['breakdownProviderLabel', breakdownProviderLabel],
    ['fallbackReasonSuffix', fallbackReasonSuffix],
    ['restoreModalFocus', restoreModalFocus],
    ['showStatus', showStatus]
  ]) {
    if (typeof fn !== 'function') throw new TypeError(`popover task draft requires ${name}`);
  }
  if (!Number.isFinite(maxSteps)) throw new TypeError('popover task draft requires maxSteps');
  if (!surfaceClient || typeof surfaceClient.addTask !== 'function') {
    throw new TypeError('popover task draft requires surfaceClient');
  }
  if (!whenFields || typeof whenFields.values !== 'function' || typeof whenFields.validate !== 'function') {
    throw new TypeError('popover task draft requires whenFields');
  }

  let selectedEnergy = 'auto';           // 默认自动推断
  let createStepsDraft = [];             // 弹层里的步骤草稿,保存前不落库
  let createStepsFromSuggestion = false;
  let trigger = null;
  let mounted = false;
  let draftGeneration = 0;
  let saving = false;
  let enrichRequest = null;

  function isCurrent(generation) {
    return generation === draftGeneration && isOpen();
  }

  function clearEnrich() {
    if (!enrichRequest) return;
    clearInterval(enrichRequest.ticking);
    enrichRequest.button.disabled = false;
    enrichRequest.button.textContent = enrichRequest.label;
    enrichRequest = null;
  }

  // A closed, replaced or disposed draft cannot receive an earlier IPC result.
  // Invalidating the view does not cancel or retry an in-flight task commit.
  function invalidateDraft() {
    draftGeneration += 1;
    saving = false;
    clearEnrich();
    const confirmButton = $('#taskCreateConfirm');
    if (confirmButton) confirmButton.disabled = false;
  }

  const teardown = [];
  function listen(target, type, handler) {
    if (!target) return;
    target.addEventListener(type, handler);
    teardown.push(() => target.removeEventListener(type, handler));
  }

  // ⚠️ contextBridge 暴露给渲染层的 surfaceClient 是冻结对象，不能用猴补丁去注入
  // 字段（之前就是因为这个，字段根本没发到主进程）
  // → 所有发送点都走这个显式 payload 构造器。日期与重复规则由 whenFields 报告，
  // 没选就是没选：不再有“选了一个分类，默默定下其他三个字段”这回事。
  function buildTaskPayload(extra) {
    const descriptionInput = $('#taskDescriptionInput');
    const description = descriptionInput && descriptionInput.value.trim()
      ? descriptionInput.value.trim()
      : null;
    return {
      description,
      energy: selectedEnergy,
      tags: parseTagList($('#tagsInput') ? $('#tagsInput').value : ''),
      estimateMinutes: readNumberInput('#estimateInput'),
      ...whenFields.values(),
      ...extra
    };
  }

  async function persist(extra, { breakdown = false, generation } = {}) {
    try {
      const payload = buildTaskPayload(extra);
      const result = breakdown
        ? await surfaceClient.addWithBreakdown(payload)
        : await surfaceClient.addTask(payload);
      if (result && result.ok === false) throw new Error(result.reason || 'task-save-rejected');
      if (isCurrent(generation)) showStatus('');
      return true;
    } catch (_) {
      if (isCurrent(generation)) showStatus('任务没有保存，输入内容还在。检查日期与重复设置后再试一次。');
      return false;
    }
  }

  // 捕捉只需要标题。没有任何字段能再把保存拦在门外：中期任务强制 DDL 那条
  // 规则跟着 category 一起没了，想起一件事就能直接写下来。
  async function submit(extra, { breakdown = false, generation, onSuccess } = {}) {
    for (const message of [
      tagInputError($('#tagsInput') ? $('#tagsInput').value : ''),
      estimateInputError('#estimateInput'),
      whenFields.validate()
    ]) {
      if (message) {
        showStatus(message);
        return false;
      }
    }
    const saved = await persist(extra, { breakdown, generation });
    if (saved && isCurrent(generation) && typeof onSuccess === 'function') onSuccess();
    return saved;
  }

  // 每次打开都重置整张草稿。之前保存后只清标题，于是“截止=明天”会静默跟到下一件
  // 事上：一张常驻表单里的模块级选择，等于替每一件新事预设了上一件事的计划。
  function reset({ title = '' } = {}) {
    invalidateDraft();
    selectedEnergy = 'auto';
    createStepsDraft = [];
    createStepsFromSuggestion = false;

    for (const [selector, value] of [
      ['#taskInput', title], ['#taskDescriptionInput', ''], ['#tagsInput', ''], ['#estimateInput', '']
    ]) {
      const input = $(selector);
      if (input) input.value = value;
    }
    syncPressedButtons('.energy-chip', button => button.dataset.energy === selectedEnergy);
    whenFields.reset();

    const advanced = $('#taskAdvanced');
    if (advanced) advanced.open = false;
    showStatus('');
    renderSteps();
  }

  function isOpen() {
    const mask = $('#taskCreateMask');
    return Boolean(mask && !mask.classList.contains('hidden'));
  }

  function open({ title = '' } = {}) {
    trigger = document.activeElement;
    reset({ title });
    const mask = $('#taskCreateMask');
    if (!mask) return;
    mask.classList.remove('hidden');
    mask.setAttribute('aria-hidden', 'false');
    const generation = draftGeneration;
    requestAnimationFrame(() => {
      if (isCurrent(generation)) $('#taskInput').focus();
    });
  }

  function close() {
    invalidateDraft();
    const mask = $('#taskCreateMask');
    const returnTo = trigger;
    if (typeof surfaceClient.cancelAiRequests === 'function') void surfaceClient.cancelAiRequests().catch(() => {});
    trigger = null;
    if (mask) {
      mask.classList.add('hidden');
      mask.setAttribute('aria-hidden', 'true');
    }
    restoreModalFocus(returnTo);
  }

  function renderSteps() {
    const wrap = $('#createSteps');
    const stepsBlock = $('#createStepsBlock');
    if (stepsBlock) stepsBlock.classList.toggle('hidden', !createStepsDraft.length);
    if (!wrap) return;
    wrap.innerHTML = '';
    createStepsDraft.forEach((step, index) => {
      const row = document.createElement('div');
      row.className = 'bd-step';
      row.innerHTML = `
      <div class="bd-step-num">${index + 1}</div>
      <textarea class="bd-step-input" maxlength="200" rows="1" placeholder="这一步做什么..." aria-label="第 ${index + 1} 步">${escapeHTML(step.title)}</textarea>
      <button type="button" class="bd-step-del" aria-label="删除第 ${index + 1} 步">✕</button>
    `;
      bindStepTitleField(row.querySelector('.bd-step-input'), value => {
        createStepsDraft[index].title = value;
      });
      row.querySelector('.bd-step-del').addEventListener('click', () => {
        createStepsDraft.splice(index, 1);
        renderSteps();
      });
      wrap.appendChild(row);
    });
    const addButton = $('#createAddStep');
    if (addButton) {
      addButton.disabled = createStepsDraft.length >= maxSteps;
      addButton.title = addButton.disabled ? `每个任务最多 ${maxSteps} 个步骤` : '';
    }
  }

  function addStep() {
    if (createStepsDraft.length >= maxSteps) {
      showStatus(`每个任务最多 ${maxSteps} 个步骤。`);
      return;
    }
    createStepsDraft.push({ title: '' });
    showStatus('');
    renderSteps();
    const inputs = $$('#createSteps .bd-step-input');
    if (inputs.length) inputs[inputs.length - 1].focus();
  }

  async function submitCreate() {
    if (!mounted || !isOpen() || saving) return;
    const titleInput = $('#taskInput');
    const title = titleInput.value.trim();
    if (!title) {
      showStatus('先写一句要做什么，其他都可以留空。');
      titleInput.focus();
      return;
    }
    const blankStep = createStepsDraft.findIndex(step => !step.title.trim());
    if (blankStep !== -1) {
      showStatus(`第 ${blankStep + 1} 步还没有标题；要删掉它请按 ✕。`);
      return;
    }
    // 步骤对象在 tasks:add / tasks:add-with-breakdown 上是封闭的，只收 title：
    // done 由主进程写成 false。渲染层多带一个字段不是“冗余”，而是整条保存被
    // unknown field 拒掉，于是带步骤的任务一件都存不进去。
    const steps = createStepsDraft
      .map(step => ({ title: step.title.trim() }))
      .filter(step => step.title);
    if (steps.length > maxSteps) {
      showStatus(`每个任务最多 ${maxSteps} 个步骤。`);
      return;
    }
    const confirmButton = $('#taskCreateConfirm');
    const generation = draftGeneration;
    saving = true;
    clearEnrich();
    confirmButton.disabled = true;
    try {
      await submit(steps.length ? { title, steps } : { title }, {
        breakdown: steps.length > 0 && createStepsFromSuggestion,
        generation,
        onSuccess: close
      });
    } finally {
      if (generation === draftGeneration) {
        saving = false;
        confirmButton.disabled = false;
      }
    }
  }

  // 建议只落进这张草稿，一个字段都不直接写库。被填过的字段一律把折叠区展开：
  // 悄悄塞进收起来的表单里的值，保存时和用户自己填的分量一样。
  function applyEnrichSuggestion(suggestion) {
    // 没有用到模型就不替这件事想。本地规则只能给一份对谁都一样的步骤、完成标准和估时，
    // 填进去看起来像是想过，其实对这件事什么也没说，还占着草稿里的位置等人去删。
    // 所以这里一个字段都不填，只说清楚为什么，并把光标放到“加一步”上，让人自己写下第一个看得见的动作。
    const usedModel = suggestion.provider === 'api' && !suggestion.fallback;
    if (!usedModel) {
      showStatus(`没有用 AI，所以没替你拆。先写下第一个看得见的动作，比如“打开……”。${fallbackReasonSuffix(suggestion)}`);
      const addStep = $('#createAddStep');
      if (addStep && typeof addStep.focus === 'function') addStep.focus();
      return;
    }
    const filled = [];
    if (Array.isArray(suggestion.steps) && suggestion.steps.length) {
      createStepsDraft = suggestion.steps
        .slice(0, maxSteps)
        .map(step => ({ title: step.title }));
      createStepsFromSuggestion = true;
      renderSteps();
      filled.push(`${createStepsDraft.length} 个步骤`);
    }
    const description = $('#taskDescriptionInput');
    if (suggestion.completionCriteria && description && !description.value.trim()) {
      description.value = `做完的判断：${suggestion.completionCriteria}`;
      filled.push('完成标准');
    }
    if (suggestion.energy) {
      selectedEnergy = suggestion.energy;
      syncPressedButtons('.energy-chip', button => button.dataset.energy === selectedEnergy);
      filled.push('能量');
    }
    const estimate = $('#estimateInput');
    if (Number.isInteger(suggestion.estimateMinutes) && estimate && !estimate.value.trim()) {
      estimate.value = String(suggestion.estimateMinutes);
      filled.push('估时');
    }
    const tagsInput = $('#tagsInput');
    if (Array.isArray(suggestion.tags) && suggestion.tags.length && tagsInput && !tagsInput.value.trim()) {
      tagsInput.value = suggestion.tags.join('，');
      filled.push('标签');
    }
    const advanced = $('#taskAdvanced');
    if (advanced && filled.length) advanced.open = true;
    // 能量与估时来自模型的推断就要说出口：用户在按保存之前就知道哪几项不是自己填的。
    showStatus(filled.length
      ? `已按 AI 建议填好：${filled.join('、')}。每一项都能改或清空，标题没有动。`
      : `这次没有可补的字段，已填内容保持原样。`);
  }

  // 澄清谈出来的提案接到同一张草稿上。它跟「让伙伴补全」只差一处：标题也是谈出来
  // 的，所以这里要写标题——但仍然只是写进输入框,提交照旧由用户按保存触发,走
  // submitCreate 那一条 tasks:add-with-breakdown。多轮澄清因此不需要第二条提交
  // 通道,也绕不过任务创建的任何一条不变量,而且每个字段在保存前都还能改。
  //
  // provider / fallback / reason 挂在这一轮的结果上而不在 proposal 里面,调用方要
  // 自己合过来——不合的话「这是 AI 给的还是本地模板给的」就说不出来了。
  function adopt(proposal = {}) {
    const title = typeof proposal.title === 'string' ? proposal.title : '';
    if (isOpen()) reset({ title }); else open({ title });
    // 澄清的 ready 提案给的是 notes,不是 completionCriteria；不搬这一手,谈了六轮
    // 攒出来的上下文就只剩一个标题。
    const description = $('#taskDescriptionInput');
    if (description && typeof proposal.notes === 'string' && proposal.notes.trim() && !description.value.trim()) {
      description.value = proposal.notes.trim();
    }
    applyEnrichSuggestion(proposal);
    const titleInput = $('#taskInput');
    if (titleInput && typeof titleInput.focus === 'function') titleInput.focus();
  }

  async function runEnrich() {
    if (!mounted || !isOpen() || saving || enrichRequest) return;
    const titleInput = $('#taskInput');
    const title = titleInput.value.trim();
    if (!title) {
      showStatus('先写一句要做什么，伙伴才知道要补什么。');
      titleInput.focus();
      return;
    }
    const button = $('#btnEnrichDraft');
    button.disabled = true;
    const request = { generation: draftGeneration, button, label: button.textContent, ticking: null };
    enrichRequest = request;
    const isCurrentRequest = () => enrichRequest === request && isCurrent(request.generation)
      && titleInput.value.trim() === title;
    // 云端模型想十几秒是常态。一个不动的“正在想…”和卡死无法区分，所以把已经等了
    // 多久说出来——秒数是唯一能让人判断“还要不要继续等”的信息。
    const startedAt = Date.now();
    const showElapsed = () => {
      if (isCurrentRequest()) button.textContent = `正在补全… ${Math.round((Date.now() - startedAt) / 1000)}s`;
    };
    showElapsed();
    request.ticking = setInterval(showElapsed, 1000);
    let proposalId = null;
    try {
      const suggestion = await surfaceClient.previewEnrich({
        title,
        description: $('#taskDescriptionInput').value.trim() || null,
        clarification: null
      });
      proposalId = suggestion && suggestion.proposalId ? suggestion.proposalId : null;
      // 等待期间用户可能已经保存了这件事、关掉了面板，或者把标题改成了另一件事。
      // 一份迟到的建议写进新草稿，就是替下一件事预设上一件事的计划——宁可丢掉。
      if (!isCurrentRequest()) return;
      if (!suggestion || suggestion.ok === false) {
        showStatus('这次没能给出建议，已填的内容都还在。');
        return;
      }
      applyEnrichSuggestion(suggestion);
    } catch (_) {
      if (isCurrentRequest()) showStatus('这次没能给出建议，已填的内容都还在。');
    } finally {
      if (proposalId) {
        void surfaceClient.dismissBreakdownProposal(proposalId).catch(() => {});
      }
      if (enrichRequest === request) clearEnrich();
    }
  }

  function mount() {
    if (mounted) return;
    mounted = true;
    whenFields.mount();
    listen($('#btnOpenTaskCreate'), 'click', () => open());
    listen($('#taskCreateClose'), 'click', close);
    listen($('#taskCreateCancel'), 'click', close);
    listen($('#taskCreateConfirm'), 'click', submitCreate);
    listen($('#btnEnrichDraft'), 'click', runEnrich);
    listen($('#createAddStep'), 'click', addStep);
    for (const chip of $$('.energy-chip')) {
      listen(chip, 'click', () => {
        selectedEnergy = chip.dataset.energy;
        syncPressedButtons('.energy-chip', button => button === chip);
      });
    }
    // 标题框里的 Enter 就是保存：捕捉不应该比一行常驻输入框多一步。
    listen($('#taskInput'), 'keydown', async event => {
      if (event.key === 'Enter' && !event.isComposing && event.keyCode !== 229 && event.target.value.trim()) {
        event.preventDefault();
        await submitCreate();
      }
    });
  }

  function dispose() {
    if (!mounted) return;
    mounted = false;
    invalidateDraft();
    while (teardown.length) teardown.pop()();
    whenFields.dispose();
  }

  return Object.freeze({ mount, dispose, isOpen, open, close, adopt });
}


export { createPopoverTaskDraft };
