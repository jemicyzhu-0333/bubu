import { t, getLocale, onLocaleChanged } from '../../shared/interface/i18n.mjs';

// 设置里的「伙伴跟着你」：开关、此刻识别到的类别、各 AI 工具安装随附插件的步骤。它只读投影、
// 只发两种请求（改设置、按工具 id 复制安装命令），命令文本由主进程生成（ARCHITECTURE「活动镜像」）。
// 是否接入只看是否真的收到过该工具的信号，不读取任何工具的配置文件。
const RECEIVER_NOTES = Object.freeze({ 'port-in-use': '接收端口被占用，AI 工具的通知暂时收不到。', 'listen-failed': 'AI 工具的通知暂时收不到。' });

function createActivityMirrorSettings({ $, getState, escapeHTML, surfaceClient, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let unsubscribe = null;
  let optionsKey = '';
  let selected = null, selectionRevision = 0, copyRevision = 0, copiedTimer = null, copyError = null;
  let copied = null;
  let current = null, statusError = null;
  let lifetime = 0, toggling = false, copying = false;
  let store = null, toggleUncertain = false, toggleReconciling = false;

  const cleanup = [];
  const icons = {
    copy: '<rect x="8" y="8" width="11" height="12" rx="2"/><path d="M15 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3"/>',
    done: '<path d="m5 12 4 4L19 6"/>',
    busy: '<path d="M12 3a9 9 0 1 1-9 9"/>',
  };

  function clearCopied() {
    copyRevision++;
    if (copiedTimer !== null) clearTimer(copiedTimer);
    copiedTimer = null;
    copied = null;
  }

  function render(state = getState()) {
    const mirror = state && state.activityMirror;
    if (!mirror) return;
    current = mirror;
    if (!mirror.tools.some(tool => tool.id === selected)) {
      selected = mirror.tools[0]?.id || null;
      selectionRevision++;
      clearCopied();
      copyError = null;
    }
    const toggle = $('#activityMirrorToggle');
    toggle.classList.toggle('on', mirror.enabled);
    toggle.setAttribute('aria-pressed', String(mirror.enabled));
    toggle.disabled = toggling || toggleUncertain || toggleReconciling;
    $('#activityHooks').hidden = !mirror.enabled || mirror.tools.length === 0;
    repaintCopy();
  }

  // Keep the select, help disclosure and focused button mounted across activity/locale updates.
  function repaintCopy() {
    if (!current) return;
    const mirror = current;
    const toggle = $('#activityMirrorToggle');
    toggle.textContent = t(mirror.enabled ? '开' : '关');
    toggle.disabled = toggling || toggleUncertain || toggleReconciling;
    toggle.setAttribute('aria-busy', String(toggling || toggleReconciling));
    const issue = (toggling ? '正在保存…' : toggleUncertain ? '设置结果暂未确认，重新打开后可核对。' : statusError) || (mirror.enabled && RECEIVER_NOTES[mirror.receiver]);
    $('#activityMirrorStatus').textContent = issue ? t(issue) : '';
    $('#activityMirrorStatus').hidden = !issue;
    const selector = $('#activityHookTool');
    const key = JSON.stringify([mirror.tools.map(tool => [tool.id, tool.label]), getLocale()]);
    if (key !== optionsKey) {
      optionsKey = key;
      selector.innerHTML = mirror.tools.map(tool => `<option value="${escapeHTML(tool.id)}">${escapeHTML(tool.label)}</option>`).join('');
    }
    selector.value = selected || '';
    const tool = mirror.tools.find(item => item.id === selected);
    const button = $('#activityHookCopy');
    button.dataset.copyHook = selected || '';
    button.disabled = copying || !tool;
    button.classList.toggle('is-copied', Boolean(!copying && selected && copied === selected));
    button.setAttribute('aria-busy', String(copying));
    const action = t(copying ? '正在复制…' : copied === selected && selected ? '已复制' : '复制接入命令');
    button.setAttribute('aria-label', action);
    button.setAttribute('title', action);
    button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${icons[copying ? 'busy' : copied === selected && selected ? 'done' : 'copy']}</svg>`;
    const received = Number.isFinite(tool?.lastSignalAt);
    const available = mirror.enabled && mirror.receiver === 'listening';
    const signal = received ? t('已收到信号') : t('还没有收到信号');
    const detail = received ? t('上次收到信号：{time}。仅表示收到过通知，不代表当前在线。', { time: new Date(tool.lastSignalAt).toLocaleString(getLocale()) }) : signal;
    const status = available ? signal : t('暂时无法接收信号');
    const dot = $('#activityHookSignal');
    dot.classList.toggle('received', received && available);
    dot.setAttribute('aria-label', available ? detail : `${status} ${detail}`);
    dot.setAttribute('title', available ? detail : `${status} ${detail}`);
    $('#activityHookSignalDetail').textContent = available ? detail : `${status} ${detail}`;
    $('#activityHookState').classList.toggle('sr-only', !copyError);
    $('#activityHookState').textContent = copyError ? t(copyError) : copied === selected && selected ? t('已复制') : status;
    $('#activityHookState').setAttribute('title', detail);
    $('#activityHookSteps').innerHTML = (tool?.steps || []).map(step => `<p class="activity-hook-step">${escapeHTML(step)}</p>`).join('');
    $('#activityHookCommand').textContent = tool?.command || '';
  }

  function onSelect() {
    const id = $('#activityHookTool').value;
    if (!current?.tools.some(tool => tool.id === id) || id === selected) return;
    selected = id;
    selectionRevision++;
    clearCopied();
    copyError = null;
    repaintCopy();
  }

  async function reconcileToggle() {
    if (!unsubscribe || toggling || !toggleUncertain || toggleReconciling || !store?.refresh) return;
    const owner = lifetime;
    toggleReconciling = true;
    repaintCopy();
    try {
      const snapshot = await store.refresh();
      if (!unsubscribe || owner !== lifetime || !snapshot || !Number.isSafeInteger(snapshot.revision)
          || typeof snapshot.settings?.activityMirrorEnabled !== 'boolean'
          || snapshot.activityMirror?.enabled !== snapshot.settings.activityMirrorEnabled) return;
      toggleUncertain = false;
      statusError = null;
      render(snapshot);
    } catch { /* A lost receipt stays locked until a fresh canonical read succeeds. */ }
    finally {
      toggleReconciling = false;
      if (unsubscribe && owner === lifetime) repaintCopy();
      else if (unsubscribe) void reconcileToggle();
    }
  }

  async function onToggle() {
    if (!unsubscribe || toggling || toggleUncertain || toggleReconciling) return;
    const owner = lifetime;
    toggling = true;
    statusError = null;
    repaintCopy();
    const state = getState();
    try {
      const result = await surfaceClient.updateSettings({ activityMirrorEnabled: !(state && state.settings.activityMirrorEnabled) });
      toggleUncertain = result?.ok !== true && result?.ok !== false;
      if (owner !== lifetime) toggleUncertain = true;
      else statusError = result?.ok === false ? '设置没有保存，请重试。' : null;
    } catch {
      toggleUncertain = true;
    } finally {
      toggling = false;
      if (unsubscribe) {
        repaintCopy();
        await reconcileToggle();
      }
    }
  }

  async function onCopy(event) {
    const button = event.target.closest('[data-copy-hook]');
    const tool = button?.dataset.copyHook;
    if (!tool || tool !== selected || !current?.tools.some(item => item.id === tool) || !unsubscribe || copying) return;
    const owner = lifetime, revision = selectionRevision;
    copying = true;
    copyError = null;
    clearCopied();
    repaintCopy();
    try {
      const result = await surfaceClient.copyAgentPluginCommand(tool);
      if (!unsubscribe || owner !== lifetime || revision !== selectionRevision) return;
      if (result?.ok === true) {
        copied = tool;
        const receipt = copyRevision;
        copiedTimer = setTimer(() => {
          if (!unsubscribe || owner !== lifetime || revision !== selectionRevision || receipt !== copyRevision) return;
          copiedTimer = null;
          copied = null;
          repaintCopy();
        }, 1800);
      } else copyError = '操作失败，请重试';
    } catch {
      if (!unsubscribe || owner !== lifetime || revision !== selectionRevision) return;
      copyError = '操作失败，请重试';
    } finally {
      if (unsubscribe && owner === lifetime) { copying = false; repaintCopy(); }
    }
  }

  function listen(node, type, handler) { node?.addEventListener(type, handler); cleanup.push(() => node?.removeEventListener(type, handler)); }

  function mount(projectionStore) {
    if (!projectionStore || typeof projectionStore.subscribe !== 'function') throw new TypeError('activity mirror settings require a projection store');
    if (unsubscribe) return;
    lifetime++;
    store = projectionStore;
    cleanup.push(onLocaleChanged(repaintCopy));
    listen($('#activityMirrorToggle'), 'click', () => { void onToggle(); });
    listen($('#activityHookList'), 'click', event => { void onCopy(event); });
    listen($('#activityHookTool'), 'change', onSelect);
    listen($('#settingGroupSensory'), 'toggle', () => { if ($('#settingGroupSensory').open) void reconcileToggle(); });
    unsubscribe = projectionStore.subscribe(change => {
      if (change.localeOnly) return;
      const dirty = change.dirty || {};
      if (dirty.all || dirty.activity || dirty.settings) render(change.state);
    });
    render();
    void reconcileToggle();
  }

  function dispose() {
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
    lifetime++; copying = false; statusError = null; copied = null;
    store = null;
    clearCopied();
    copyError = null;
    current = null;
    optionsKey = '';
    cleanup.splice(0).forEach(remove => remove());
  }

  return Object.freeze({ mount, dispose, render, onSettingsOpen: () => { void reconcileToggle(); } });
}

export { createActivityMirrorSettings };
