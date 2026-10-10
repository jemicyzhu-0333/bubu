'use strict';

// Wardrobe presentation and commands. The projection owns equipped items and
// unlocks; stage navigation only previews immutable recipes. No optimistic wear.
import { t, getLocale } from '../../shared/interface/i18n.mjs';
import { forms } from '../../../capabilities/companion/index.mjs';
import { createAppearanceCommand } from './appearance-command.mjs';
import { createWardrobeStage } from './wardrobe-stage.mjs';

// 能力按组名的字母序返回,那会把「鞋子」排到「光环」前面。展示顺序按从头到脚
// 排,由当前形态的槽位声明给出，而不是在 surface 重写一份角色清单。
function formFor(state) { return forms.resolvePetForm(state?.currentSkin); }

function groupLabel(form, group) {
  return t(form.slotLabels[group] || group);
}

function slotDisplayLabel(form, group) {
  if (form.id !== 'usagi') return groupLabel(form, group);
  const labels = { 'usagi.headwear': '头饰', 'usagi.earwear': '耳饰', 'usagi.aura': '光环',
    'usagi.neckwear': '颈饰', 'usagi.backwear': '背饰', 'usagi.sidebag': '随身', 'usagi.footwear': '鞋子' };
  return t(labels[group] || form.slotLabels[group] || group);
}

function orderChoices(choices, form) {
  const ranked = [...choices];
  ranked.sort((left, right) => {
    const leftRank = form.supportedSlots.indexOf(left.group);
    const rightRank = form.supportedSlots.indexOf(right.group);
    return (leftRank < 0 ? form.supportedSlots.length : leftRank)
      - (rightRank < 0 ? form.supportedSlots.length : rightRank);
  });
  return ranked;
}

