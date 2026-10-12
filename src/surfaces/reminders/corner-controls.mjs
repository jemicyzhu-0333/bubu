// A corner card closes only through an explicit close control or Escape.
// Copy and empty space remain safe to click, select and scroll.
function bindCornerControls({ document, run, onFocus, setPointerInteractive }) {
  const listeners = [];
  function listen(node, type, handler) {
    if (!node) return;
    node.addEventListener(type, handler);
    listeners.push(() => node.removeEventListener(type, handler));
  }
  const close = document.getElementById('closeBtn');
  listen(close, 'click', () => { void run('dismiss'); });
  const interactive = [document.getElementById('bubble'), document.querySelector('.char-wrap'), close].filter(Boolean);
  for (const node of interactive) {
    listen(node, 'mouseenter', () => setPointerInteractive(true));
    listen(node, 'mouseleave', event => {
      if (!interactive.some(candidate => candidate.contains(event.relatedTarget))) setPointerInteractive(false);
    });
  }
  function controls() {
    return [...document.querySelectorAll('.nudge-action:not(:disabled), #closeBtn:not(:disabled)')];
  }
  const stopFocus = onFocus(() => {
    const available = controls();
    const primary = available.find(control => control.classList.contains('primary')) || available[0];
    // Let native focus reveal a control when a very small work area requires
    // the outer fallback scroll. preventScroll would strand keyboard users.
    primary?.focus();
  });
  listen(document, 'keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); void run('dismiss'); return; }
    if (event.key !== 'Tab') return;
    const available = controls();
    if (!available.length) return;
    const first = available[0], last = available.at(-1), active = document.activeElement;
    if (!available.includes(active) || (event.shiftKey ? active === first : active === last)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    }
  });
  return () => {
    for (const stop of listeners) stop();
    if (typeof stopFocus === 'function') stopFocus();
  };
}

export { bindCornerControls };
