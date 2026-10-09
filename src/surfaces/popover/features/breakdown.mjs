import { t, getLocale, onLocaleChanged } from '../../shared/interface/i18n.mjs';
'use strict';

// 拆解弹层:对手里这件已经存在的任务说“帮我拆一下”。
//
// 旧版的“拆解”读输入框并建一个新任务,于是它和 ➕ 本质上是同一个动作的两个说法,
// 而真正缺的那个入口一个都没有。这一层的产物只能经既有任务的编辑事务加步骤,
// 不会再凭空多出一件任务。
//
// 它不认识 state:AI 开关、落点提示、焦点归还都由外面注入,所以换一套状态源不用
// 改这里一行。
function createPopoverBreakdownFeature({
  document, $, $$, escapeHTML, syncPressedButtons, bindStepTitleField, maxSteps,
  surfaceClient, taskActionMessage, fallbackReasonText,
  isAiEnabled, activeLandingPrompt, isLandingModalOpen, renderLanding,
  rememberLandingReturnFocus, restoreModalFocus, showTaskPanelStatus
} = {}) {
  if (!document || typeof $ !== 'function' || typeof $$ !== 'function') {
    throw new TypeError('popover breakdown requires document, $ and $$');
  }
  if (!surfaceClient || typeof surfaceClient.previewBreakdown !== 'function') {
    throw new TypeError('popover breakdown requires surfaceClient');
  }
  if (!Number.isFinite(maxSteps)) throw new TypeError('popover breakdown requires maxSteps');
  for (const [name, fn] of Object.entries({
    escapeHTML, syncPressedButtons, bindStepTitleField, taskActionMessage, fallbackReasonText,
    isAiEnabled, activeLandingPrompt, isLandingModalOpen, renderLanding,
    rememberLandingReturnFocus, restoreModalFocus, showTaskPanelStatus
  })) {
    if (typeof fn !== 'function') throw new TypeError(`popover breakdown requires ${name}`);
  }

  const EMPTY_CONTEXT = {
    taskId: null, seriesId: null, scope: null,
    title: '', steps: [], proposalId: null, provider: 'deterministic', saving: false
  };
  let breakdownContext = { ...EMPTY_CONTEXT };
  // 每次打开或关闭都让代号 +1。一次 preview 或一次保存跨了 IPC 之后,回来的响应
  // 要先证明自己还属于当前这次编辑——否则第一件任务的迟到响应会关掉或清空第二
  // 件任务的编辑上下文。
  let requestGeneration = 0;
  let breakdownTrigger = null;
  let mounted = false, stopLocale = null;
  let errorCopy = () => '', providerCopy = () => '', questionCopy = () => '';
  const setProviderCopy = copy => { providerCopy = typeof copy === 'function' ? copy : () => t(copy); $('#breakdownProvider').textContent = providerCopy(); };

  function isOpen() {
    return !$('#breakdownMask').classList.contains('hidden');
  }

  function context() {
    return { ...breakdownContext, steps: breakdownContext.steps.map(step => ({ ...step })) };
  }

  function showError(message = '') {
    const error = $('#breakdownError');
    if (!error) return;
    errorCopy = typeof message === 'function' ? message : () => t(message);
    error.textContent = errorCopy();
    error.classList.toggle('hidden', !message);
  }

  function showLoading(task, aiEnabled) {
    breakdownContext = {
      taskId: task.id,
      seriesId: task.seriesId || null,
      scope: null,
      title: task.title,
      steps: [],
      proposalId: null,
      provider: aiEnabled ? 'api' : 'deterministic',
      saving: false
    };
    $('#bdOriginal').textContent = task.title;
    const providerNote = $('#breakdownProvider');
    setProviderCopy(aiEnabled ? 'AI 正在拆这件事…' : '正在按通用模板拆…');
    providerNote.classList.remove('hidden');
    const question = $('#breakdownQuestion');
    questionCopy = () => ''; question.textContent = '';
    question.classList.add('hidden');
    $('#bdScopeRow').classList.add('hidden');
    syncPressedButtons('.bd-scope-chip', () => false);
    showError('');
    $('#bdSteps').innerHTML = `
    <div class="bd-loading" role="status" aria-live="polite">
      <span class="bd-loading-pixels" aria-hidden="true"><i></i><i></i><i></i></span>
      <span class="bd-loading-copy">${t('正在把任务整理成可以直接开始的小步骤')}</span>
    </div>`;
    $('#bdAddStep').disabled = true;
    $('#bdConfirm').disabled = true;
    $('#bdConfirm').textContent = t('加到步骤里');
    const mask = $('#breakdownMask');
    mask.dataset.state = 'loading';
    mask.setAttribute('aria-busy', 'true');
    mask.classList.remove('hidden');
    mask.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => $('#bdClose').focus());
  }

  function finishLoading() {
    $('#breakdownMask').dataset.state = 'ready';
    $('#breakdownMask').setAttribute('aria-busy', 'false');
    $('#bdAddStep').disabled = false;
    $('#bdConfirm').disabled = false;
    $('#bdConfirm').textContent = t('加到步骤里');
  }

  function setSaving(saving) {
    breakdownContext.saving = saving;
    const mask = $('#breakdownMask');
    mask.dataset.state = saving ? 'saving' : 'ready';
    mask.setAttribute('aria-busy', String(saving));
    $('#bdConfirm').disabled = saving;
    $('#bdConfirm').textContent = t(saving ? '正在保存…' : '加到步骤里');
    $('#bdAddStep').disabled = saving || breakdownContext.steps.length >= maxSteps;
    $$('#bdSteps .bd-step-input, #bdSteps .bd-step-del, .bd-scope-chip').forEach(control => {
      control.disabled = saving;
    });
  }

  function renderSteps() {
    const wrap = $('#bdSteps');
    wrap.innerHTML = '';
    breakdownContext.steps.forEach((s, i) => {
      const row = document.createElement('div');
      row.className = 'bd-step';
      row.innerHTML = `
      <div class="bd-step-num">${i + 1}</div>
      <textarea class="bd-step-input" maxlength="200" rows="1" placeholder="${t('这一步做什么...')}" aria-label="${escapeHTML(t('第 {number} 步', { number: i + 1 }))}">${escapeHTML(s.title)}</textarea>
      <button type="button" class="bd-step-del" aria-label="${escapeHTML(t('删除第 {number} 步', { number: i + 1 }))}">✕</button>
    `;
      bindStepTitleField(row.querySelector('.bd-step-input'), value => {
        breakdownContext.steps[i].title = value;
      });
      row.querySelector('.bd-step-del').addEventListener('click', () => {
        breakdownContext.steps.splice(i, 1);
        renderSteps();
      });
      wrap.appendChild(row);
    });
    const addButton = $('#bdAddStep');
    if (addButton) {
      addButton.disabled = breakdownContext.steps.length >= maxSteps;
      addButton.title = addButton.disabled ? t('每个任务最多 {count} 个步骤', { count: maxSteps }) : '';
    }
  }

  async function open(task, trigger = document.activeElement) {
    if (!task) return;
    if (activeLandingPrompt() || isLandingModalOpen()) {
      renderLanding();
      return;
    }
    const generation = ++requestGeneration;
    breakdownTrigger = trigger;
    const request = {
      title: task.title,
      description: task.description || null,
      clarification: null,
      taskId: task.id
    };
    const aiEnabled = Boolean(isAiEnabled());
    showTaskPanelStatus('');
    showLoading(task, aiEnabled);
    let preview;
    try {
      if (aiEnabled) {
        preview = await surfaceClient.previewAiBreakdown(request);
      } else {
        preview = {
          ok: true,
          steps: await surfaceClient.previewBreakdown(task.title),
          provider: 'deterministic',
          proposalId: null
        };
      }
    } catch (_) {
      if (generation !== requestGeneration) return;
      finishLoading();
      $('#bdSteps').innerHTML = '';
      setProviderCopy('生成没有完成；任务本身没有变化，你也可以手动加一步。');
      showError('这次没能生成拆解建议，请稍后重试。');
      showTaskPanelStatus(() => t('这次没能生成拆解建议，任务本身没有变。'));
      return;
    }
    if (generation !== requestGeneration) {
      if (preview && preview.proposalId) {
        void surfaceClient.dismissBreakdownProposal(preview.proposalId).catch(() => {});
      }
      return;
    }
    showTaskPanelStatus('');
    if (!preview || preview.ok === false || !Array.isArray(preview.steps)) {
      if (preview && preview.proposalId) {
        void surfaceClient.dismissBreakdownProposal(preview.proposalId).catch(() => {});
      }
      finishLoading();
      $('#bdSteps').innerHTML = '';
      setProviderCopy('生成没有完成；任务本身没有变化，你也可以手动加一步。');
      const message = () => {
        const failure = preview?.reason ? taskActionMessage(preview.reason) : t('这次没能生成拆解建议，任务本身没有变。');
        return preview?.providerReason ? `${failure} ${fallbackReasonText(preview.providerReason)}` : failure;
      };
      showError(message); showTaskPanelStatus(message);
      return;
    }
    // preview 跨了 IPC。它在路上时会话可能刚好结束并弹出那个必须表态的落点提示,
    // 那时 aria-modal 层归落点决策所有:先关掉这份预览,再让落点提示露出来。
    if (activeLandingPrompt() || isLandingModalOpen()) {
      if (preview.proposalId) {
        void surfaceClient.dismissBreakdownProposal(preview.proposalId).catch(() => {});
      }
      close();
      return;
    }
    breakdownContext = {
      taskId: task.id,
      seriesId: task.seriesId || null,
      scope: null,
      title: task.title,
      steps: preview.steps.map(step => ({ title: step.title, done: false })),
      proposalId: preview.proposalId || null,
      provider: preview.provider || 'deterministic',
      saving: false
    };
    finishLoading();
    const providerNote = $('#breakdownProvider');
    setProviderCopy(() => preview.fallback
      ? t('Provider 不可用，已安全回退到本地确定性模板（{reason}）。', { reason: fallbackReasonText(preview.reason) || t('未提供原因') })
      : t(preview.provider === 'api' ? '这份只读建议来自已启用的 API。' : '这份建议来自本地确定性模板。'));
    providerNote.classList.remove('hidden');
    const question = $('#breakdownQuestion');
    questionCopy = () => preview.clarifyingQuestion ? t('可选澄清：{question}', { question: preview.clarifyingQuestion }) : '';
    question.textContent = questionCopy();
    question.classList.toggle('hidden', !preview.clarifyingQuestion);
    $('#bdScopeRow').classList.toggle('hidden', !breakdownContext.seriesId);
    syncPressedButtons('.bd-scope-chip', () => false);
    showError('');
    renderSteps();
    requestAnimationFrame(() => {
      const firstInput = $('#bdSteps .bd-step-input');
      (firstInput || $('#bdClose')).focus();
    });
  }

  function close() {
    requestGeneration += 1;
    errorCopy = () => ''; providerCopy = () => ''; questionCopy = () => '';
    const proposalId = breakdownContext.proposalId;
    const trigger = breakdownTrigger;
    breakdownContext = { ...EMPTY_CONTEXT };
    breakdownTrigger = null;
    // 关掉就意味着这份只读建议不会被采纳:主进程要立刻知道,否则它会一直占着一个
    // 待消费的 proposal。
    if (proposalId) {
      void surfaceClient.dismissBreakdownProposal(proposalId).catch(() => {});
    }
    // 还在等模型的话，没人要这个答案了：让主进程把请求掰断。
    if (typeof surfaceClient.cancelAiRequests === 'function') void surfaceClient.cancelAiRequests().catch(() => {});
    $('#breakdownMask').classList.add('hidden');
    $('#breakdownMask').setAttribute('aria-hidden', 'true');
    $('#breakdownMask').setAttribute('aria-busy', 'false');
    if (activeLandingPrompt()) {
      rememberLandingReturnFocus(trigger);
      renderLanding();
      return;
    }
    restoreModalFocus(trigger);
  }

  const onClose = () => close();
  const onScopeChip = chip => () => {
    breakdownContext.scope = chip.dataset.bdScope;
    syncPressedButtons('.bd-scope-chip', button => button.dataset.bdScope === breakdownContext.scope);
    showError('');
  };
  const scopeChipHandlers = new Map();

  const onAddStep = () => {
    if (breakdownContext.steps.length >= maxSteps) {
      showError(() => t('每个任务最多 {count} 个步骤。', { count: maxSteps }));
      return;
    }
    breakdownContext.steps.push({ title: '', done: false });
    showError('');
    renderSteps();
    const inputs = $$('#bdSteps .bd-step-input');
    if (inputs.length) inputs[inputs.length - 1].focus();
  };

  const onConfirm = async () => {
    if (breakdownContext.saving) return;
    const validSteps = breakdownContext.steps.filter(s => s.title && s.title.trim());
    if (validSteps.length === 0) {
      showError('至少要留一个步骤，或者按“不用了”关掉。');
      return;
    }
    if (validSteps.length > maxSteps) {
      showError(() => t('每个任务最多 {count} 个步骤。', { count: maxSteps }));
      return;
    }
    if (breakdownContext.seriesId && !breakdownContext.scope) {
      showError('请选择这次修改只影响本次，还是同时影响以后。');
      return;
    }
    const titles = validSteps.map(step => ({ title: step.title.trim() }));
    const submissionGeneration = requestGeneration;
    const submission = {
      taskId: breakdownContext.taskId,
      scope: breakdownContext.scope || undefined,
      proposalId: breakdownContext.proposalId
    };
    setSaving(true);
    // 带 proposalId 的走 apply-proposal，主进程会同时消费掉这份只读建议；确定性模板
    // 没有 proposal，直接走任务编辑事务。两条路径在主进程里汇到同一个 updateTask。
    let result;
    try {
      result = submission.proposalId
        ? await surfaceClient.applyBreakdownProposal(submission.proposalId, titles, {
          targetTaskId: submission.taskId,
          scope: submission.scope
        })
        : await surfaceClient.updateTask(
          submission.taskId,
          { steps: titles.map(step => ({ op: 'add', title: step.title })) },
          submission.scope
        );
    } catch (_) {
      result = null;
    }
    // 关掉这个弹层、或换到另一件任务,都会让这次响应作废。旧请求可能仍会在主进程
    // 里跑完,但它绝不能关掉或改写更新的那一次编辑。
    if (submissionGeneration !== requestGeneration) return;
    if (!result || result.ok === false) {
      setSaving(false);
      showError(() => result && result.reason === 'proposal-expired'
        ? t('建议已过期，请关闭后重新生成。')
        : result && result.reason
          ? taskActionMessage(result.reason)
          : t('这次没有保存，当前编辑仍然保留。'));
      return;
    }
    breakdownContext.proposalId = null;
    close();
  };

  function repaintCopy() {
    if (!isOpen()) return;
    $('#breakdownError').textContent = errorCopy();
    $('#breakdownProvider').textContent = providerCopy();
    $('#breakdownQuestion').textContent = questionCopy();
    $('#bdConfirm').textContent = t(breakdownContext.saving ? '正在保存…' : '加到步骤里');
    const loading = $('#bdSteps').querySelector('.bd-loading-copy');
    if (loading) loading.textContent = t('正在把任务整理成可以直接开始的小步骤');
    $('#bdSteps').querySelectorAll('.bd-step').forEach((row, index) => {
      const input = row.querySelector('.bd-step-input');
      input?.setAttribute('placeholder', t('这一步做什么...'));
      input?.setAttribute('aria-label', t('第 {number} 步', { number: index + 1 }));
      row.querySelector('.bd-step-del')?.setAttribute('aria-label', t('删除第 {number} 步', { number: index + 1 }));
    });
    const add = $('#bdAddStep');
    if (add) add.title = add.disabled ? t('每个任务最多 {count} 个步骤', { count: maxSteps }) : '';
  }

  function mount() {
    if (mounted) return;
    mounted = true;
    stopLocale = onLocaleChanged(repaintCopy);
    $('#bdClose').addEventListener('click', onClose);
    $('#bdCancel').addEventListener('click', onClose);
    $$('.bd-scope-chip').forEach(chip => {
      const handler = onScopeChip(chip);
      scopeChipHandlers.set(chip, handler);
      chip.addEventListener('click', handler);
    });
    $('#bdAddStep').addEventListener('click', onAddStep);
    $('#bdConfirm').addEventListener('click', onConfirm);
  }

  function dispose() {
    if (!mounted) return;
    mounted = false;
    stopLocale?.(); stopLocale = null;
    errorCopy = () => ''; providerCopy = () => ''; questionCopy = () => '';
    // 挂在 in-flight 请求上的代号也要作废:面板关掉之后回来的响应不该再碰 DOM。
    requestGeneration += 1;
    $('#bdClose').removeEventListener('click', onClose);
    $('#bdCancel').removeEventListener('click', onClose);
    for (const [chip, handler] of scopeChipHandlers) chip.removeEventListener('click', handler);
    scopeChipHandlers.clear();
    $('#bdAddStep').removeEventListener('click', onAddStep);
    $('#bdConfirm').removeEventListener('click', onConfirm);
  }

  return Object.freeze({ mount, dispose, open, close, isOpen, context });
}

export { createPopoverBreakdownFeature };
