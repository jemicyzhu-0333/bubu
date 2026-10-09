'use strict';

const SECTIONS = Object.freeze([
  ['expressions', '表情'],
  ['actions', '行为动作'],
  ['sessions', '会话动作'],
  ['props', '道具'],
  ['scenes', '场景'],
  ['skins', '皮肤形态'],
  ['appearances', '装饰'],
  ['views', '朝向']
]);

const VIEW_LABELS = Object.freeze({
  front: '正面',
  'three-quarter': '三分之四',
  profile: '侧面',
  back: '背面'
});

function createPetDevtools({ document, panel, list, viewSelect, skinSelect, levelInput, callbacks = {},
  setTimeout = globalThis.setTimeout, clearTimeout = globalThis.clearTimeout } = {}) {
  if (!document || !panel || !list) throw new TypeError('pet devtools elements are required');
  let catalog = null;
  let open = false;
  let allVisible = true;
  let disposed = false;
  const listeners = [], buttonListeners = [], waits = new Set();

  function listen(element, callback, owners = listeners) {
    if (!element) return;
    let active = true;
    const handler = event => { if (!disposed && active) return callback(event); };
    element.addEventListener('click', handler);
    owners.push(() => { active = false; element.removeEventListener('click', handler); });
  }

  function clearButtons() {
    for (const remove of buttonListeners.splice(0)) remove();
  }

  function pause() {
    return new Promise(resolve => {
      const wait = { timer: null, finish };
      function finish() {
        if (!waits.delete(wait)) return;
        clearTimeout(wait.timer);
        resolve();
      }
      waits.add(wait);
      wait.timer = setTimeout(finish, 180);
    });
  }

  function selectedOptions() {
    return {
      view: viewSelect && viewSelect.value ? viewSelect.value : 'front',
      skin: skinSelect && skinSelect.value ? skinSelect.value : null,
      level: Math.max(1, Math.min(999, Number(levelInput && levelInput.value) || 99))
    };
  }

  function createButton(item, category) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'dev-item';
    button.dataset.devCategory = category;
    button.dataset.devId = item.id;
    button.title = item.unlockDesc || item.id;
    const label = category === 'view'
      ? (VIEW_LABELS[item.id] || item.label || item.id)
      : item.label || item.name || item.id;
    button.textContent = `${label} · ${item.id}`;
    listen(button, () => callbacks.preview?.({
      category,
      id: item.id,
      ...selectedOptions(),
      skin: category === 'skin' ? item.id : selectedOptions().skin
    }), buttonListeners);
    return button;
  }

  function render() {
    if (disposed) return;
    clearButtons();
    if (typeof list.replaceChildren === 'function') list.replaceChildren();
    else {
      list.innerHTML = '';
      if (Array.isArray(list.children)) list.children.length = 0;
    }
    if (!catalog) return;
    for (const [category, label] of SECTIONS) {
      const items = category === 'views'
        ? (Array.isArray(catalog.views) ? catalog.views : []).map(id => ({ id, label: id }))
        : Array.isArray(catalog[category]) ? catalog[category] : [];
      if (!items.length) continue;
      const section = document.createElement('section');
      section.className = `dev-section ${allVisible ? '' : 'collapsed'}`;
      const heading = document.createElement('h3');
      heading.textContent = `${label}（${items.length}）`;
      section.appendChild(heading);
      const grid = document.createElement('div');
      grid.className = 'dev-grid';
      for (const item of items) grid.appendChild(createButton(item, category === 'views' ? 'view' : category.slice(0, -1)));
      section.appendChild(grid);
      list.appendChild(section);
    }
  }

  function setCatalog(nextCatalog) {
    if (disposed) return;
    catalog = nextCatalog && typeof nextCatalog === 'object' ? nextCatalog : null;
    if (skinSelect && catalog) {
      skinSelect.replaceChildren();
      for (const skin of catalog.skins || []) {
        const option = document.createElement('option');
        option.value = skin.id;
        option.textContent = `${skin.label} (${skin.id})`;
        skinSelect.appendChild(option);
      }
    }
    if (viewSelect && catalog) {
      viewSelect.replaceChildren();
      for (const view of catalog.views || []) {
        const option = document.createElement('option');
        option.value = view;
        option.textContent = VIEW_LABELS[view] || view;
        viewSelect.appendChild(option);
      }
    }
    render();
  }

  function setOpen(next) {
    if (disposed) return;
    open = Boolean(next);
    panel.classList.toggle('show', open);
    panel.setAttribute('aria-hidden', String(!open));
    callbacks.onStateChange?.(open);
  }

  listen(panel.querySelector('[data-dev-action="close"]'), () => setOpen(false));
  listen(panel.querySelector('[data-dev-action="all"]'), () => {
    allVisible = true;
    render();
  });
  listen(panel.querySelector('[data-dev-action="play-all"]'), async () => {
    if (!catalog || typeof callbacks.preview !== 'function') return;
    const options = selectedOptions();
    const queue = SECTIONS.flatMap(([category]) => {
      const items = category === 'views'
        ? (catalog.views || []).map(id => ({ id }))
        : Array.isArray(catalog[category]) ? catalog[category] : [];
      return items.map(item => ({ category: category === 'views' ? 'view' : category.slice(0, -1), id: item.id }));
    });
    for (const item of queue) {
      if (disposed) return;
      callbacks.preview({ ...item, ...options, skin: item.category === 'skin' ? item.id : options.skin });
      if (disposed) return;
      await pause();
    }
  });
  listen(panel.querySelector('[data-dev-action="clear"]'), () => callbacks.clear?.());

  function dispose() {
    if (disposed) return;
    disposed = true;
    open = false;
    catalog = null;
    for (const remove of listeners.splice(0)) remove();
    clearButtons();
    for (const wait of waits) wait.finish();
    panel.classList.remove('show');
    panel.setAttribute('aria-hidden', 'true');
  }

  return Object.freeze({
    open: () => setOpen(true),
    close: () => setOpen(false),
    toggle: () => setOpen(!open),
    setCatalog,
    dispose,
    get isOpen() { return open; }
  });
}

export { createPetDevtools };
export default Object.freeze({ createPetDevtools });
