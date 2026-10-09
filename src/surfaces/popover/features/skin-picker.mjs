'use strict';

// 换形态：种类选择 → 该种类的形象网格 → 预览确认。
// selectedFormId 与 previewedSkinId 都是本地状态，只有确认键调用 switchSkin。
// 缩略图仅在清单变化时重画，移动焦点只更新选择状态。
function createPopoverSkinPicker({
  document, $, getState, escapeHTML, surfaceClient, drawPetPreview, skinAccent, restoreModalFocus
} = {}) {
  if (!document || typeof $ !== 'function') {
    throw new TypeError('skin picker requires document and $');
  }
  for (const [name, fn] of Object.entries({
    getState, escapeHTML, drawPetPreview, skinAccent, restoreModalFocus
  })) {
    if (typeof fn !== 'function') throw new TypeError(`skin picker requires ${name}`);
  }
  if (!surfaceClient || typeof surfaceClient.switchSkin !== 'function') {
    throw new TypeError('skin picker requires surfaceClient.switchSkin');
  }

  let previewedSkinId = null;
  let selectedFormId = null;
  let lastSpeciesKey = '';
  let lastStripKey = '';
  let lastFocusKey = '';
  let trigger = null;
  let unsubscribe = null;
  let bound = false;

  function skinList(state) {
    return state && Array.isArray(state.skins) ? state.skins : [];
  }

  function findSkin(state, id) {
    return skinList(state).find(skin => skin.id === id) || null;
  }

  function formSkins(state) {
    return skinList(state).filter(skin => (skin.formId || 'dango') === selectedFormId);
  }

  function renderSpecies(state) {
    const root = $('#skinSpecies');
    if (!root) return;
    const groups = new Map();
    for (const skin of skinList(state)) {
      const id = skin.formId || 'dango';
      if (!groups.has(id)) groups.set(id, { name: skin.formName || '团子兽', skin: skin.id, count: 0 });
      if (skin.unlocked) groups.get(id).count += 1;
    }
    const key = JSON.stringify([...groups]) + selectedFormId;
    if (key === lastSpeciesKey) return;
    lastSpeciesKey = key;
    root.innerHTML = [...groups].map(([id, group]) => `<button type="button" class="skin-species-option" data-form="${escapeHTML(id)}" aria-pressed="${id === selectedFormId}"><canvas data-skin="${escapeHTML(group.skin)}"></canvas><span>${escapeHTML(group.name)}</span><small>已解锁 ${group.count}</small></button>`).join('');
    for (const canvas of root.querySelectorAll('canvas')) drawPetPreview(canvas, { skinId: canvas.dataset.skin, size: 'thumb' });
  }

  function onSpeciesClick(event) {
    const button = event.target?.closest?.('[data-form]');
    if (!button || button.dataset.form === selectedFormId) return;
    const state = getState();
    const skins = skinList(state).filter(skin => (skin.formId || 'dango') === button.dataset.form);
    if (!skins.length) return;
    selectedFormId = button.dataset.form;
    previewedSkinId = (skins.find(s => s.current) || skins.find(s => s.unlocked) || skins[0]).id;
    render(state);
  }

  // 胶片带的缩略图只画形态本身,不叠配饰:十个格子要比的是「换成这只长什么样」,
  // 每只都戴着同一顶草帽只会让它们更难分辨。
  function renderStrip(state) {
    const strip = $('#skinStrip');
    if (!strip) return;
    const skins = formSkins(state);
    const key = skins.map(skin => `${skin.id}:${skin.unlocked ? 1 : 0}:${skin.current ? 1 : 0}`).join(',');
    if (key === lastStripKey) {
      syncStripSelection();
      return;
    }
    lastStripKey = key;

    strip.innerHTML = skins.map(skin => {
      const classes = ['skin-thumb'];
      if (!skin.unlocked) classes.push('locked');
      if (skin.current) classes.push('current');
      const label = skin.unlocked
        ? `${skin.name}${skin.current ? '，当前形态' : ''}`
        : `${skin.name}，未解锁`;
      return `<button type="button" class="${classes.join(' ')}" role="option"`
        + ` data-skin="${escapeHTML(skin.id)}" aria-selected="false" tabindex="-1"`
        + ` aria-label="${escapeHTML(label)}"><canvas></canvas>`
        + `<span class="skin-thumb-name">${escapeHTML(skin.name)}</span><small>${skin.unlockLevel ? `Lv.${skin.unlockLevel}` : '成就解锁'} · ${skin.unlocked ? '已解锁' : '未解锁'}</small>`
        + '</button>';
    }).join('');

    for (const thumb of strip.querySelectorAll('.skin-thumb')) {
      const canvas = thumb.querySelector('canvas');
      if (canvas) drawPetPreview(canvas, { skinId: thumb.dataset.skin, size: 'thumb' });
    }
    syncStripSelection();
  }

  // roving tabindex:胶片带只有一个可 Tab 到的格子,其余靠 ←/→ 走。十个格子各占
  // 一次 Tab 停留会把「离开这条带子」变成十次按键。
  function syncStripSelection() {
    const strip = $('#skinStrip');
    if (!strip) return;
    for (const thumb of strip.querySelectorAll('.skin-thumb')) {
      const selected = thumb.dataset.skin === previewedSkinId;
      thumb.setAttribute('aria-selected', selected ? 'true' : 'false');
      thumb.tabIndex = selected ? 0 : -1;
    }
  }

  function renderFocus(state) {
    const focus = $('#skinFocus');
    if (!focus) return;
    const skin = findSkin(state, previewedSkinId);
    if (!skin) {
      focus.innerHTML = '<p class="skin-focus-desc">还没有可选的形态。</p>';
      lastFocusKey = '';
      return;
    }
    const bySkin = state && state.appearance && state.appearance.wornIdsBySkin;
    const wornIds = Array.isArray(bySkin?.[skin.id])
      ? bySkin[skin.id]
      : Array.isArray(state?.appearance?.wornIds) ? state.appearance.wornIds : [];
    const key = `${skin.id}:${skin.unlocked ? 1 : 0}:${skin.current ? 1 : 0}`
      + `:${skin.progress ? skin.progress.current : '-'}:${wornIds.join('+')}`;
    if (key === lastFocusKey) return;
    lastFocusKey = key;

    const progressText = skin.progress ? `当前 ${skin.progress.current}/${skin.progress.target}` : '';
    const progressPercent = skin.progress && skin.progress.target > 0
      ? Math.min(100, Math.round((skin.progress.current / skin.progress.target) * 100))
      : 0;
    // 三种确认键的样子对应三种事实,一句话说清为什么按不下去,而不是只灰掉。
    const apply = skin.current
      ? { text: '当前形态', disabled: true }
      : skin.unlocked
        ? { text: '换成这个形态', disabled: false }
        : { text: `未解锁 · ${skin.unlockDesc}`, disabled: true };

    focus.innerHTML = `
      <div class="skin-focus-art"><canvas></canvas></div>
      <div class="skin-focus-name">${escapeHTML(skin.name)}</div>
      <p class="skin-focus-desc">${escapeHTML(skin.unlockDesc)}</p>
      ${skin.progress ? `<div class="skin-progress-outer" aria-hidden="true"><div class="skin-progress-inner" style="width:${progressPercent}%"></div></div><p class="skin-progress-text">${escapeHTML(progressText)}</p>` : ''}
      <button type="button" class="skin-apply" id="btnSkinApply" data-skin="${escapeHTML(skin.id)}"${apply.disabled ? ' disabled' : ''}>${escapeHTML(apply.text)}</button>
    `;

    // 聚焦卡的描边取该形态自己的颜色 —— 这是换形态在确认之前唯一被允许改的颜色。
    // documentElement 上的主题色由 applyTheme 拥有,要等 switchSkin 成功才轮到它变。
    const accent = skinAccent(skin.id);
    focus.style.setProperty('--focus-primary', accent.primary);
    focus.style.setProperty('--focus-accent', accent.accent);

    // 大图带上目标形态自己的已保存搭配，跨形态不借用旧身体的装饰。
    const canvas = focus.querySelector('canvas');
    if (canvas) drawPetPreview(canvas, { skinId: skin.id, itemIds: wornIds, size: 'preview' });
  }

  function render(state) {
    if (!state) return;
    if (!previewedSkinId || !findSkin(state, previewedSkinId)) {
      previewedSkinId = state.currentSkin || (skinList(state)[0] || {}).id || null;
      selectedFormId = findSkin(state, previewedSkinId)?.formId || 'dango';
    }
    renderSpecies(state);
    renderStrip(state);
    renderFocus(state);
  }

  function focusSkin(state, skinId, { moveFocus = false } = {}) {
    if (!skinId || skinId === previewedSkinId) return;
    previewedSkinId = skinId;
    syncStripSelection();
    renderFocus(state);
    if (!moveFocus) return;
    const strip = $('#skinStrip');
    const thumb = strip ? strip.querySelector(`.skin-thumb[data-skin="${skinId}"]`) : null;
    if (thumb) thumb.focus();
  }

  // 一个委托监听器管十个格子,重画胶片带时不用重新绑。
  function onStripClick(event) {
    const thumb = event.target && typeof event.target.closest === 'function'
      ? event.target.closest('.skin-thumb')
      : null;
    if (!thumb || !thumb.dataset) return;
    // 锁住的形态照样能聚焦:看不到大图和解锁进度,就没有解锁的动力。
    focusSkin(getState(), thumb.dataset.skin);
  }

  function onStripKeydown(event) {
    const state = getState();
    const skins = formSkins(state);
    if (!skins.length) return;
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown'
      ? 1
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (step) {
      event.preventDefault();
      const at = skins.findIndex(skin => skin.id === previewedSkinId);
      const next = skins[(Math.max(0, at) + step + skins.length) % skins.length];
      focusSkin(state, next.id, { moveFocus: true });
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      focusSkin(state, skins[event.key === 'Home' ? 0 : skins.length - 1].id, { moveFocus: true });
    }
  }

  // 确认是整个抽屉唯一一次写动作。成功之后不做乐观更新:投影回流会把 current
  // 换过来,按钮随之变成「当前形态」,App 主题色也在那一刻才变 —— 那就是回报。
  function onFocusClick(event) {
    const button = event.target && typeof event.target.closest === 'function'
      ? event.target.closest('#btnSkinApply')
      : null;
    if (!button || button.disabled) return;
    const skinId = button.dataset ? button.dataset.skin : '';
    if (skinId) surfaceClient.switchSkin(skinId);
  }

  function isOpen() {
    const mask = $('#skinMask');
    return Boolean(mask && !mask.classList.contains('hidden'));
  }

  function open() {
    const mask = $('#skinMask');
    if (!mask) return;
    trigger = document.activeElement;
    // 每次打开都从当前形态起步:上一次试穿到一半就关掉的那只不该留在这里。
    previewedSkinId = null;
    lastFocusKey = '';
    render(getState());
    mask.classList.remove('hidden');
    mask.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => {
      const first = mask.querySelector('#btnSkinApply:not([disabled])')
        || mask.querySelector('.skin-thumb[aria-selected="true"]')
        || $('#btnSkinClose');
      if (first) first.focus();
    });
  }

  function close() {
    const mask = $('#skinMask');
    if (!mask) return;
    mask.classList.add('hidden');
    mask.setAttribute('aria-hidden', 'true');
    const closing = trigger;
    trigger = null;
    restoreModalFocus(closing || $('#btnOpenSkins'));
  }

  function mount(projectionStore) {
    if (!projectionStore || typeof projectionStore.subscribe !== 'function') {
      throw new TypeError('skin picker requires a projection store');
    }
    if (unsubscribe) return;
    if (!bound) {
      bound = true;
      const entry = $('#btnOpenSkins');
      if (entry) entry.addEventListener('click', open);
      const closeButton = $('#btnSkinClose');
      if (closeButton) closeButton.addEventListener('click', close);
      const mask = $('#skinMask');
      if (mask) mask.addEventListener('click', onMaskClick);
      const strip = $('#skinStrip');
      if (strip) {
        strip.addEventListener('click', onStripClick);
        strip.addEventListener('keydown', onStripKeydown);
      }
      const focus = $('#skinFocus');
      if (focus) focus.addEventListener('click', onFocusClick);
      $('#skinSpecies')?.addEventListener('click', onSpeciesClick);
    }
    // 关着的时候不画:抽屉里那 11 张画布的栅格化没有理由跟着每次升级跑一遍。
    // 换皮肤改 current、升级与连续天数改解锁进度,换装改大图上戴着什么。
    unsubscribe = projectionStore.subscribe(change => {
      if (!isOpen()) return;
      const dirty = change.dirty || {};
      if (dirty.all || dirty.skin || dirty.stats || dirty.tasks || dirty.appearance) {
        render(change.state);
      }
    });
  }

  // 点遮罩的空白处关掉,和设置抽屉一致;点抽屉里面不算。
  function onMaskClick(event) {
    if (event.target === $('#skinMask')) close();
  }

  function dispose() {
    if (typeof unsubscribe === 'function') unsubscribe();
    unsubscribe = null;
    if (bound) {
      bound = false;
      const entry = $('#btnOpenSkins');
      if (entry) entry.removeEventListener('click', open);
      const closeButton = $('#btnSkinClose');
      if (closeButton) closeButton.removeEventListener('click', close);
      const mask = $('#skinMask');
      if (mask) mask.removeEventListener('click', onMaskClick);
      const strip = $('#skinStrip');
      if (strip) {
        strip.removeEventListener('click', onStripClick);
        strip.removeEventListener('keydown', onStripKeydown);
      }
      const focus = $('#skinFocus');
      if (focus) focus.removeEventListener('click', onFocusClick);
      $('#skinSpecies')?.removeEventListener('click', onSpeciesClick);
    }
  }

  return Object.freeze({ mount, dispose, open, close, isOpen, render });
}


export { createPopoverSkinPicker };
