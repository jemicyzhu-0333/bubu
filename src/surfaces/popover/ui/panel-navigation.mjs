// Destinations are presentation state only. Task and routine ownership stays separate.
function createPanelNavigation({ document, $, $$, nextRovingIndex, onTabShown }) {
  let arrangement = 'tasks';
  const cleanup = [];
  function activate(btn, moveFocus = false) {
    if (!btn) return;
    const destination = btn.id === 'tabArrange' ? arrangement : btn.dataset.tab;
    const arranging = ['tasks', 'routines', 'inbox', 'archive'].includes(destination);
    if (arranging) arrangement = destination;
    document.body.dataset.destination = destination;
    $$('.tab-btn').forEach(tab => {
      const active = tab.id === 'tabArrange' ? arranging : tab.dataset.tab === destination;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    $$('.tab-content').forEach(panel => {
      const active = panel.dataset.tab === destination;
      panel.classList.toggle('active', active);
      panel.setAttribute('aria-hidden', String(!active));
      panel.hidden = !active;
    });
    const plan = $('#arrangeNavigation');
    if (plan) plan.hidden = !arranging;
    const partner = $('#tabCompanion');
    partner?.setAttribute('aria-pressed', String(destination === 'companion'));
    const main = [...$$('.tab-btn')].filter(tab => tab.dataset.nav === 'main');
    // Returning from the companion always leaves a keyboard entry to the main tabs.
    if (destination === 'companion' && main[0]) main[0].tabIndex = 0;
    if (moveFocus) btn.focus();
    onTabShown(destination);
  }
  function mount() {
    for (const btn of [...$$('.tab-btn'), $('#tabCompanion')].filter(Boolean)) {
      const click = () => activate(btn);
      const keydown = event => {
        if (!btn.dataset.nav) return;
        const peers = [...$$('.tab-btn')].filter(tab => tab.dataset.nav === btn.dataset.nav);
        const index = nextRovingIndex(peers.indexOf(btn), event.key, peers.length);
        if (index === null || !peers[index]) return;
        event.preventDefault();
        activate(peers[index], true);
      };
      btn.addEventListener('click', click);
      btn.addEventListener('keydown', keydown);
      cleanup.push(() => { btn.removeEventListener('click', click); btn.removeEventListener('keydown', keydown); });
    }
  }
  return { activate, mount, dispose() { cleanup.splice(0).forEach(remove => remove()); } };
}
export { createPanelNavigation };
