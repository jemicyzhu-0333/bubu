// One top-layer tooltip for static and projection-rendered help, without moving form layout.
function createHelpTooltips(document) {
  let popup, owner, previousDescription, timer;
  const cleanup = [];
  const view = document.defaultView;
  const listen = (node, type, fn, options) => {
    node.addEventListener(type, fn, options);
    cleanup.push(() => node.removeEventListener(type, fn, options));
  };
  function hide() {
    clearTimeout(timer);
    if (!owner) return;
    if (previousDescription) owner.setAttribute('aria-describedby', previousDescription);
    else owner.removeAttribute('aria-describedby');
    owner = null;
    popup.hidePopover();
  }
  function show(summary) {
    if (!summary || summary === owner) return;
    hide();
    const source = summary.closest('.inline-help');
    const content = [...source.querySelectorAll('p')].map(p => p.textContent.trim()).filter(Boolean).join('\n');
    if (!content) return;
    owner = summary;
    previousDescription = summary.getAttribute('aria-describedby');
    summary.setAttribute('aria-describedby', [previousDescription,popup.id].filter(Boolean).join(' '));
    popup.textContent = content;
    (summary.closest('dialog') || document.body).appendChild(popup);
    popup.showPopover();
    const rect = summary.getBoundingClientRect();
    const width = popup.offsetWidth, height = popup.offsetHeight;
    const left = Math.max(12, Math.min(rect.left, view.innerWidth-width-12));
    const top = rect.bottom+8+height <= view.innerHeight-12 ? rect.bottom+8 : Math.max(12, rect.top-height-8);
    popup.style.left = `${left}px`; popup.style.top = `${top}px`;
  }
  function summaryFor(target) {
    return target?.closest?.('.inline-help')?.querySelector('summary')
      || target?.closest?.('.assist-note')?.querySelector('.inline-help summary');
  }
  function mount() {
    if (!document.createElement || !document.body?.appendChild || !view) return;
    popup = document.createElement('div');
    popup.id = 'panelHelpTooltip'; popup.className = 'help-tooltip'; popup.popover = 'manual';
    popup.setAttribute('role','tooltip'); document.body.appendChild(popup);
    listen(document,'pointerover',event => { const summary = summaryFor(event.target); if (summary || popup.contains(event.target)) clearTimeout(timer); if (summary) show(summary); });
    listen(document,'pointerout',event => { if (summaryFor(event.target) || popup.contains(event.target)) timer = setTimeout(hide,180); });
    listen(document,'focusin',event => { const summary = summaryFor(event.target); if (summary) show(summary); else hide(); });
    listen(document,'click',event => { const summary = summaryFor(event.target); if (summary) { event.preventDefault(); show(summary); } else if (!popup.contains(event.target)) hide(); });
    listen(document,'keydown',event => { if (event.key === 'Escape' && owner) { event.preventDefault(); event.stopImmediatePropagation(); hide(); } },true);
    listen(document,'scroll',hide,true); listen(view,'resize',hide);
  }
  return { mount, dispose() { hide(); cleanup.splice(0).forEach(remove=>remove()); popup?.remove(); } };
}
export { createHelpTooltips };
