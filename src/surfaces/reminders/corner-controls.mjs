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
  function readingOrder() {
    const copy = document.getElementById('bubbleCopy');
    const status = document.getElementById('nudgeStatus');
    const actions = controls().filter(control => control !== close);
    return [copy, ...actions, status && !status.hidden ? status : null,
      close && !close.disabled ? close : null].filter(Boolean);
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
    const available = readingOrder();
    if (!available.length) return;
    // Include readable scroll regions explicitly instead of depending on a
    // Chromium version's implicit focusable-scroll-container behavior.
    const index = available.indexOf(document.activeElement);
    const next = index < 0 ? (event.shiftKey ? available.length - 1 : 0)
      : (index + (event.shiftKey ? -1 : 1) + available.length) % available.length;
    event.preventDefault();
    available[next].focus();
  });
  return () => {
    for (const stop of listeners) stop();
    if (typeof stopFocus === 'function') stopFocus();
  };
}

export { bindCornerControls };
