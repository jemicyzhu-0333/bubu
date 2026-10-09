import { createSurfaceMotion } from '../../shared/motion.mjs';

function createChromeMotion(document, { motion = createSurfaceMotion(document) } = {}) {
  const cleanup = [];
  let observer;
  function mount() {
    // Only animate the icon. Hit targets and native window geometry remain stable.
    for (const button of document.querySelectorAll('[data-feedback]')) {
      const icon = button.querySelector('.header-glyph, .entry-glyph, .tab-glyph');
      if (!icon) continue;
      for (const type of ['pointerenter', 'focus', 'click']) {
        const handler = () => { void motion.feedback(icon, button.dataset.feedback, type === 'click'); };
        button.addEventListener(type, handler);
        cleanup.push(() => button.removeEventListener(type, handler));
      }
    }
    const Observer = document.defaultView?.MutationObserver;
    if (!Observer) return;
    const visible = new WeakMap();
    const targets = [...document.querySelectorAll('.tab-content, .modal-mask, #settingsMask, #reviewInbox')];
    const shown = node => !node.hidden && !node.classList.contains('hidden') && node.getAttribute('aria-hidden') !== 'true'
      && (node.tagName !== 'DETAILS' || node.open);
    targets.forEach(node => visible.set(node, shown(node)));
    observer = new Observer(records => {
      for (const node of new Set(records.map(record => record.target))) {
        const next = shown(node);
        if (next && !visible.get(node)) {
          const content = node.querySelector('.modal-body, .settings-drawer-scroll, .review-inbox-panel') || node;
          void motion.enter(content);
        }
        visible.set(node, next);
      }
    });
    targets.forEach(node => observer.observe(node, { attributes: true, attributeFilter: ['hidden', 'aria-hidden', 'open', 'class'] }));
  }
  return { mount, dispose() { observer?.disconnect(); cleanup.splice(0).forEach(remove => remove()); motion.dispose(); } };
}
export { createChromeMotion };
