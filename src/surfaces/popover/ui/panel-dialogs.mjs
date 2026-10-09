// Native modal dialogs own top-layer placement, focus trapping and return focus.
function createPanelDialogs(document) {
  const cleanup = [];
  function listen(node, type, handler) {
    node.addEventListener(type, handler);
    cleanup.push(() => node.removeEventListener(type, handler));
  }
  function mount() {
    for (const dialog of document.querySelectorAll('.panel-dialog')) {
      const trigger = document.querySelector(`[data-dialog="${dialog.id}"]`);
      const close = () => { dialog.close(); trigger?.focus(); };
      if (trigger) listen(trigger, 'click', () => dialog.showModal());
      for (const button of dialog.querySelectorAll('[data-dialog-close]')) listen(button, 'click', close);
      listen(dialog, 'click', event => { if (event.target === dialog) {
        const r = dialog.getBoundingClientRect();
        if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) close();
      } });
      // Keep the legacy modal registry from also dismissing a surface behind us.
      listen(dialog, 'keydown', event => { if (event.key === 'Escape' || event.key === 'Tab') event.stopPropagation(); });
      listen(dialog, 'cancel', event => { event.preventDefault(); close(); });
    }
  }
  return { mount, dispose() { cleanup.splice(0).forEach(remove => remove()); } };
}
export { createPanelDialogs };
