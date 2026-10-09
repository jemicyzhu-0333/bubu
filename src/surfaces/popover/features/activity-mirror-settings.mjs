import { t, getLocale, onLocaleChanged } from '../../shared/interface/i18n.mjs';

// 设置里的「伙伴跟着你」：开关、此刻识别到的类别、各 AI 工具安装随附插件的步骤。它只读投影、
// 只发两种请求（改设置、按工具 id 复制安装命令），命令文本由主进程生成（ARCHITECTURE「活动镜像」）。
// 是否接入只看是否真的收到过该工具的信号，不读取任何工具的配置文件。
const ACTIVITY_LABELS = Object.freeze({ none: '暂时没有可以跟随的活动', music: '正在跟你听音乐', coding: '正在陪你写代码', ai: '正在陪你和 AI 对话' });
const RECEIVER_NOTES = Object.freeze({ 'port-in-use': '接收端口被占用，AI 工具的通知暂时收不到。', 'listen-failed': 'AI 工具的通知暂时收不到。' });

function createActivityMirrorSettings({ $, getState, escapeHTML, surfaceClient }) {
  let unsubscribe = null;
  let lastKey = '';
  let copied = null;
  let current = null, statusError = null;

  function signalText(at) {
    if (!Number.isFinite(at)) return t('还没有收到信号');
    const minutes = Math.floor((Date.now() - at) / 60_000);
    return minutes < 1 ? t('刚刚收到信号') : t('{minutes} 分钟前收到信号', { minutes });
  }
  const cleanup = [];

  function render(state = getState()) {
    const mirror = state && state.activityMirror;
    if (!mirror) return;
    current = mirror;
    const key = JSON.stringify([mirror, copied, getLocale()]);
    if (key === lastKey) return;
    statusError = null;
    lastKey = key;
    const toggle = $('#activityMirrorToggle');
    toggle.textContent = t(mirror.enabled ? '开' : '关');
    toggle.classList.toggle('on', mirror.enabled);
    toggle.setAttribute('aria-pressed', String(mirror.enabled));
    $('#activityMirrorStatus').textContent = mirror.enabled
      ? [ACTIVITY_LABELS[mirror.activity] || ACTIVITY_LABELS.none, RECEIVER_NOTES[mirror.receiver]].filter(Boolean).map(source => t(source)).join(' ')
      : t('关闭时不读取任何应用信息。');
    const hooks = $('#activityHooks');
    hooks.hidden = !mirror.enabled || mirror.tools.length === 0;
    $('#activityHookList').innerHTML = mirror.tools.map(tool => `<div class="activity-hook" data-tool="${escapeHTML(tool.id)}">`
      + `<div class="activity-hook-head"><span class="activity-hook-name">${escapeHTML(tool.label)}</span>`
      + `<span class="activity-hook-state">${escapeHTML(signalText(tool.lastSignalAt))}</span>`
      + `<button type="button" class="chip" data-copy-hook="${escapeHTML(tool.id)}">${t(copied === tool.id ? '已复制' : '复制')}</button></div>`
      + tool.steps.map(step => `<p class="activity-hook-step">${escapeHTML(step)}</p>`).join('')
      + `<code class="activity-hook-command">${escapeHTML(tool.command)}</code></div>`).join('');
  }

  // ARCHITECTURE「语言与外观」: preserve hook controls and focus on locale-only changes.
  function repaintCopy() {
    if (!current) return;
    const mirror = current;
    $('#activityMirrorToggle').textContent = t(mirror.enabled ? '开' : '关');
    $('#activityMirrorStatus').textContent = statusError ? t(statusError) : mirror.enabled
      ? [ACTIVITY_LABELS[mirror.activity] || ACTIVITY_LABELS.none, RECEIVER_NOTES[mirror.receiver]].filter(Boolean).map(source => t(source)).join(' ')
      : t('关闭时不读取任何应用信息。');
    $('#activityHookList').querySelectorAll('.activity-hook').forEach((row, index) => {
      const tool = mirror.tools[index];
      if (!tool) return;
      row.querySelector('.activity-hook-state').textContent = signalText(tool.lastSignalAt);
      row.querySelector('[data-copy-hook]').textContent = t(copied === tool.id ? '已复制' : '复制');
    });
    lastKey = JSON.stringify([mirror, copied, getLocale()]);
  }

  async function onToggle() {
    const state = getState();
    try { await surfaceClient.updateSettings({ activityMirrorEnabled: !(state && state.settings.activityMirrorEnabled) }); }
    catch { statusError = '设置没有保存，请重试。'; $('#activityMirrorStatus').textContent = t(statusError); }
  }

  async function onCopy(event) {
    const tool = event.target.closest('[data-copy-hook]')?.dataset.copyHook;
    if (!tool) return;
    try {
      const result = await surfaceClient.copyAgentPluginCommand(tool);
      copied = result && result.ok ? tool : null;
    } catch { copied = null; }
    lastKey = '';
    render();
  }

  function listen(node, type, handler) { node?.addEventListener(type, handler); cleanup.push(() => node?.removeEventListener(type, handler)); }

  function mount(projectionStore) {
    if (!projectionStore || typeof projectionStore.subscribe !== 'function') throw new TypeError('activity mirror settings require a projection store');
    if (unsubscribe) return;
    cleanup.push(onLocaleChanged(repaintCopy));
    listen($('#activityMirrorToggle'), 'click', () => { void onToggle(); });
    listen($('#activityHookList'), 'click', event => { void onCopy(event); });
    unsubscribe = projectionStore.subscribe(change => {
      if (change.localeOnly) return;
      const dirty = change.dirty || {};
      if (dirty.all || dirty.activity || dirty.settings) render(change.state);
    });
    render();
  }

  function dispose() {
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
    current = null;
    lastKey = '';
    cleanup.splice(0).forEach(remove => remove());
  }

  return Object.freeze({ mount, dispose, render });
}

export { createActivityMirrorSettings };
