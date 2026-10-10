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
  let mounted = false, timer = null, sequence = 0, current = null, lifetime = 0;
  let actionSequence = 0, autoPending = null, autoAcknowledged = null, settingError = false;
  const commands = new Set();
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
    if (!settingError) showStatus(REASONS[state.reason] || message[phase] || '更新暂不可用', { version: state.version, percent: state.percent });
    renderControls();
    $('#appUpdateDownload').hidden = !(phase === 'available' || phase === 'error' && state.version);
    $('#appUpdateCancel').hidden = phase !== 'downloading';
    $('#appUpdateInstall').hidden = phase !== 'downloaded';
    if (phase !== 'downloaded') $('#appUpdateConfirm').hidden = true;
    renderAuto();
  }
  function renderControls() {
    const phase = current?.phase;
    $('#appUpdateCheck').disabled = commands.size > 0 || ['unavailable', 'checking', 'downloading', 'cancelling', 'downloaded', 'installing'].includes(phase);
    $('#appUpdateDownload').disabled = commands.size > 0;
    $('#appUpdateCancel').disabled = commands.has('cancelUpdate');
    $('#appUpdateInstall').disabled = commands.size > 0;
    $('#appUpdateConfirmYes').disabled = commands.size > 0;
  }
  function renderAuto() {
    const projected = getState()?.settings?.autoCheckUpdates !== false;
    if (autoAcknowledged === projected) autoAcknowledged = null;
    $('#appUpdateAuto').checked = autoPending?.enabled ?? autoAcknowledged ?? projected;
    $('#appUpdateAuto').disabled = autoPending !== null;
  }
  async function refresh() {
    if (!mounted) return;
    const ticket = ++sequence;
    try { const state = await surfaceClient.getUpdateStatus(); if (mounted && ticket === sequence) render(state); }
    catch (_) { if (mounted && ticket === sequence && !settingError) showStatus('暂时无法读取更新状态'); }
    finally {
      if (mounted && ticket === sequence) {
        clearTimer(timer);
        if (isVisible() && $('#appUpdateGroup').open) timer = setTimer(refresh, 1500);
      }
    }
  }
  async function command(name) {
    if (!mounted || commands.has(name) || commands.size && name !== 'cancelUpdate') return;
    const owner = lifetime, action = ++actionSequence;
    const owns = () => mounted && owner === lifetime;
    commands.add(name);
    settingError = false;
    renderControls();
    try {
      const operation = surfaceClient[name]();
      void refresh();
      const result = await operation;
      if (!owns() || action !== actionSequence) return;
      sequence++;
      if (result?.state) render(result.state);
      if (result?.ok === false) { settingError = true; showStatus(REASONS[result.reason] || '暂时无法完成，请稍后重试'); }
    } catch (_) {
      if (owns() && action === actionSequence) { settingError = true; showStatus('暂时无法完成，请稍后重试'); }
    }
    finally {
      if (owns()) { commands.delete(name); renderControls(); void refresh(); }
    }
  }
  async function saveAuto() {
    if (!mounted || autoPending) { renderAuto(); return; }
    const ticket = { enabled: $('#appUpdateAuto').checked, lifetime };
    autoPending = ticket;
    settingError = false;
    renderAuto();
    try {
      const result = await surfaceClient.updateSettings({ autoCheckUpdates: ticket.enabled });
      if (!mounted || ticket.lifetime !== lifetime) return;
      if (result?.ok !== true) throw new Error('not-saved');
      autoAcknowledged = ticket.enabled;
    } catch (_) {
      if (mounted && ticket.lifetime === lifetime) {
        settingError = true;
        showStatus('设置未保存，请重试');
      }
    } finally {
      if (mounted && ticket.lifetime === lifetime) { autoPending = null; renderAuto(); if (current && !settingError) render(current); }
    }
  }
  function dismiss() {
    clearTimer(timer);
    const confirmation = $('#appUpdateConfirm');
    if (confirmation) confirmation.hidden = true;
  }
  function mount() {
    if (mounted || !$('#appUpdateGroup') || typeof surfaceClient.getUpdateStatus !== 'function') return;
    mounted = true;
    lifetime++;
    renderControls();
    renderAuto();
    releases.push(onLocaleChanged(repaintCopy));
    listen($('#appUpdateGroup'), 'toggle', () => { if ($('#appUpdateGroup').open) void refresh(); else dismiss(); });
    for (const [id, name] of [['Check', 'checkForUpdates'], ['Download', 'downloadUpdate'], ['Cancel', 'cancelUpdate']]) {
      listen($(`#appUpdate${id}`), 'click', () => { void command(name); });
    }
    listen($('#appUpdateInstall'), 'click', () => {
      if (!commands.size && current?.phase === 'downloaded') { $('#appUpdateConfirm').hidden = false; $('#appUpdateConfirmYes').focus(); }
    });
    const cancelInstall = () => { $('#appUpdateConfirm').hidden = true; $('#appUpdateInstall').focus(); };
    listen($('#appUpdateConfirmNo'), 'click', cancelInstall);
    listen($('#appUpdateConfirm'), 'keydown', event => {
      if (event.key === 'Escape' && !$('#appUpdateConfirm').hidden) {
        event.preventDefault(); event.stopPropagation(); cancelInstall();
      }
    });
    listen($('#appUpdateConfirmYes'), 'click', () => {
      if ($('#appUpdateConfirm').hidden || current?.phase !== 'downloaded') return;
      $('#appUpdateConfirm').hidden = true; void command('installUpdate');
    });
    listen($('#appUpdateAuto'), 'change', () => { void saveAuto(); });
    void refresh();
  }
  function dispose() {
    mounted = false; lifetime++; sequence++;
    commands.clear(); autoPending = null; autoAcknowledged = null; settingError = false; current = null;
    dismiss(); while (releases.length) releases.pop()();
  }
  return Object.freeze({ mount, dispose, refresh, dismiss });
}
export { createDesktopUpdateFeature };
