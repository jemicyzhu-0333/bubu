// 设置里的「伙伴跟着你」：开关、此刻识别到的类别、各 AI 工具安装随附插件的步骤。它只读投影、
// 只发两种请求（改设置、按工具 id 复制安装命令），命令文本由主进程生成（ARCHITECTURE「活动镜像」）。
// 是否接入只看是否真的收到过该工具的信号，不读取任何工具的配置文件。
const ACTIVITY_LABELS = Object.freeze({ none: '暂时没有可以跟随的活动', music: '正在跟你听音乐', coding: '正在陪你写代码', ai: '正在陪你和 AI 对话' });
const RECEIVER_NOTES = Object.freeze({ 'port-in-use': '接收端口被占用，AI 工具的通知暂时收不到。', 'listen-failed': 'AI 工具的通知暂时收不到。' });

function createActivityMirrorSettings({ $, getState, escapeHTML, surfaceClient }) {
  let unsubscribe = null;
  let lastKey = '';
  let copied = null;

  function signalText(at) {
    if (!Number.isFinite(at)) return '还没有收到信号';
    const minutes = Math.floor((Date.now() - at) / 60_000);
    return minutes < 1 ? '刚刚收到信号' : `${minutes} 分钟前收到信号`;
  }
  const cleanup = [];

  function render(state = getState()) {
    const mirror = state && state.activityMirror;
    if (!mirror) return;
    const key = JSON.stringify([mirror, copied]);
    if (key === lastKey) return;
    lastKey = key;
    const toggle = $('#activityMirrorToggle');
    toggle.textContent = mirror.enabled ? '开' : '关';
    toggle.classList.toggle('on', mirror.enabled);
    toggle.setAttribute('aria-pressed', String(mirror.enabled));
    $('#activityMirrorStatus').textContent = mirror.enabled
      ? [ACTIVITY_LABELS[mirror.activity] || ACTIVITY_LABELS.none, RECEIVER_NOTES[mirror.receiver]].filter(Boolean).join(' ')
      : '关闭时不读取任何应用信息。';
    const hooks = $('#activityHooks');
    hooks.hidden = !mirror.enabled || mirror.tools.length === 0;
    $('#activityHookList').innerHTML = mirror.tools.map(tool => `<div class="activity-hook" data-tool="${escapeHTML(tool.id)}">`
      + `<div class="activity-hook-head"><span class="activity-hook-name">${escapeHTML(tool.label)}</span>`
      + `<span class="activity-hook-state">${escapeHTML(signalText(tool.lastSignalAt))}</span>`
      + `<button type="button" class="chip" data-copy-hook="${escapeHTML(tool.id)}">${copied === tool.id ? '已复制' : '复制'}</button></div>`
      + tool.steps.map(step => `<p class="activity-hook-step">${escapeHTML(step)}</p>`).join('')
      + `<code class="activity-hook-command">${escapeHTML(tool.command)}</code></div>`).join('');
  }

  async function onToggle() {
    const state = getState();
    try { await surfaceClient.updateSettings({ activityMirrorEnabled: !(state && state.settings.activityMirrorEnabled) }); }
    catch { $('#activityMirrorStatus').textContent = '设置没有保存，请重试。'; }
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
    listen($('#activityMirrorToggle'), 'click', () => { void onToggle(); });
    listen($('#activityHookList'), 'click', event => { void onCopy(event); });
    unsubscribe = projectionStore.subscribe(change => {
      const dirty = change.dirty || {};
      if (dirty.all || dirty.activity || dirty.settings) render(change.state);
    });
    render();
  }

  function dispose() {
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
    cleanup.splice(0).forEach(remove => remove());
  }

  return Object.freeze({ mount, dispose, render });
}

export { createActivityMirrorSettings };
