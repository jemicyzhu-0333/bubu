import { foodName } from '../companion/food-labels.mjs';
import { t, onLocaleChanged } from '../shared/interface/i18n.mjs';
import { displaySatiation } from '../companion/satiation-display.mjs';
import { createPetFeeding, foodEffectText, foodInventorySummary, FOOD_ORDER } from './feeding.mjs';
import { isFeedSnapshot } from '../companion/food-request-lifecycle.mjs';
import { BASIC_MEAL } from '../../content/growth-policy.mjs';

// Menu visibility, read ownership and pending requests live together; closing
// cancels presentation ownership but never cancels or replaces a command ID.
function createPetFoodMenu({ document, client, content, setOpen, available, beforeOpen,
  closeCommandMenu, expand, changed, focusReturn, requestFrame, cancelFrame = globalThis.cancelAnimationFrame,
  updateSatBar, feeding: options } = {}) {
  let opened = false, opening = false, generation = 0, version = 0, openedAt = 0;
  let state = null;
  let disposed = false, focusFrame = null;
  const buttonListeners = [];
  const panel = document.getElementById('foodPanel');
  const trigger = () => document.querySelector('[data-act="feed"]');
  const feed = createPetFeeding({ ...options, client, content, refresh: read,
    render: () => render(), onBusyChanged: () => render() });

  let copyPainters = [];
  const stopLocale = onLocaleChanged(() => {
    if (!opened || disposed) return;
    copyPainters.forEach(paint => paint());
  });

  function clearButtons() {
    for (const remove of buttonListeners.splice(0)) remove();
  }
  function clearFocus() {
    if (!focusFrame) return;
    const frame = focusFrame;
    focusFrame = null;
    if (typeof cancelFrame === 'function') cancelFrame(frame.id);
  }
  function hide() {
    panel.classList.remove('show'); panel.setAttribute('aria-hidden', 'true');
    trigger()?.setAttribute('aria-expanded', 'false');
  }

  function update(data) {
    if (disposed || !data) return;
    const fields = ['satiation', 'foodInventory', 'totalFeeds', 'basicMeal', 'foodTickets'];
    const patch = Object.fromEntries(fields.filter(key => data[key] !== undefined).map(key => [key, data[key]]));
    if (!Object.keys(patch).length) return;
    version += 1;
    state = { ...state, ...patch };
    if (opened) render();
  }
  async function read() {
    if (disposed) throw new Error('food-menu-disposed');
    const ticket = version, owner = generation;
    const next = await client.pet_getFeedState();
    if (!isFeedSnapshot(next)) throw new TypeError('invalid-food-refresh');
    if (ticket === version && owner === generation) update(next);
    return next;
  }
  function render() {
    if (disposed) return;
    const foods = content()?.FOODS;
    const list = document.getElementById('foodList');
    if (!opened || !foods || !list || !state) return;
    clearButtons(); copyPainters = [];
    list.innerHTML = '';
    for (const id of FOOD_ORDER) {
      const food = foods[id];
      if (!food) continue;
      const basic = id === 'basic';
      const count = basic ? state.basicMeal?.remaining || 0 : state.foodInventory?.[id] || 0;
      if (!basic && count <= 0 && !feed.pending(id)) continue;
      const eligible = basic ? state.basicMeal?.eligible === true : count > 0;
      const button = document.createElement('button');
      button.type = 'button'; button.disabled = (!eligible && !feed.pending(id)) || feed.busy(id);
      button.className = `food-item${button.disabled ? ' disabled' : ''}`; button.dataset.food = id;
      const icon = document.createElement('span'); icon.className = 'fi-emoji'; icon.textContent = food.emoji;
      const main = document.createElement('span'); main.className = 'fi-main';
      const name = document.createElement('span'); name.className = 'fi-name';
      const effect = document.createElement('span'); effect.className = 'fi-eff';

      const stock = document.createElement('span'); stock.className = 'fi-count';
      const paintCopy = () => {
        name.textContent = foodName(id, food.name);
        effect.textContent = feed.pending(id) ? t('核对上次喂食结果') : basic ? (count === 0 ? t('今日已用完') : eligible ? t('免费 · 饱食最多到 {value}', { value: BASIC_MEAL.baseline }) : t('饱食不高于 {value} 时可用', { value: BASIC_MEAL.hungryAt })) : foodEffectText(food);
        stock.textContent = basic ? t('今日余 {count}', { count }) : `×${count}`;
      };
      copyPainters.push(paintCopy); paintCopy();
      main.append(name, effect); button.append(icon, main, stock);
      let active = true;
      const click = event => {
        if (disposed || !opened || !active) return;
        event.stopPropagation();
        if (!button.disabled) void feed.feedPet(id);
      };
      button.addEventListener('click', click);
      buttonListeners.push(() => { active = false; button.removeEventListener('click', click); });
      list.appendChild(button);
    }
    const total = FOOD_ORDER.filter(id => id !== 'basic').reduce((sum, id) => sum + (state.foodInventory?.[id] || 0), 0);
    const paintDaily = () => { document.getElementById('foodDaily').textContent = foodInventorySummary(state, total); };
    copyPainters.push(paintDaily); paintDaily();
    const value = displaySatiation(state.satiation);
    const fill = document.getElementById('fpSatFill'), text = document.getElementById('fpSatTxt');
    if (fill) fill.style.width = `${value}%`;
    const paintSatiation = () => {
      if (text) text.textContent = t('饱食 {value}/100', { value });
      document.getElementById('fpSatProgress')?.setAttribute('aria-valuetext', t('饱食 {value}/100', { value }));
    };
    copyPainters.push(paintSatiation); paintSatiation();
    const progress = document.getElementById('fpSatProgress');
    progress?.setAttribute('aria-valuenow', String(value));
    progress?.setAttribute('aria-valuetext', t('饱食 {value}/100', { value }));
    updateSatBar(value);
  }
  async function open() {
    if (disposed || opened || opening || !available()) return;
    const owner = ++generation;
    opening = true; setOpen(true);
    try {
      if (disposed || owner !== generation) return;
      beforeOpen();
      if (disposed || owner !== generation) return;
      await read();
      if (owner !== generation) return;
      if (!available()) { await close(); return; }
      opened = true; setOpen(true);
      if (disposed || owner !== generation || !opened) return;
      await closeCommandMenu();
      if (owner !== generation || !opened) return;
      if (!available()) { await close(); return; }
      const geometry = await expand();
      if (owner !== generation || !opened) return;
      panel.classList.remove('side-left', 'side-right');
      panel.classList.add(geometry?.side === 'left' ? 'side-left' : 'side-right');
      render();
      if (disposed || owner !== generation || !opened) return;
      panel.classList.add('show'); panel.setAttribute('aria-hidden', 'false');
      trigger()?.setAttribute('aria-expanded', 'true'); openedAt = Date.now(); changed();
      if (disposed || owner !== generation || !opened) return;
      const frame = { id: null };
      focusFrame = frame;
      frame.id = requestFrame(() => {
        if (focusFrame !== frame) return;
        focusFrame = null;
        if (disposed || owner !== generation || !opened) return;
        (panel.querySelector('.food-item:not(:disabled)') || document.getElementById('foodClose')).focus();
      });
    } catch (_) {
      if (owner === generation) { opened = false; setOpen(false); changed(); }
    } finally { if (owner === generation) opening = false; }
  }
  async function close() {
    if (disposed || (!opened && !opening)) return;
    const owner = ++generation;
    opened = false; opening = false; setOpen(false); feed.cancel('menu-closed');
    clearFocus(); clearButtons(); hide(); changed();
    try { await expand(); } catch (_) { /* menu remains closed */ }
    if (owner === generation && !opened) focusReturn();
  }
  const outside = event => {
    if (disposed || !opened || Date.now() - openedAt < 800) return;
    const inside = ['.food-item', '.food-panel', '.pet-hit', '.press-ring', '.command-item', '.feed-quick', '.dev-tools'];
    if (!inside.some(selector => event.target.closest(selector))) void close();
  };
  return Object.freeze({ open, close, update, outside, feed, render, dispose() {
    if (disposed) return;
    disposed = true; stopLocale(); copyPainters = [];
    generation += 1; opened = false; opening = false; state = null;
    clearFocus(); clearButtons(); hide(); feed.dispose(); setOpen(false);
  } });
}
export { createPetFoodMenu };
