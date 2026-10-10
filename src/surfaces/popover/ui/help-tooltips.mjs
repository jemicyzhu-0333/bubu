import { onLocaleChanged, t } from '../../shared/interface/i18n.mjs';

// One top-layer tooltip for static and projection-rendered help, without moving form layout.
function createHelpTooltips(document) {
  let popup, owner, previousDescription, previousExpanded, timer, sourceObserver;
  const cleanup = [];
  const view = document.defaultView;
  const listen = (node, type, fn, options) => {
    node.addEventListener(type, fn, options);
    cleanup.push(() => node.removeEventListener(type, fn, options));
  };
  function hide() {
    clearTimeout(timer);
    sourceObserver?.disconnect();
    if (!owner) return;
    if (previousDescription) owner.setAttribute('aria-describedby', previousDescription);
    else owner.removeAttribute('aria-describedby');
    if (previousExpanded === null) owner.removeAttribute('aria-expanded');
    else owner.setAttribute('aria-expanded', previousExpanded);
    owner = null;
    popup.hidePopover();
  }
  function helpText(node) {
    if (node.dataset?.i18n) return t(node.dataset.i18n);
    return node.childNodes?.length ? [...node.childNodes].map(helpText).join('') : node.textContent || '';
  }
  function paint() {
    if (!owner) return;
    const source = owner.closest('.inline-help');
    popup.textContent = [...source.querySelectorAll('p')].map(p => helpText(p).trim()).filter(Boolean).join('\n');
    const rect = owner.getBoundingClientRect();
    const width = popup.offsetWidth, height = popup.offsetHeight;
    const left = Math.max(12, Math.min(rect.left, view.innerWidth-width-12));
    const top = rect.bottom+8+height <= view.innerHeight-12 ? rect.bottom+8 : Math.max(12, rect.top-height-8);
    popup.style.left = `${left}px`; popup.style.top = `${top}px`;
  }
  function show(summary) {
    if (!summary || summary === owner) return;
    hide();
    const source = summary.closest('.inline-help');
    if (![...source.querySelectorAll('p')].some(p => helpText(p).trim())) return;
    owner = summary;
    previousDescription = summary.getAttribute('aria-describedby');
    previousExpanded = summary.getAttribute('aria-expanded');
    summary.setAttribute('aria-describedby', [previousDescription,popup.id].filter(Boolean).join(' '));
    summary.setAttribute('aria-expanded', 'true');
    (summary.closest('dialog') || document.body).appendChild(popup);
    paint(); popup.showPopover(); paint();
    sourceObserver?.observe(source, { childList: true, characterData: true, subtree: true });
  }
  function summaryFor(target) {
    return target?.closest?.('.inline-help')?.querySelector('summary')
      || target?.closest?.('.assist-note')?.querySelector('.inline-help summary');
  }
  function mount() {
    if (!document.createElement || !document.body?.appendChild || !view) return;
    if (view.MutationObserver) sourceObserver = new view.MutationObserver(paint);
    popup = document.createElement('div');
    popup.id = 'panelHelpTooltip'; popup.className = 'help-tooltip'; popup.popover = 'manual';
    popup.setAttribute('role','tooltip'); document.body.appendChild(popup);
    listen(document,'pointerover',event => { const summary = summaryFor(event.target); if (summary || popup.contains(event.target)) clearTimeout(timer); if (summary) show(summary); });
    listen(document,'pointerout',event => {
      if (summaryFor(event.target) || popup.contains(event.target)) timer = setTimeout(() => { if (document.activeElement !== owner) hide(); },180);
    });
    listen(document,'focusin',event => { const summary = summaryFor(event.target); if (summary) show(summary); else hide(); });
    listen(document,'focusout',event => { if (summaryFor(event.target) === owner && !popup.contains(event.relatedTarget)) hide(); });
    listen(document,'click',event => { const summary = summaryFor(event.target); if (summary) { event.preventDefault(); show(summary); } else if (!popup.contains(event.target)) hide(); });
    listen(document,'keydown',event => { if (event.key === 'Escape' && owner) { event.preventDefault(); event.stopImmediatePropagation(); hide(); } },true);
    listen(document,'scroll',hide,true); listen(view,'resize',hide);
    cleanup.push(onLocaleChanged(paint));
  }
  return { mount, dispose() { hide(); cleanup.splice(0).forEach(remove=>remove()); popup?.remove(); } };
}
export { createHelpTooltips };
