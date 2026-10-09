'use strict';

// 配饰橱窗抽屉。分组、可选项、锁与锁的理由全部由 companion 能力算好后放进
// state.appearance,这一层只做两件事:把它翻译成中文文案,以及把点击翻译成
// 一次 equip 请求。
//
// 这里刻意不保留“本地选中态”:点一下之后界面等主进程把新的 wornIds 送回来再
// 重画。乐观更新会带来一个真实的坏情况——互斥组换件时,旧件已经从界面上消失、
// 新件却因为校验失败没戴上,于是屏幕上是空的而桌宠身上还戴着旧的。
//
// 排布是主从两列:左边七个槽位(各自写着现在戴着什么),右边只画聚焦槽位的选项。
// 之前七组标签平铺着换二十四个按钮,其中四组只有一件——「光环 ［不戴］［小光环］」
// 为一件东西花掉一整行。左列现在还顺便是一张「整套搭配」清单,一眼读完。
import { t, getLocale } from '../../shared/interface/i18n.mjs';
import { forms } from '../../../capabilities/companion/index.mjs';
import { renderWardrobeOutfitPreviews } from './wardrobe-outfit-preview.mjs';

// 能力按组名的字母序返回,那会把「鞋子」排到「光环」前面。展示顺序按从头到脚
// 排,由当前形态的槽位声明给出，而不是在 surface 重写一份角色清单。
function formFor(state) { return forms.resolvePetForm(state?.currentSkin); }

function groupLabel(form, group) {
  return t(form.slotLabels[group] || group);
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
  let bound = false;

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

  // 左列每个槽位都写着现在戴着什么,于是它同时是一张「整套搭配」清单。名字只有
  // 选项里有,choice.selected 只是个 id。
  function wornLabel(choice) {
    if (!choice.selected) return '—';
    const found = choice.options.find(option => option.id === choice.selected);
    return found ? found.label : choice.selected;
  }

  function slotMarkup(form, choice, selected) {
    return '<button type="button" class="wardrobe-slot" role="tab"'
      + ` data-group="${escapeHTML(choice.group)}" aria-selected="${selected ? 'true' : 'false'}"`
      + ` aria-controls="wardrobeOptions" tabindex="${selected ? '0' : '-1'}">`
      + `<span class="slot-name">${escapeHTML(groupLabel(form, choice.group))}</span>`
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
      + `${label}${hint}</button>`;
  }

  function optionsMarkup(state, form, choice) {
    // 「不戴」永远排在最前:互斥组里“脱下来”和“换一件”是同一个动作,把它做成
    // 一个普通选项,用户就不需要再找一个额外的取消按钮。
    const empty = `<button type="button" class="wardrobe-option${choice.selected ? '' : ' selected'}"`
      + ` data-group="${escapeHTML(choice.group)}" data-item=""`
      + ` aria-pressed="${choice.selected ? 'false' : 'true'}"`
      + ` aria-label="${escapeHTML(t('不戴{slot}', { slot: groupLabel(form, choice.group) }))}">${escapeHTML(t('不戴'))}</button>`;
    const options = choice.options.map(option => optionMarkup(state, choice.group, option, choice.selected));
    return empty + options.join('');
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
    if (key === lastKey) return;
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

    const canvas = $('#wardrobePreview');
    if (canvas) {
      drawPetPreview(canvas, { skinId: state.currentSkin || 'pink', itemIds: wornIds, size: 'preview' });
    }
    const repaintOutfits = renderWardrobeOutfitPreviews({ container: $('#wardrobeLooks'), state, formId: form.id, escapeHTML, drawPetPreview });

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
      lastKey = `${getLocale()}|${dataKey}`;
      for (const slot of slots?.querySelectorAll('.wardrobe-slot') || []) {
        const label = slot.querySelector('.slot-name');
        if (label) label.textContent = groupLabel(form, slot.dataset.group);
      }
      const focused = choices.find(choice => choice.group === focusedSlot);
      for (const button of options?.querySelectorAll('.wardrobe-option') || []) {
        const option = focused?.options.find(item => item.id === button.dataset.item);
        if (!option) {
          button.textContent = t('不戴');
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
      const empty = options?.querySelector('.wardrobe-empty');
      if (empty) empty.textContent = t('还没有可搭配的配饰。升级和解锁皮肤都会往这里添件。');
      if (summary) summary.textContent = wornIds.length ? t('正戴着 {count} 件', { count: wornIds.length }) : t('现在什么都没戴');
      if (entryMeta) entryMeta.textContent = wornIds.length ? t('戴着 {count} 件', { count: wornIds.length }) : t('什么都没戴');
      repaintOutfits();
    };

    // 投影回流会把整块选项重画掉,键盘用户的焦点会掉到 body 上。把它还给刚点过
    // 的那颗按钮 —— 连着换两件是常见动作,每次都要重新 Tab 进来是不能接受的。
    if (pendingFocusItem !== null && options) {
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
    if (!button || button.disabled) return;
    const group = button.dataset ? button.dataset.group : '';
    if (!group) return;
    const itemId = button.dataset.item || null;
    if (button.getAttribute('aria-pressed') === 'true') return;
    pendingFocusItem = button.dataset.item;
    surfaceClient.equipAppearance(group, itemId);
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
    focusedSlot = group;
    render(getState());
    if (!moveFocus) return;
    const slots = $('#wardrobeSlots');
    const slot = slots ? slots.querySelector(`.wardrobe-slot[data-group="${group}"]`) : null;
    if (slot) slot.focus();
  }

  function onReset() {
    surfaceClient.resetAppearance();
  }

  function isOpen() {
    const mask = $('#wardrobeMask');
    return Boolean(mask && !mask.classList.contains('hidden'));
  }

  function open() {
    const mask = $('#wardrobeMask');
    if (!mask) return;
    trigger = document.activeElement;
    lastKey = '';
    render(getState());
    mask.classList.remove('hidden');
    mask.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => {
      const first = mask.querySelector('.wardrobe-slot[aria-selected="true"]') || $('#btnWardrobeClose');
      if (first) first.focus();
    });
  }

  function close() {
    const mask = $('#wardrobeMask');
    if (!mask) return;
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

  function mount(projectionStore) {
    if (!projectionStore || typeof projectionStore.subscribe !== 'function') {
      throw new TypeError('wardrobe feature requires a projection store');
    }
    if (unsubscribe) return;
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
