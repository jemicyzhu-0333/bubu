import { t, getLocale } from '../../shared/interface/i18n.mjs';
import { createInterfaceSettings } from './interface-settings.mjs';
'use strict';
import { createDesktopUpdateFeature } from './desktop-updates.mjs';
import { createAiConfiguration, formatAuthorizationWarning } from './ai-configuration.mjs';

// 设置抽屉这一层:开合与背景失活、各分组里的每一个步进与开关、AI 那一组的模型、
// 地址与密钥，以及把当前设置画回抽屉的那一次渲染。
//
// 它拥有一处防闪烁的上一次键值——以前是面板顶上的模块级 lastSettingsKey——并且这个
// 键值现在把免打扰、两级提醒上限与角色也算进去了:那几件原先跟着头上那枚徽标一起
// 无条件重画，而它们本来就住在抽屉的 DOM 里、跟着 settings 这一片脏标记走。
//
// 密钥只往里走:发出前先清空输入框，任何一处都不把它写回 DOM，回执也只说成败。
// 它不认识落点提示,只知道关抽屉时可能要把 aria-modal 那一层让出去。
function createPopoverSettingsDrawer({
  document, $, $$, getState, surfaceClient, sessionDuration, syncPressedButtons,
  fallbackReasonText, motionReduced, clearDecorativeMotion, renderExpiryPreview,
  activeLandingPrompt, rememberLandingReturnFocus, renderLanding
} = {}) {
  if (!document || typeof $ !== 'function' || typeof $$ !== 'function') {
    throw new TypeError('popover settings drawer requires document, $ and $$');
  }
  for (const [name, fn] of Object.entries({
    getState, syncPressedButtons, fallbackReasonText, motionReduced,
    clearDecorativeMotion, renderExpiryPreview, activeLandingPrompt,
    rememberLandingReturnFocus, renderLanding
  })) {
    if (typeof fn !== 'function') throw new TypeError(`popover settings drawer requires ${name}`);
  }
  if (!sessionDuration) throw new TypeError('popover settings drawer requires sessionDuration');
  if (!surfaceClient) throw new TypeError('popover settings drawer requires surfaceClient');

  const interfaceSettings = createInterfaceSettings({ document, getState, surfaceClient });
  const aiConfiguration = createAiConfiguration({ document, $, getState, surfaceClient });
  const desktopUpdates = createDesktopUpdateFeature({ $, getState, surfaceClient, isVisible: isSettingsOpen });
  let lastSettingsKey = '';
  let pendingCalibrationReset = false;
  let mounted = false;
  let saveRequest = 0, lifetime = 0;
  let saveStatusCopy = () => '';
  let calibrationFeedbackSource = '';
  const teardown = [];

  function listen(target, type, handler) {
    if (!target) return;
    target.addEventListener(type, handler);
    teardown.push(() => target.removeEventListener(type, handler));
  }

  function isSettingsOpen() {
    return !$('#settingsMask').classList.contains('hidden');
  }

  function openSettingsDrawer() {
    if (isSettingsOpen()) return;
    const mask = $('#settingsMask');
    $('#appShell').inert = true;
    mask.classList.remove('hidden');
    void desktopUpdates.refresh();
    mask.setAttribute('aria-hidden', 'false');
    $('#btnSettings').setAttribute('aria-expanded', 'true');
    // 焦点进抽屉：优先给“动效”那一组的控件，但它默认在折叠的分区里——对折叠内容调用 focus() 会静默失败，
    // 焦点就留在页面背后。所以只有它当下真的看得见才用，否则退到关闭按钮。
    requestAnimationFrame(() => {
      const preferred = $('#settingsDrawer .motion-mode');
      const usable = preferred && preferred.offsetParent !== null && !preferred.closest('details:not([open])');
      (usable ? preferred : $('#btnSettingsClose')).focus();
    });
  }

  function closeSettingsDrawer() {
    if (!isSettingsOpen()) return;
    interfaceSettings.clearFeedback();
    clearPendingCalibrationReset();
    aiConfiguration.cancelTest?.();
    const mask = $('#settingsMask');
    mask.classList.add('hidden');
    mask.setAttribute('aria-hidden', 'true');
    $('#appShell').inert = false;
    $('#btnSettings').setAttribute('aria-expanded', 'false');
    if (activeLandingPrompt()) {
      rememberLandingReturnFocus($('#btnSettings'));
      renderLanding();
      return;
    }
    requestAnimationFrame(() => $('#btnSettings').focus());
  }

  function renderSettings() {
    interfaceSettings.render();
    const state = getState();
    if (!state) return;
    const storage = $('#configStorageStatus');
    if (storage) {
      const pending = state.storageStatus?.mirrorPending === true;
      storage.classList.toggle('hidden', !pending);
      storage.textContent = pending ? t('本机数据已保存到数据库。兼容文件待同步或存在外部修改，完整备份不能只复制 config.json。') : '';
    }
    const saveLine = $('#settingsSaveStatus');
    if (saveLine) saveLine.textContent = saveStatusCopy();
    const feedbackLine = $('#energyCalibrationFeedback');
    if (feedbackLine && calibrationFeedbackSource) feedbackLine.textContent = t(calibrationFeedbackSource);
    const resetButton = $('#btnResetEnergyCalibration');
    if (resetButton) resetButton.textContent = pendingCalibrationReset ? t('真的重置') : t('重置校准');
    const s = state.settings;
    const key = `${getLocale()}|${s.pomodoroMinutes}|${s.breakMinutes}|${s.softReminderEvery}|${s.hydrationEvery}`
      + `|${s.workStartHour}|${s.workEndHour}|${s.workEndReminder}|${s.adhocTtlMode}|${s.adhocTtlHours}`
      + `|${s.motionMode}|${s.stimulationMode}|${s.petActivityMode}|${s.soundEnabled}`
      + `|${s.dnd}|${s.focusMaxLevel}|${s.restMaxLevel}|${s.nudgeCharacter}`
      + `|${s.strategyGuidanceEnabled}|${s.dailyReviewEnabled}|${s.aiBreakdownEnabled}|${s.aiClarifyEnabled}|${s.aiMemoryEnabled}`
      + `|${s.aiImpulseEnergyEnabled}|${s.aiCaptureTriageEnabled}|${s.aiPetMealsEnabled}|${s.aiModel}|${s.aiBaseUrl}|${s.energyCurveEnabled}`
      // 校准状态那一行是从投影读出来的,不是设置项:学到第几次、有没有开始微调都会
      // 变,不进键值的话这一行会一直停在打开抽屉那一刻的样子。
      + `|${state.energyCurve ? `${state.energyCurve.observations}:${state.energyCurve.calibrated}` : 'off'}`
      + `|${state.ai?.credential?.credentialStatus === 'unavailable' ? 'unknown' : state.ai?.credential?.configured ?? 'unknown'}`;
    if (key === lastSettingsKey) {
      // A fresh credential observation may confirm the same configured value.
      aiConfiguration.render();
      return;
    }
    lastSettingsKey = key;
    $('#setPomodoro').textContent = s.pomodoroMinutes;
    $('#setBreak').textContent = s.breakMinutes;
    $('#setSoft').textContent = s.softReminderEvery;
    $('#setHydration').textContent = s.hydrationEvery;

    // 工作时间
    const ws = $('#setWorkStart'), we = $('#setWorkEnd');
    if (ws) ws.textContent = s.workStartHour !== undefined ? s.workStartHour : 10;
    if (we) we.textContent = s.workEndHour !== undefined ? s.workEndHour : 21;
    const wt = document.querySelector('[data-toggle="workEndReminder"]');
    if (wt) {
      wt.textContent = s.workEndReminder ? t('开') : t('关');
      wt.classList.toggle('on', !!s.workEndReminder);
      wt.setAttribute('aria-pressed', String(Boolean(s.workEndReminder)));
    }

    // 临时任务默认时效
    syncPressedButtons('.ttl-set-chip', c => {
      const v = c.dataset.ttlSet;
      return s.adhocTtlMode === 'hours' ? String(s.adhocTtlHours) === v : v === 'midnight';
    });
    const motion = s.motionMode || 'balanced';
    const stimulation = s.stimulationMode || 'balanced';
    document.body.dataset.motion = motion;
    document.body.dataset.stimulation = stimulation;
    if (motionReduced() || stimulation === 'low') clearDecorativeMotion();
    syncPressedButtons('.motion-mode', button => button.dataset.value === motion);
    syncPressedButtons('.stimulation-mode', button => button.dataset.value === stimulation);
    syncPressedButtons('.pet-activity-mode', button => button.dataset.value === (s.petActivityMode || 'balanced'));
    const soundToggle = document.querySelector('[data-toggle="soundEnabled"]');
    if (soundToggle) {
      soundToggle.textContent = s.soundEnabled ? t('开') : t('关');
      soundToggle.classList.toggle('on', Boolean(s.soundEnabled));
      soundToggle.setAttribute('aria-pressed', String(Boolean(s.soundEnabled)));
    }
    // 免打扰、两级上限与角色:头上那枚徽标归外壳，这三样只在抽屉里出现。
    const dndToggle = document.querySelector('[data-toggle="dnd"]');
    if (dndToggle) {
      dndToggle.textContent = s.dnd ? t('开') : t('关');
      dndToggle.classList.toggle('on', !!s.dnd);
      dndToggle.setAttribute('aria-pressed', String(Boolean(s.dnd)));
    }
    const focusLvl = document.getElementById('setFocusLvl');
    if (focusLvl) focusLvl.textContent = s.focusMaxLevel || 2;
    const restLvl = document.getElementById('setRestLvl');
    if (restLvl) restLvl.textContent = s.restMaxLevel || 4;
    syncPressedButtons('.char-chip', c => c.dataset.char === s.nudgeCharacter);
    // aiMemoryEnabled 也在这张表里:它是一条设置,不是记忆列表的一部分。它决定的是
    // 「历史要不要跟着请求发出去」(ARCHITECTURE「事实流与长期记忆」),而这件事在这一批之前根本没有开关可点。
    for (const keyName of ['strategyGuidanceEnabled', 'dailyReviewEnabled', 'aiBreakdownEnabled',
      'aiClarifyEnabled', 'aiMemoryEnabled', 'aiImpulseEnergyEnabled', 'aiCaptureTriageEnabled', 'aiPetMealsEnabled', 'energyCurveEnabled']) {
      const toggle = document.querySelector(`[data-toggle="${keyName}"]`);
      if (!toggle) continue;
      toggle.textContent = s[keyName] ? t('开') : t('关');
      toggle.classList.toggle('on', Boolean(s[keyName]));
      toggle.setAttribute('aria-pressed', String(Boolean(s[keyName])));
    }
    aiConfiguration.render();
    renderCalibrationStatus(state);
    $('#aiPrivacyStatus').textContent = describeAiDisclosure(state.ai);
    renderExpiryPreview();
  }

  // 「学到哪一步了」只有一个可靠出处:投影里的 energyCurve。曲线关着时它是 null，
  // 那时既读不到也不该假装读得到 —— 但重置键仍然可按，命令回来的 changed 才是
  // 「原来学过没有」的答案。
  function renderCalibrationStatus(state) {
    const line = $('#energyCalibrationStatus');
    if (!line) return;
    const curve = state.energyCurve;
    if (!curve) {
      line.textContent = t('曲线关着：今天页和时间线都不画它，也不再学你的作息。');
      return;
    }
    const seen = Number.isFinite(curve.observations) ? curve.observations : 0;
    line.textContent = curve.calibrated
      ? t('已按你的 {count} 次自评微调过这条曲线。', { count: seen })
      : t('校准进度 {count}/10 次自评', { count: seen });
  }

  // 两级确认,和「全部忘掉」同一套:第一下换字，第二下才真的丢。这一组折叠起来时
  // 旗标要清掉,否则下次展开时一按就生效。
  async function pressResetCalibration() {
    const button = $('#btnResetEnergyCalibration');
    if (!button) return;
    if (!pendingCalibrationReset) {
      pendingCalibrationReset = true;
      button.textContent = t('真的重置');
      button.classList.add('danger');
      return;
    }
    clearPendingCalibrationReset();
    const result = await surfaceClient.resetEnergyCalibration();
    const feedback = $('#energyCalibrationFeedback');
    if (!feedback) return;
    calibrationFeedbackSource = !result || !result.ok
      ? '没能重置，稍后再试。'
      : result.changed
        ? '已丢掉学到的参数，曲线回到未校准的样子。'
        : '本来就没学过什么，没有可丢的。';
    feedback.textContent = t(calibrationFeedbackSource);
  }

  function clearPendingCalibrationReset() {
    pendingCalibrationReset = false;
    const button = $('#btnResetEnergyCalibration');
    if (!button) return;
    button.textContent = t('重置校准');
    button.classList.remove('danger');
  }

  // 两行就够：现在真正跑的是哪条路，以及有什么会离开这台机器。之前那几句把
  // 同一个地址写了两遍（base URL 与“目标”），又把只有开发者关心的回退条件展开成
  // 一长串，结果是真正要看的两个事实埋在废话里。开关、模型、地址、缺什么参数都由
  // 主进程算好（`state.ai.disclosure`），renderer 不再自己拼一份。
  function describeAiDisclosure(ai) {
    const disclosure = (ai && ai.disclosure) || {};
    const fields = Array.isArray(disclosure.fields) ? disclosure.fields.join('、') : '';
    const outbound = disclosure.network ? t('出网字段：{fields}', { fields }) : t('不发往公网');
    return t('{outbound} · 密钥只存系统安全存储', { outbound });
  }

  async function saveSettings(patch) {
    const ticket = { request: ++saveRequest, lifetime };
    const owns = () => mounted && ticket.request === saveRequest && ticket.lifetime === lifetime;
    const line = $('#settingsSaveStatus');
    saveStatusCopy = () => t('正在保存…');
    if (line) { line.textContent = saveStatusCopy(); line.dataset.state = 'saving'; }
    try {
      const result = await surfaceClient.updateSettings(patch);
      if (result?.ok === false) throw new Error('rejected');
      if (line && owns()) {
        const warning = formatAuthorizationWarning(result?.authorizationWarning);
        saveStatusCopy = () => {
          const currentWarning = formatAuthorizationWarning(result?.authorizationWarning);
          return currentWarning ? t('设置已保存；{warning}', { warning: currentWarning }) : t('已保存并生效');
        };
        line.textContent = saveStatusCopy();
        line.dataset.state = warning ? 'warning' : 'saved';
      }
      return result;
    } catch (_) {
      if (line && owns()) {
        saveStatusCopy = () => t('未保存，请重试');
        line.textContent = saveStatusCopy(); line.dataset.state = 'error';
      }
      return { ok: false };
    }
  }

  function mount() {
    if (mounted) return;
    mounted = true;
    lifetime++;
    listen($('#btnSettings'), 'click', openSettingsDrawer);
    listen($('#btnSettingsClose'), 'click', closeSettingsDrawer);
    listen($('#settingsMask'), 'mousedown', event => {
      if (event.target === $('#settingsMask')) closeSettingsDrawer();
    });

    // Settings steppers
    $$('[data-setting]').forEach(btn => listen(btn, 'click', async () => {
      const key = btn.dataset.setting;
      const delta = parseInt(btn.dataset.delta, 10);
      const patch = {};
      const s = getState().settings;
      const curStart = s.workStartHour !== undefined ? s.workStartHour : 10;
      const curEnd = s.workEndHour !== undefined ? s.workEndHour : 21;
      if (key === 'pomodoro') {
        patch.pomodoroMinutes = sessionDuration.clampFocusMinutes(s.pomodoroMinutes + delta);
      }
      if (key === 'break') patch.breakMinutes = Math.max(1, Math.min(30, s.breakMinutes + delta));
      if (key === 'softReminder') patch.softReminderEvery = Math.max(5, Math.min(60, s.softReminderEvery + delta));
      if (key === 'hydration') patch.hydrationEvery = Math.max(15, Math.min(180, s.hydrationEvery + delta));
      if (key === 'focusMaxLevel') patch.focusMaxLevel = Math.max(1, Math.min(4, (s.focusMaxLevel || 2) + delta));
      if (key === 'restMaxLevel') patch.restMaxLevel = Math.max(1, Math.min(4, (s.restMaxLevel || 4) + delta));
      if (key === 'workStart') patch.workStartHour = Math.max(0, Math.min(curEnd - 1, curStart + delta));
      if (key === 'workEnd') patch.workEndHour = Math.max(curStart + 1, Math.min(24, curEnd + delta));
      await saveSettings(patch);
    }));

    for (const key of ['strategyGuidanceEnabled', 'dailyReviewEnabled', 'aiBreakdownEnabled',
      'aiClarifyEnabled', 'aiMemoryEnabled', 'aiImpulseEnergyEnabled', 'aiCaptureTriageEnabled', 'aiPetMealsEnabled', 'energyCurveEnabled']) {
      listen(document.querySelector(`[data-toggle="${key}"]`), 'click', () => {
        const state = getState();
        void saveSettings({ [key]: !(state && state.settings[key]) });
      });
    }

    listen($('#settingGroupAi'), 'toggle', event => {
      if (event.currentTarget?.open === false) aiConfiguration.cancelTest?.();
    });

    listen($('#btnResetEnergyCalibration'), 'click', pressResetCalibration);
    // 这一组收起来就等于放弃那半下确认，和「全部忘掉」同一套:收起的 details 里
    // 那颗写着「真的重置」的按钮下次展开时会一按就生效，这不是用户按下去的东西。
    listen($('#settingGroupPlanning'), 'toggle', event => {
      const group = event && event.currentTarget;
      if (group && group.open === false) clearPendingCalibrationReset();
    });

    $$('.motion-mode, .stimulation-mode, .pet-activity-mode').forEach(button => listen(button, 'click', async () => {
      const patch = button.classList.contains('motion-mode')
        ? { motionMode: button.dataset.value }
        : button.classList.contains('stimulation-mode')
          ? { stimulationMode: button.dataset.value }
          : { petActivityMode: button.dataset.value };
      await saveSettings(patch);
    }));

    // 设置：自动失效的默认区间
    $$('.ttl-set-chip').forEach(c => listen(c, 'click', async () => {
      const v = c.dataset.ttlSet;
      if (v === 'midnight') await saveSettings({ adhocTtlMode: 'midnight' });
      else await saveSettings({ adhocTtlMode: 'hours', adhocTtlHours: parseInt(v, 10) });
    }));
    listen(document.querySelector('[data-toggle="workEndReminder"]'), 'click', async () => {
      const state = getState();
      await saveSettings({ workEndReminder: !(state && state.settings.workEndReminder) });
    });
    $$('.char-chip').forEach(c => listen(c, 'click', async () => {
      await saveSettings({ nudgeCharacter: c.dataset.char });
    }));
    listen(document.querySelector('[data-toggle="dnd"]'), 'click', async () => {
      const state = getState();
      await saveSettings({ dnd: !(state && state.settings.dnd) });
    });
    listen(document.querySelector('[data-toggle="soundEnabled"]'), 'click', async () => {
      const state = getState();
      await saveSettings({ soundEnabled: !(state && state.settings.soundEnabled) });
    });
    $$('[data-test-nudge]').forEach(btn => listen(btn, 'click', () => {
      const kind = btn.dataset.testNudge;
      const level = parseInt(btn.dataset.level, 10);
      surfaceClient.testNudge(kind, level);
    }));

    interfaceSettings.mount();
    aiConfiguration.mount();
    desktopUpdates.mount();
  }

  function dispose() {
    if (!mounted) return;
    mounted = false;
    lifetime++;
    interfaceSettings.dispose();
    aiConfiguration.dispose();
    desktopUpdates.dispose();
    while (teardown.length) teardown.pop()();
    lastSettingsKey = '';
    pendingCalibrationReset = false;
  }

  return Object.freeze({
    mount,
    dispose,
    isOpen: isSettingsOpen,
    open: openSettingsDrawer,
    close: closeSettingsDrawer,
    renderSettings
  });
}


export { createPopoverSettingsDrawer };