function createPopoverWardrobeFeature({
  document, $, getState, escapeHTML, surfaceClient, drawPetPreview, restoreModalFocus
} = {}) {
  if (!document || typeof $ !== 'function') {
    throw new TypeError('wardrobe feature requires document and $');
  }
  for (const [name, fn] of Object.entries({
    getState, escapeHTML, drawPetPreview, restoreModalFocus
  })) {
    if (typeof fn !== 'function') throw new TypeError(`wardrobe feature requires ${name}`);
  }
  if (!surfaceClient || typeof surfaceClient.equipAppearance !== 'function'
      || typeof surfaceClient.resetAppearance !== 'function') {
    throw new TypeError('wardrobe feature requires surfaceClient');
  }

  let lastKey = '';
  let repaintCopy = () => {};
  let focusedSlot = null;      // 左列聚焦的槽位,这一层自己的视图状态
  let pendingFocusItem = null; // 刚点过的那颗选项:重绘后焦点要还给它
  let trigger = null;
  let unsubscribe = null;
  let store = null;
  let bound = false;
  let visit = 0;
  const command = createAppearanceCommand({ $, reconcile, changed: () => { pendingFocusItem = null; },
    controls: () => [...($('#wardrobeOptions')?.querySelectorAll?.('.wardrobe-option') || []),
      $('#wardrobeReset'), $('#wardrobeApplyOutfit')].filter(Boolean) });
  const stage = createWardrobeStage({ $, getState, formFor, drawPetPreview, busy: command.busy, lockText,
    onApply: (lookId, expectedSkin) => { void command.run(async () => {
      const result = await surfaceClient.applyOutfit(lookId, expectedSkin);
      if (result?.ok === false) stage.cancelApplyFocus();
      return result;
    }); } });

  // 皮肤专属件要说清是哪套皮肤解锁的。名字只有投影里有,组里没有,所以在这里查表。
  function skinName(state, skinId) {
    const skins = Array.isArray(state.skins) ? state.skins : [];
    const found = skins.find(skin => skin.id === skinId);
    return found ? found.name : skinId;
  }

  function lockText(state, lockReason) {
    if (!lockReason) return '';
    if (lockReason.kind === 'level') return `Lv.${lockReason.minLevel}`;
    if (lockReason.kind === 'skin') return t('{name}专属', { name: skinName(state, lockReason.skin) });
    return t('未解锁');
  }

  // Selected labels come from the same canonical choices as the option grid.
  function wornLabel(choice) {
    if (!choice.selected) return '—';
    const found = choice.options.find(option => option.id === choice.selected);
    return found ? found.label : choice.selected;
  }

  function slotMarkup(form, choice, selected) {
    return '<button type="button" class="wardrobe-slot" role="tab"'
      + ` data-group="${escapeHTML(choice.group)}" aria-selected="${selected ? 'true' : 'false'}"`
      + ` aria-label="${escapeHTML(groupLabel(form, choice.group))}" aria-controls="wardrobeOptions" tabindex="${selected ? '0' : '-1'}">`
      + `<span class="slot-name">${escapeHTML(slotDisplayLabel(form, choice.group))}</span>`
      + `<span class="slot-worn">${escapeHTML(wornLabel(choice))}</span>`
      + '</button>';
  }

  function optionMarkup(state, group, option, selected) {
    const isSelected = option.id === selected;
    const lock = option.available ? '' : lockText(state, option.lockReason);
    const classes = ['wardrobe-option'];
    if (isSelected) classes.push('selected');
    if (!option.available) classes.push('locked');
    const label = escapeHTML(option.label);
    const hint = lock ? `<span class="wardrobe-lock" data-icon="lock">${escapeHTML(lock)}</span>` : '';
    const aria = option.available
      ? (isSelected ? t('{name}，已佩戴', { name: option.label }) : option.label)
      : t('{name}，未解锁：{reason}', { name: option.label, reason: lock });
    return `<button type="button" class="${classes.join(' ')}"`
      + ` data-group="${escapeHTML(group)}" data-item="${escapeHTML(option.id)}"`
      + ` aria-pressed="${isSelected ? 'true' : 'false'}"`
      + ` aria-label="${escapeHTML(aria)}"${option.available ? '' : ' disabled'}>`
      + `<canvas class="wardrobe-item-preview" data-item-preview="${escapeHTML(option.id)}" width="135" height="135" aria-hidden="true"></canvas>`
      + `<span class="wardrobe-item-name">${label}</span>${hint}</button>`;
  }

  function optionsMarkup(state, form, choice) {
    // 「不戴」永远排在最前:互斥组里“脱下来”和“换一件”是同一个动作,把它做成
    // 一个普通选项,用户就不需要再找一个额外的取消按钮。
    const empty = `<button type="button" class="wardrobe-option${choice.selected ? '' : ' selected'}"`
      + ` data-group="${escapeHTML(choice.group)}" data-item=""`
      + ` aria-pressed="${choice.selected ? 'false' : 'true'}"`
      + ` aria-label="${escapeHTML(t('不戴{slot}', { slot: groupLabel(form, choice.group) }))}"><span class="wardrobe-empty-art" aria-hidden="true">—</span><span class="wardrobe-item-name">${escapeHTML(t('不戴'))}</span></button>`;
    const options = choice.options.map(option => optionMarkup(state, choice.group, option, choice.selected));
    return `<p class="wardrobe-options-label">${escapeHTML(t('我的穿搭配饰'))}</p>` + empty + options.join('');
  }

  function render(state = getState()) {
    if (!state) return;
    const appearance = state.appearance || {};
    const form = formFor(state);
    const choices = orderChoices(Array.isArray(appearance.choices) ? appearance.choices : [], form);
    const wornIds = Array.isArray(appearance.wornIds) ? appearance.wornIds : [];
    // 聚焦的槽位可能因为换皮肤而整组消失,那就退回第一个槽位,而不是让右列空着。
    if (!choices.some(choice => choice.group === focusedSlot)) {
      focusedSlot = choices.length ? choices[0].group : null;
    }
    const dataKey = JSON.stringify([state.currentSkin, wornIds, choices, focusedSlot]);
    const key = `${getLocale()}|${dataKey}`;
    if (key === lastKey) { stage.render(state, form.id); command.paint(); return; }
    lastKey = key;

    const slots = $('#wardrobeSlots');
    if (slots) {
      slots.innerHTML = choices.map(choice => slotMarkup(form, choice, choice.group === focusedSlot)).join('');
    }

    const options = $('#wardrobeOptions');
    if (options) {
      const focused = choices.find(choice => choice.group === focusedSlot);
      options.innerHTML = focused
        ? optionsMarkup(state, form, focused)
        : `<p class="wardrobe-empty">${escapeHTML(t('还没有可搭配的配饰。升级和解锁皮肤都会往这里添件。'))}</p>`;
    }

    // Thumbnails are passive single-piece previews from the production painter.
    // Locked pieces may be previewed, but only the projection authorizes equipping.
    let thumbnailFailed = false;
    const focusedChoice = choices.find(choice => choice.group === focusedSlot);
    for (const item of focusedChoice?.options || []) {
      const target = options?.querySelector(`[data-item-preview="${item.id}"]`);
      if (target) {
        try { drawPetPreview(target, { skinId: state.currentSkin || 'pink', itemIds: [item.id], size: 'preview' }); }
        catch (_) {
          // An optional thumbnail must never interrupt canonical controls/status.
          target.hidden = true;
          thumbnailFailed = true;
          lastKey = ''; // Retry failed artwork on the next normal projection.
        }
      }
    }
    const wornPieces = $('#wardrobeWornPieces');
    if (wornPieces) {
      wornPieces.textContent = choices.flatMap(choice => choice.options)
        .filter(item => wornIds.includes(item.id)).map(item => item.label).join(' · ');
      wornPieces.title = wornPieces.textContent;
    }

    const canvas = $('#wardrobePreview');
    if (!stage.render(state, form.id) && canvas) {
      drawPetPreview(canvas, { skinId: state.currentSkin || 'pink', itemIds: wornIds, size: 'preview' });
    }

    const summary = $('#wardrobeSummary');
    if (summary) {
      summary.textContent = wornIds.length
        ? t('正戴着 {count} 件', { count: wornIds.length })
        : t('现在什么都没戴');
    }

    // 默认视图上「换装」入口的副标题也归这一层写:配饰只有一个所有者,两处各数
    // 一遍迟早会对不上。
    const entryMeta = $('#wardrobeEntryMeta');
    if (entryMeta) {
      entryMeta.textContent = wornIds.length ? t('戴着 {count} 件', { count: wornIds.length }) : t('什么都没戴');
    }

    // Language changes only repaint copy on the existing controls and canvases.
    repaintCopy = () => {
      lastKey = thumbnailFailed ? '' : `${getLocale()}|${dataKey}`;
      for (const slot of slots?.querySelectorAll('.wardrobe-slot') || []) {
        const label = slot.querySelector('.slot-name');
        if (label) label.textContent = slotDisplayLabel(form, slot.dataset.group);
        slot.setAttribute('aria-label', groupLabel(form, slot.dataset.group));
      }
      const focused = choices.find(choice => choice.group === focusedSlot);
      for (const button of options?.querySelectorAll('.wardrobe-option') || []) {
        const option = focused?.options.find(item => item.id === button.dataset.item);
        if (!option) {
          const name = button.querySelector('.wardrobe-item-name');
          if (name) name.textContent = t('不戴');
          button.setAttribute('aria-label', t('不戴{slot}', { slot: groupLabel(form, button.dataset.group) }));
          continue;
        }
        const lock = option.available ? '' : lockText(state, option.lockReason);
        button.setAttribute('aria-label', option.available
          ? (option.id === focused.selected ? t('{name}，已佩戴', { name: option.label }) : option.label)
          : t('{name}，未解锁：{reason}', { name: option.label, reason: lock }));
        const hint = button.querySelector('.wardrobe-lock');
        if (hint) hint.textContent = lock;
      }
      const optionsLabel = options?.querySelector('.wardrobe-options-label');
      if (optionsLabel) optionsLabel.textContent = t('我的穿搭配饰');
      const empty = options?.querySelector('.wardrobe-empty');
      if (empty) empty.textContent = t('还没有可搭配的配饰。升级和解锁皮肤都会往这里添件。');
      if (summary) summary.textContent = wornIds.length ? t('正戴着 {count} 件', { count: wornIds.length }) : t('现在什么都没戴');
      if (entryMeta) entryMeta.textContent = wornIds.length ? t('戴着 {count} 件', { count: wornIds.length }) : t('什么都没戴');
      stage.repaintCopy();
      command.paint();
    };

    // 投影回流会把整块选项重画掉,键盘用户的焦点会掉到 body 上。把它还给刚点过
    // 的那颗按钮 —— 连着换两件是常见动作,每次都要重新 Tab 进来是不能接受的。
    command.paint();
    if (pendingFocusItem !== null && options && isOpen()) {
      const back = options.querySelector(`.wardrobe-option[data-item="${pendingFocusItem}"]`);
      pendingFocusItem = null;
      if (back) back.focus();
    }
  }

  // 一个委托监听器管所有选项,而不是每次重画都重新绑一遍几十个按钮。
  function onOptionsClick(event) {
    const button = event.target && typeof event.target.closest === 'function'
      ? event.target.closest('.wardrobe-option')
      : null;
    if (!button || button.disabled || command.busy()) return;
    const group = button.dataset ? button.dataset.group : '';
    if (!group) return;
    const itemId = button.dataset.item || null;
    if (button.getAttribute('aria-pressed') === 'true') return;
    pendingFocusItem = button.dataset.item;
    const owner = visit;
    void command.run(async () => {
      const result = await surfaceClient.equipAppearance(group, itemId);
      if (result?.ok === true && owner === visit && isOpen()) stage.showCurrent();
      return result;
    });
  }

  function onSlotsClick(event) {
    const slot = event.target && typeof event.target.closest === 'function'
      ? event.target.closest('.wardrobe-slot')
      : null;
    if (!slot || !slot.dataset || !slot.dataset.group) return;
    focusSlot(slot.dataset.group);
  }

  // 左列是 tablist,↑/↓ 要走得动:七次 Tab 才能穿过七个槽位不是键盘该付的代价。
  function onSlotsKeydown(event) {
    const state = getState();
    const appearance = (state && state.appearance) || {};
    const choices = orderChoices(Array.isArray(appearance.choices) ? appearance.choices : [], formFor(state));
    if (!choices.length) return;
    const step = event.key === 'ArrowDown' || event.key === 'ArrowRight'
      ? 1
      : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const at = choices.findIndex(choice => choice.group === focusedSlot);
    const next = choices[(Math.max(0, at) + step + choices.length) % choices.length];
    focusSlot(next.group, { moveFocus: true });
  }

  function focusSlot(group, { moveFocus = false } = {}) {
    if (!group || group === focusedSlot) return;
    pendingFocusItem = null;
    focusedSlot = group;
    render(getState());
    if (!moveFocus) return;
    const slots = $('#wardrobeSlots');
    const slot = slots ? slots.querySelector(`.wardrobe-slot[data-group="${group}"]`) : null;
    if (slot) slot.focus();
  }

  function onReset() {
    void command.run(() => surfaceClient.resetAppearance());
  }

  function isOpen() {
    const mask = $('#wardrobeMask');
    return Boolean(mask && !mask.classList.contains('hidden'));
  }

  function open() {
    const mask = $('#wardrobeMask');
    if (!mask) return;
    if (isOpen()) return;
    const owner = ++visit;
    command.nextVisit();
    trigger = document.activeElement;
    lastKey = '';
    render(getState());
    mask.classList.remove('hidden');
    mask.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => {
      if (owner !== visit || !isOpen()) return;
      const first = mask.querySelector('.wardrobe-slot[aria-selected="true"]') || $('#btnWardrobeClose');
      if (first) first.focus();
    });
  }

  function close() {
    const mask = $('#wardrobeMask');
    if (!mask) return;
    visit++;
    stage.cancelGesture();
    command.nextVisit();
    mask.classList.add('hidden');
    mask.setAttribute('aria-hidden', 'true');
    pendingFocusItem = null;
    const closing = trigger;
    trigger = null;
    restoreModalFocus(closing || $('#btnOpenWardrobe'));
  }

  // 点遮罩的空白处关掉,和设置抽屉一致;点抽屉里面不算。
  function onMaskClick(event) {
    if (event.target === $('#wardrobeMask')) close();
  }

  async function reconcile() {
    const owner = visit;
    if (!store?.refresh) return false;
    const snapshot = await store.refresh();
    if (owner !== visit || !store || !snapshot || !Number.isSafeInteger(snapshot.revision)
        || !snapshot.appearance || !Array.isArray(snapshot.appearance.wornIds)) return false;
    render(snapshot);
    return true;
  }

  function mount(projectionStore) {
    if (!projectionStore || typeof projectionStore.subscribe !== 'function') {
      throw new TypeError('wardrobe feature requires a projection store');
    }
    if (unsubscribe) return;
    store = projectionStore;
    command.mount();
    stage.mount();
    if (!bound) {
      bound = true;
      const entry = $('#btnOpenWardrobe');
      if (entry) entry.addEventListener('click', open);
      const closeButton = $('#btnWardrobeClose');
      if (closeButton) closeButton.addEventListener('click', close);
      const mask = $('#wardrobeMask');
      if (mask) mask.addEventListener('click', onMaskClick);
      const options = $('#wardrobeOptions');
      if (options) options.addEventListener('click', onOptionsClick);
      const slots = $('#wardrobeSlots');
      if (slots) {
        slots.addEventListener('click', onSlotsClick);
        slots.addEventListener('keydown', onSlotsKeydown);
      }
      const reset = $('#wardrobeReset');
      if (reset) reset.addEventListener('click', onReset);
    }
    // 换皮肤会改变自动兜底戴哪件,升级会解锁新件,所以这三个边界都要重画。抽屉
    // 关着时也照样走一遍:默认视图上「戴着 N 件」那行字归这一层写。
    unsubscribe = projectionStore.subscribe(change => {
      if (change.localeOnly) { repaintCopy(); return; }
      const dirty = change.dirty || {};
      if (dirty.all || dirty.appearance || dirty.skin || dirty.stats) render(change.state);
    });
  }

  function dispose() {
    visit++;
    command.dispose();
    store = null;
    stage.dispose();
    if (typeof unsubscribe === 'function') unsubscribe();
    unsubscribe = null;
    repaintCopy = () => {};
    if (bound) {
      bound = false;
      const entry = $('#btnOpenWardrobe');
      if (entry) entry.removeEventListener('click', open);
      const closeButton = $('#btnWardrobeClose');
      if (closeButton) closeButton.removeEventListener('click', close);
      const mask = $('#wardrobeMask');
      if (mask) mask.removeEventListener('click', onMaskClick);
      const options = $('#wardrobeOptions');
      if (options) options.removeEventListener('click', onOptionsClick);
      const slots = $('#wardrobeSlots');
      if (slots) {
        slots.removeEventListener('click', onSlotsClick);
        slots.removeEventListener('keydown', onSlotsKeydown);
      }
      const reset = $('#wardrobeReset');
      if (reset) reset.removeEventListener('click', onReset);
    }
  }

  return Object.freeze({ mount, dispose, open, close, isOpen, render });
}


export { createPopoverWardrobeFeature };
