import { onLocaleChanged, t } from '../../shared/interface/i18n.mjs';

function createInterfaceSettings({ document, getState, surfaceClient }) {
  let mounted = false, busy = false, generation = 0, visit = 0;
  const listeners = [];
  let statusSource = '';
  function showStatus(source, state) {
    statusSource = source;
    const node = document.getElementById?.('interfaceSaveStatus');
    if (node) { node.textContent = t(source); if (state) node.dataset.state = state; }
  }
  const language = () => document.getElementById?.('setLanguage');
  const radios = () => [...(document.querySelectorAll?.('input[name="interfaceTheme"]') || [])];
  function render() {
    const settings = getState()?.settings || {};
    const select = language();
    if (select) { select.value = settings.locale || 'system'; select.setAttribute('aria-disabled', String(busy)); select.setAttribute('aria-busy', String(busy)); }
    for (const radio of radios()) {
      radio.checked = radio.value === (settings.theme || 'system'); radio.setAttribute('aria-disabled', String(busy));
    }
  }
  async function save(patch) {
    if (!mounted) return;
    if (busy) { render(); return; }
    busy = true;
    const ticket = ++generation;
    const feedbackVisit = visit;
    const status = document.getElementById('interfaceSaveStatus');
    showStatus('正在保存…', 'saving');
    render();
    try {
      const result = await surfaceClient.updateSettings(patch);
      if (result?.ok !== true) throw new Error('not-saved');
      if (!mounted || ticket !== generation || feedbackVisit !== visit) return;
      showStatus('已保存并生效', 'saved');
    } catch (_) {
      if (mounted && ticket === generation && feedbackVisit === visit && status) {
        showStatus('未保存，请重试', 'error');
      }
    } finally {
      if (mounted && ticket === generation) { busy = false; render(); }
    }
  }
  function mount() {
    if (mounted) return;
    mounted = true;
    listeners.push(onLocaleChanged(() => showStatus(statusSource)));
    const select = language();
    const changeLanguage = () => { void save({ locale: select.value }); };
    select?.addEventListener('change', changeLanguage);
    listeners.push(() => select?.removeEventListener('change', changeLanguage));
    for (const radio of radios()) {
      const change = () => { if (radio.checked) void save({ theme: radio.value }); };
      radio.addEventListener('change', change);
      listeners.push(() => radio.removeEventListener('change', change));
    }
    render();
  }
  function clearFeedback() {
    visit++; showStatus('', '');
  }
  function dispose() {
    mounted = false; generation++; busy = false;
    for (const stop of listeners.splice(0)) stop();
  }
  return Object.freeze({ mount, render, clearFeedback, dispose });
}
export { createInterfaceSettings };
