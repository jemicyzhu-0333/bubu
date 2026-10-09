import { t } from '../../shared/interface/i18n.mjs';
// 现在页下方的「今天」：能量、日常、收件箱三块并排。这里只拥有呈现状态——哪一块
// 展开、收件箱那块的数字——不写入任何状态。各块的读数归各自的 feature：能量读数归
// energy-strip，日常计数归 routines；收件箱只是一条到「安排 › 收件箱」的捷径。
const PANELS = Object.freeze({ energy: '#energyStrip', routines: '#routinesStrip' });

function createPopoverTodayOverview({ $, getState, openInbox }) {
  let open = null;
  let chosen = false;
  let unsubscribe = null;
  const cleanup = [];

  function sync() {
    for (const [name, selector] of Object.entries(PANELS)) {
      const panel = $(selector);
      const tile = $(`[data-overview="${name}"]`);
      if (panel) panel.hidden = open !== name;
      tile?.setAttribute('aria-expanded', String(open === name));
      tile?.classList.toggle('active', open === name);
    }
  }

  // Until the person chooses, a routine that is due right now is the one thing worth
  // showing unasked. Energy never unfolds on its own (PRODUCT「面板交互」).
  function defaultPanel(state) {
    if (chosen) return;
    open = Number(state?.routines?.today?.counts?.due) > 0 ? 'routines' : null;
  }

  function renderInbox(state) {
    const count = Array.isArray(state?.impulses) ? state.impulses.length : 0;
    const value = $('#todayInboxCount');
    const sub = $('#todayInboxSub');
    if (value) value.textContent = String(count);
    if (sub) sub.textContent = count ? t('条待整理') : t('已清空');
    $('#tileInbox')?.classList.toggle('is-empty', count === 0);
  }

  function renderEnergySub(state) {
    const sub = $('#energyTileSub');
    if (sub) sub.textContent = state?.wake?.ask ? t('今天几点起？') : t('点开自评');
  }

  function render(state = getState()) {
    if (!state) return;
    $('#tileRoutines')?.classList.toggle('hidden', !state.routines);
    defaultPanel(state);
    renderInbox(state);
    renderEnergySub(state);
    sync();
  }

  function toggle(name) {
    chosen = true;
    open = open === name ? null : name;
    sync();
  }

  function listen(node, type, handler) {
    node?.addEventListener(type, handler);
    cleanup.push(() => node?.removeEventListener(type, handler));
  }

  function mount(projectionStore) {
    if (!projectionStore || typeof projectionStore.subscribe !== 'function') {
      throw new TypeError('today overview requires a projection store');
    }
    if (unsubscribe) return;
    listen($('#tileEnergy'), 'click', () => toggle('energy'));
    listen($('#tileRoutines'), 'click', () => toggle('routines'));
    listen($('#tileInbox'), 'click', () => openInbox());
    unsubscribe = projectionStore.subscribe(change => {
      const dirty = change.dirty || {};
      if (dirty.all || dirty.impulses || dirty.routines || dirty.energy || dirty.wellbeing) render(change.state);
    });
    render();
  }

  function dispose() {
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
    cleanup.splice(0).forEach(remove => remove());
  }

  return Object.freeze({ mount, dispose, render, isOpen: name => open === name });
}

export { createPopoverTodayOverview };
