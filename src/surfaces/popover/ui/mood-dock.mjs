// Presentation only: preview freely, commit once on release through the existing button action.
function createMoodDock({ host, buttons = [] } = {}) {
  const items = [...buttons];
  const cleanups = [];
  let pointer = null;
  let suppressClick = false;
  function listen(node, name, fn) {
    node?.addEventListener(name, fn);
    cleanups.push(() => node?.removeEventListener(name, fn));
  }
  function preview(index, pointerX = null) {
    const centers = pointerX === null ? [] : items.map(item => {
      const rect = item.getBoundingClientRect();
      return (rect.left + rect.right) / 2;
    });
    const spacing = Math.max(1, (centers.at(-1) - centers[0]) / Math.max(1, items.length - 1));
    items.forEach((item, i) => {
      const distance = pointerX === null ? Math.abs(i - index) : Math.abs(centers[i] - pointerX) / spacing;
      const proximity = index === null ? 0 : Math.max(0, 1 - distance / 2);
      item.style?.setProperty?.('--dock-scale', String(1 + proximity * .3));
      item.style?.setProperty?.('--dock-lift', `${-proximity * 8}px`);
      item.classList.toggle('dock-preview', i === index);
    });
  }
  function hit(event) {
    const boxes = items.map(item => item.getBoundingClientRect());
    if (!boxes.length || event.clientX < boxes[0].left - 12 || event.clientX > boxes.at(-1).right + 12
        || event.clientY < Math.min(...boxes.map(box => box.top)) - 20
        || event.clientY > Math.max(...boxes.map(box => box.bottom)) + 24) return -1;
    return boxes.reduce((closest, box, index) =>
      Math.abs((box.left + box.right) / 2 - event.clientX)
        < Math.abs((boxes[closest].left + boxes[closest].right) / 2 - event.clientX) ? index : closest, 0);
  }
  function reset() { pointer = null; preview(null); }
  function mount() {
    if (!host || cleanups.length) return;
    listen(host, 'pointermove', event => {
      const index = hit(event);
      preview(index >= 0 ? index : null, event.clientX);
    });
    listen(host, 'pointerdown', event => {
      if (event.button !== 0) return;
      const index = hit(event);
      if (index < 0) return;
      pointer = event.pointerId; suppressClick = false;
      host.setPointerCapture?.(pointer);
      preview(index);
    });
    listen(host, 'pointerup', event => {
      if (event.pointerId !== pointer) return;
      const index = hit(event);
      const chosen = index >= 0 ? items[index] : null;
      reset();
      // The native follow-up click must not write a second observation.
      if (chosen) { suppressClick = false; chosen.click(); }
      suppressClick = true;
    });
    const consumeClick = event => {
      if (suppressClick && event.detail !== 0) {
        event.preventDefault(); event.stopImmediatePropagation(); suppressClick = false;
      }
    };
    host.addEventListener('click', consumeClick, true);
    cleanups.push(() => host.removeEventListener('click', consumeClick, true));
    listen(host, 'pointercancel', reset);
    listen(host, 'lostpointercapture', reset);
    listen(host, 'pointerleave', () => { if (pointer === null) preview(null); });
    items.forEach((item, index) => {
      listen(item, 'focus', () => preview(index));
      listen(item, 'blur', () => preview(null));
      listen(item, 'keydown', event => {
        const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
        if (!step) return;
        event.preventDefault();
        const next = items[Math.max(0, Math.min(items.length - 1, index + step))];
        next.focus(); next.click();
      });
    });
  }
  return { mount, dispose() { cleanups.splice(0).forEach(fn => fn()); reset(); } };
}
export { createMoodDock };
