import { t, onLocaleChanged } from '../../shared/interface/i18n.mjs';

const REASONS = Object.freeze({
  'development-build': '开发运行不检查更新，安装正式版后可用',
  'unsupported-platform': '此平台暂不支持应用内更新',
  'feed-unconfigured': '这个安装包尚未配置更新源',
  'check-failed': '暂时无法检查更新，可以稍后重试',
  'download-failed': '下载未完成，可以重试，当前版本仍可使用',
  'active-session': '先结束当前专注或休息，再重启更新',
  'pending-landing': '先处理本轮落点，再重启更新',
  'storage-unavailable': '暂时无法确认数据已保存，请稍后重试',
  'install-failed': '暂时未能启动安装，请重试',
  'cancelled': '下载已取消'
});
function createDesktopUpdateFeature({ $, getState, surfaceClient, isVisible = () => true, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let mounted = false, timer = null, sequence = 0, current = null;
  const releases = [];
  let statusCopy = { source: '', parameters: {} };
  function showStatus(source, parameters = {}) {
    statusCopy = { source, parameters };
    $('#appUpdateStatus').textContent = t(source, parameters);
  }
  function repaintCopy() {
    if (current) $('#appUpdateVersion').textContent = t('当前版本 {version}', { version: current.currentVersion });
    $('#appUpdateStatus').textContent = t(statusCopy.source, statusCopy.parameters);
  }
  const listen = (node, event, fn) => { if (node) { node.addEventListener(event, fn); releases.push(() => node.removeEventListener(event, fn)); } };
  function render(state) {
    current = state;
    const phase = state.phase;
    $('#appUpdateVersion').textContent = t('当前版本 {version}', { version: state.currentVersion });
    const message = { idle: '可检查是否有新版本', checking: '正在检查…', current: '已是最新版本',
      available: '发现新版本 {version}', downloading: '下载中 {percent}%',
      cancelling: '正在取消下载…', downloaded: '版本 {version} 已准备好', installing: '正在重启更新…' };
    showStatus(REASONS[state.reason] || message[phase] || '更新暂不可用', { version: state.version, percent: state.percent });
    $('#appUpdateCheck').disabled = ['unavailable', 'checking', 'downloading', 'cancelling', 'downloaded', 'installing'].includes(phase);
    $('#appUpdateDownload').hidden = !(phase === 'available' || phase === 'error' && state.version);
    $('#appUpdateCancel').hidden = phase !== 'downloading';
    $('#appUpdateInstall').hidden = phase !== 'downloaded';
    if (phase !== 'downloaded') $('#appUpdateConfirm').hidden = true;
    $('#appUpdateAuto').checked = getState()?.settings?.autoCheckUpdates !== false;
  }
  async function refresh() {
    if (!mounted) return;
    const ticket = ++sequence;
    try { const state = await surfaceClient.getUpdateStatus(); if (mounted && ticket === sequence) render(state); }
    catch (_) { if (mounted) showStatus('暂时无法读取更新状态'); }
    finally {
      clearTimer(timer);
      if (mounted && isVisible() && $('#appUpdateGroup').open) timer = setTimer(refresh, 1500);
    }
  }
  async function command(name) {
    try {
      const operation = surfaceClient[name]();
      void refresh();
      const result = await operation;
      if (!mounted) return;
      if (result?.state) render(result.state);
      if (result?.ok === false) showStatus(REASONS[result.reason] || '暂时无法完成，请稍后重试');
    } catch (_) { if (mounted) showStatus('暂时无法完成，请稍后重试'); }
    finally { if (mounted) void refresh(); }
  }
  function mount() {
    if (mounted || !$('#appUpdateGroup') || typeof surfaceClient.getUpdateStatus !== 'function') return;
    mounted = true;
    releases.push(onLocaleChanged(repaintCopy));
    listen($('#appUpdateGroup'), 'toggle', () => { if ($('#appUpdateGroup').open) void refresh(); else clearTimer(timer); });
    for (const [id, name] of [['Check', 'checkForUpdates'], ['Download', 'downloadUpdate'], ['Cancel', 'cancelUpdate']]) {
      listen($(`#appUpdate${id}`), 'click', () => { void command(name); });
    }
    listen($('#appUpdateInstall'), 'click', () => {
      if (current?.phase === 'downloaded') { $('#appUpdateConfirm').hidden = false; $('#appUpdateConfirmYes').focus(); }
    });
    listen($('#appUpdateConfirmNo'), 'click', () => { $('#appUpdateConfirm').hidden = true; $('#appUpdateInstall').focus(); });
    listen($('#appUpdateConfirmYes'), 'click', () => { $('#appUpdateConfirm').hidden = true; void command('installUpdate'); });
    listen($('#appUpdateAuto'), 'change', async () => {
      const enabled = $('#appUpdateAuto').checked;
      try { const result = await surfaceClient.updateSettings({ autoCheckUpdates: enabled }); if (result?.ok === false) throw new Error('not-saved'); }
      catch (_) { if (mounted) { $('#appUpdateAuto').checked = !enabled; showStatus('设置未保存，请重试'); } }
    });
    void refresh();
  }
  function dispose() { mounted = false; sequence += 1; clearTimer(timer); while (releases.length) releases.pop()(); }
  return Object.freeze({ mount, dispose, refresh });
}
export { createDesktopUpdateFeature };
