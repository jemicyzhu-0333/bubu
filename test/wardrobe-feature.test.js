'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createPopoverWardrobeFeature } = require('../src/surfaces/popover/features/wardrobe.mjs');
const { companion } = require('../src/capabilities');
const { PET_APPEARANCE_ITEMS } = require('../src/pet-content');

const ROOT = path.resolve(__dirname, '..');

// The drawer focuses its first slot on the next frame, the same way every other
// popover overlay does. Running the callback inline is enough to observe it.
globalThis.requestAnimationFrame = callback => { callback(); return 0; };

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

// The feature only ever touches innerHTML, textContent, classList, one attribute
// and a handful of listeners, so a literal stub observes everything it decides.
// Listeners are keyed by selector *and* type because the slot column carries both
// a click and a keydown handler.
function createDom() {
  const listeners = new Map();
  const element = selector => {
    const node = {
      selector,
      innerHTML: '',
      textContent: '',
      focused: 0,
      classList: {
        names: new Set(['hidden']),
        add(name) { this.names.add(name); },
        remove(name) { this.names.delete(name); },
        contains(name) { return this.names.has(name); }
      },
      attributes: {},
      setAttribute(name, value) { node.attributes[name] = value; },
      querySelector: () => null,
      focus() { node.focused += 1; },
      addEventListener(type, handler) { listeners.set(`${selector}:${type}`, handler); },
      removeEventListener(type) { listeners.delete(`${selector}:${type}`); }
    };
    return node;
  };
  const nodes = {};
  for (const selector of ['#wardrobeMask', '#wardrobeDrawer', '#btnWardrobeClose', '#btnOpenWardrobe',
    '#wardrobeSlots', '#wardrobeOptions', '#wardrobePreview', '#wardrobeSummary', '#wardrobeReset',
    '#wardrobeEntryMeta', '#wardrobeLooks']) {
    nodes[selector] = element(selector);
  }
  const $ = selector => nodes[selector] || null;
  const fire = (selector, type, event = {}) => {
    const handler = listeners.get(`${selector}:${type}`);
    assert.ok(handler, `${selector} must listen for ${type}`);
    handler(event);
  };
  return { nodes, listeners, $, fire, document: { activeElement: null } };
}

function createHarness({ level = 20, unlockedSkins = ['pink'], currentSkin = 'pink', equipped = {} } = {}) {
  const dom = createDom();
  const selection = companion.appearanceSelection.selectAppearance({
    items: PET_APPEARANCE_ITEMS, level, unlockedSkins, currentSkin, equipped
  });
  const state = {
    currentSkin,
    skins: [{ id: 'pink', name: '粉桃' }, { id: 'mint', name: '薄荷' }, { id: 'forest', name: '森林' }],
    appearance: { choices: selection.choices, wornIds: selection.worn.map(item => item.id) }
  };
  const equips = [];
  const previews = [];
  const restored = [];
  const feature = createPopoverWardrobeFeature({
    document: dom.document,
    getState: () => state,
    $: dom.$,
    escapeHTML,
    surfaceClient: {
      equipAppearance: (group, itemId) => { equips.push([group, itemId]); return { ok: true }; },
      resetAppearance: () => { equips.push(['reset', null]); return { ok: true }; }
    },
    drawPetPreview: (canvas, options) => previews.push(options),
    restoreModalFocus: target => restored.push(target)
  });
  let subscriber;
  const store = { subscribe: callback => { subscriber = callback; return () => undefined; } };
  feature.mount(store);
  feature.render();
  return {
    dom, feature, state, equips, previews, restored, selection,
    publish: change => subscriber(change),
    slots: () => dom.nodes['#wardrobeSlots'].innerHTML,
    options: () => dom.nodes['#wardrobeOptions'].innerHTML,
    focusSlot: group => dom.fire('#wardrobeSlots', 'click', {
      target: { closest: () => ({ dataset: { group } }) }
    })
  };
}

test('the wardrobe requires its scoped dependencies and a projection store', () => {
  assert.throws(() => createPopoverWardrobeFeature(), /requires document and \$/);
  assert.throws(() => createPopoverWardrobeFeature({
    document: {}, getState: () => ({}), $: () => null, escapeHTML, surfaceClient: {}
  }), /requires drawPetPreview/);
  assert.throws(() => createPopoverWardrobeFeature({
    document: {}, getState: () => ({}), $: () => null, escapeHTML,
    drawPetPreview: () => undefined, restoreModalFocus: () => undefined, surfaceClient: {}
  }), /requires surfaceClient/);
  const feature = createPopoverWardrobeFeature({
    document: {}, getState: () => ({}), $: () => null, escapeHTML,
    drawPetPreview: () => undefined, restoreModalFocus: () => undefined,
    surfaceClient: { equipAppearance() {}, resetAppearance() {} }
  });
  assert.equal(Object.isFrozen(feature), true);
  assert.throws(() => feature.mount({}), /projection store/);
});

test('mounting twice subscribes once so a re-shown tab cannot double-render', () => {
  const dom = createDom();
  let subscribers = 0;
  const feature = createPopoverWardrobeFeature({
    document: dom.document,
    getState: () => ({ currentSkin: 'pink', appearance: { choices: [], wornIds: [] } }),
    $: dom.$, escapeHTML, surfaceClient: { equipAppearance() {}, resetAppearance() {} },
    drawPetPreview: () => undefined, restoreModalFocus: () => undefined
  });
  const store = { subscribe: () => { subscribers += 1; return () => { subscribers -= 1; }; } };
  feature.mount(store);
  feature.mount(store);
  assert.equal(subscribers, 1);
  feature.dispose();
  assert.equal(subscribers, 0);
});

test('slots are listed head to toe rather than in the alphabetical order the capability returns', () => {
  const harness = createHarness({ unlockedSkins: ['pink', 'mint', 'forest'] });
  const order = [...harness.slots().matchAll(/data-group="([^"]+)"/g)].map(match => match[1]);
  // The capability sorts by group name, which would put 鞋子 ahead of 光环.
  assert.notDeepEqual(order, [...order].sort());
  assert.deepEqual(order, ['headwear', 'head-accent', 'head-aura', 'neckwear', 'backwear', 'sidebag', 'footwear']);
  assert.match(harness.slots(), /<span class="slot-name">头饰<\/span>/);
});

test('another pet uses its own ordered, named slots without leaking the original wardrobe', () => {
  const harness = createHarness({ currentSkin: 'usagi', level: 1, unlockedSkins: ['pink'] });
  const slots = harness.slots();
  assert.deepEqual([...slots.matchAll(/data-group="([^"]+)"/g)].map(match => match[1]),
    ['usagi.headwear', 'usagi.earwear', 'usagi.aura', 'usagi.neckwear',
      'usagi.backwear', 'usagi.sidebag', 'usagi.footwear']);
  assert.match(slots, /<span class="slot-name">耳饰<\/span>/);
  assert.match(slots, /<span class="slot-name">背饰<\/span>/);
  assert.doesNotMatch(slots, /data-group="(?:headwear|sidebag|footwear)"/);
  harness.focusSlot('usagi.backwear');
  assert.match(harness.options(), /不戴长耳披风/);
  assert.deepEqual(harness.previews.at(-1).itemIds.sort(),
    ['usagi.ear-bow', 'usagi.star-collar', 'usagi.travel-cape'].sort());
});

test('each slot says what is on it, so the left column doubles as the whole outfit', () => {
  const harness = createHarness({ level: 20 });
  assert.match(harness.slots(), /<span class="slot-name">头饰<\/span><span class="slot-worn">小草帽<\/span>/);
  // An empty slot reads as a dash rather than as a missing line. 发饰 is empty at any
  // level because every item in it belongs to a skin this harness has not unlocked.
  assert.match(harness.slots(), /<span class="slot-name">发饰<\/span><span class="slot-worn">—<\/span>/);
});

test('only the focused slot renders options, and the first slot is focused by default', () => {
  const harness = createHarness({ level: 20 });
  assert.match(harness.slots(), /data-group="headwear" aria-selected="true"/);
  assert.match(harness.options(), /data-item="milestone.sunhat"/);
  assert.doesNotMatch(harness.options(), /data-item="milestone.scarf"/);

  harness.focusSlot('neckwear');
  assert.match(harness.slots(), /data-group="neckwear" aria-selected="true"/);
  assert.match(harness.options(), /data-item="milestone.scarf"/);
  assert.doesNotMatch(harness.options(), /data-item="milestone.sunhat"/);
});

test('every slot offers taking the item off, and that is what is pressed when nothing is worn', () => {
  const harness = createHarness({ level: 1 });
  const groups = [...harness.slots().matchAll(/data-group="([^"]+)"/g)].map(match => match[1]);
  assert.ok(groups.length >= 4);
  for (const group of groups) {
    harness.focusSlot(group);
    const empty = new RegExp(`data-group="${group}" data-item=""[^>]*aria-pressed="true"`);
    assert.match(harness.options(), empty, `${group} must offer an empty slot`);
  }
  assert.equal(harness.dom.nodes['#wardrobeSummary'].textContent, '现在什么都没戴');
  assert.equal(harness.dom.nodes['#wardrobeEntryMeta'].textContent, '什么都没戴');
  assert.deepEqual(harness.previews.at(-1), { skinId: 'pink', itemIds: [], size: 'preview' });
});

test('the worn count on the default view is written here, so the two places cannot disagree', () => {
  const harness = createHarness({ level: 20 });
  const worn = harness.state.appearance.wornIds.length;
  assert.ok(worn > 0);
  assert.equal(harness.dom.nodes['#wardrobeEntryMeta'].textContent, `戴着 ${worn} 件`);
  assert.equal(harness.dom.nodes['#wardrobeSummary'].textContent, `正戴着 ${worn} 件`);
});

test('locked options say why they are locked and cannot be clicked', () => {
  const harness = createHarness({ level: 1, unlockedSkins: ['pink'] });
  // A level lock quotes the level; a skin lock names the skin the item belongs to.
  assert.match(harness.options(), /小芽<\/span><span class="wardrobe-lock" data-icon="lock">Lv\.3<\/span>/);
  assert.match(harness.options(), /data-item="milestone.sprout"[^>]*disabled/);
  harness.focusSlot('head-accent');
  assert.match(harness.options(), /森林叶片<\/span><span class="wardrobe-lock" data-icon="lock">森林专属<\/span>/);

  const button = {
    disabled: true,
    dataset: { group: 'headwear', item: 'milestone.sprout' },
    getAttribute: () => 'false'
  };
  button.closest = () => button;
  harness.dom.fire('#wardrobeOptions', 'click', { target: button });
  assert.deepEqual(harness.equips, []);
});

test('picking an unlocked item asks the main process to equip it and re-picking it asks nothing', async () => {
  const harness = createHarness({ level: 20 });
  const worn = harness.state.appearance.wornIds;
  assert.ok(worn.includes('milestone.sunhat'), 'level 20 should already wear the hat by default');

  const press = (group, item, pressed) => {
    const button = { disabled: false, dataset: { group, item }, getAttribute: () => (pressed ? 'true' : 'false') };
    button.closest = () => button;
    harness.dom.fire('#wardrobeOptions', 'click', { target: button });
  };
  press('headwear', 'milestone.sprout', false);
  await new Promise(resolve => setImmediate(resolve));
  // 不戴 is a normal option, so taking something off travels the same path as swapping.
  press('headwear', '', false);
  await new Promise(resolve => setImmediate(resolve));
  press('headwear', 'milestone.sunhat', true);
  assert.deepEqual(harness.equips, [['headwear', 'milestone.sprout'], ['headwear', null]]);

  harness.dom.fire('#wardrobeReset', 'click', {});
  assert.deepEqual(harness.equips.at(-1), ['reset', null]);
});

test('arrow keys walk the slot column instead of forcing seven tab stops', () => {
  const harness = createHarness({ level: 20 });
  harness.dom.fire('#wardrobeSlots', 'keydown', { key: 'ArrowDown', preventDefault() {} });
  assert.match(harness.slots(), /data-group="head-accent" aria-selected="true"/);
  // Walking off the top wraps to the last slot rather than sticking.
  harness.dom.fire('#wardrobeSlots', 'keydown', { key: 'ArrowUp', preventDefault() {} });
  harness.dom.fire('#wardrobeSlots', 'keydown', { key: 'ArrowUp', preventDefault() {} });
  assert.match(harness.slots(), /data-group="footwear" aria-selected="true"/);
});

test('the drawer opens and closes without ever touching the theme, and hands focus back', () => {
  const harness = createHarness({ level: 20 });
  assert.equal(harness.feature.isOpen(), false);
  harness.dom.document.activeElement = harness.dom.nodes['#btnOpenWardrobe'];
  harness.dom.fire('#btnOpenWardrobe', 'click', {});
  assert.equal(harness.feature.isOpen(), true);
  assert.equal(harness.dom.nodes['#wardrobeMask'].attributes['aria-hidden'], 'false');
  assert.ok(harness.dom.nodes['#btnWardrobeClose'].focused >= 1);

  // Clicking the drawer body must not dismiss it; only the mask's own blank area does.
  harness.dom.fire('#wardrobeMask', 'click', { target: harness.dom.nodes['#wardrobeDrawer'] });
  assert.equal(harness.feature.isOpen(), true);
  harness.dom.fire('#wardrobeMask', 'click', { target: harness.dom.nodes['#wardrobeMask'] });
  assert.equal(harness.feature.isOpen(), false);
  assert.equal(harness.dom.nodes['#wardrobeMask'].attributes['aria-hidden'], 'true');
  assert.deepEqual(harness.restored, [harness.dom.nodes['#btnOpenWardrobe']]);
});

test('the preview follows the projection instead of a local guess, and repaints are skipped when nothing moved', () => {
  const harness = createHarness({ level: 20, currentSkin: 'mint', unlockedSkins: ['pink', 'mint'] });
  assert.deepEqual(harness.previews.at(-1).itemIds, harness.state.appearance.wornIds);
  assert.equal(harness.previews.at(-1).skinId, 'mint');
  const painted = harness.previews.length;
  harness.feature.render();
  assert.equal(harness.previews.length, painted, 'an unchanged projection must not repaint');
  harness.state.appearance = { choices: harness.state.appearance.choices, wornIds: [] };
  harness.feature.render();
  assert.equal(harness.previews.length, painted + 1);
});

test('an empty catalog says so instead of rendering an empty box, and dispose drops every listener', () => {
  const dom = createDom();
  const feature = createPopoverWardrobeFeature({
    document: dom.document,
    getState: () => ({ currentSkin: 'pink', appearance: { choices: [], wornIds: [] } }),
    $: dom.$, escapeHTML, surfaceClient: { equipAppearance() {}, resetAppearance() {} },
    drawPetPreview: () => undefined, restoreModalFocus: () => undefined
  });
  feature.mount({ subscribe: () => () => undefined });
  feature.render();
  assert.match(dom.nodes['#wardrobeOptions'].innerHTML, /wardrobe-empty/);
  assert.equal(dom.nodes['#wardrobeSlots'].innerHTML, '');
  assert.equal(dom.listeners.size, 7);
  feature.dispose();
  assert.equal(dom.listeners.size, 0);
});

test('the ids the wardrobe reaches for exist in the popover markup', () => {
  const html = fs.readFileSync(path.join(ROOT, 'src/renderer/popover.html'), 'utf8');
  const source = fs.readFileSync(path.join(ROOT, 'src/surfaces/popover/features/wardrobe.mjs'), 'utf8');
  const ids = [...new Set([...source.matchAll(/\$\('#([A-Za-z]+)'\)/g)].map(match => match[1]))];
  assert.ok(ids.length >= 4);
  for (const id of ids) {
    assert.match(html, new RegExp(`id="${id}"`), `#${id} must exist in popover.html`);
  }
});

test('closing the wardrobe before its opening frame never focuses hidden controls', () => {
  const previous = globalThis.requestAnimationFrame;
  const frames = [];
  globalThis.requestAnimationFrame = callback => { frames.push(callback); return frames.length; };
  try {
    const h = createHarness();
    h.feature.open(); h.feature.close();
    const before = h.dom.nodes['#btnWardrobeClose'].focused;
    frames.forEach(callback => callback());
    assert.equal(h.dom.nodes['#btnWardrobeClose'].focused, before);
    h.feature.dispose();
  } finally { globalThis.requestAnimationFrame = previous; }
});


test('focused accessories have passive single-piece previews and unchanged renders are cached', () => {
  const harness = createHarness({ level: 1 });
  const targets = new Map();
  harness.dom.nodes['#wardrobeOptions'].querySelector = selector => {
    const id = selector.match(/data-item-preview="([^"]+)"/)?.[1];
    if (!id) return null;
    if (!targets.has(id)) targets.set(id, {});
    return targets.get(id);
  };
  harness.focusSlot('neckwear');
  const focused = harness.state.appearance.choices.find(choice => choice.group === 'neckwear');
  assert.deepEqual([...targets.keys()], focused.options.map(item => item.id));
  for (const option of focused.options) {
    assert.ok(harness.previews.some(preview => preview.itemIds.length === 1 && preview.itemIds[0] === option.id));
  }
  const count = harness.previews.length;
  harness.feature.render();
  assert.equal(harness.previews.length, count, 'unchanged state must not repaint canvases');
  assert.deepEqual(harness.equips, [], 'previews never equip even locked items');
  assert.match(harness.options(), /class="wardrobe-item-name"/);
});


test('a failed optional thumbnail cannot suppress canonical controls and is retried', () => {
  const dom = createDom();
  const selection = companion.appearanceSelection.selectAppearance({ items: PET_APPEARANCE_ITEMS,
    level: 1, unlockedSkins: ['pink'], currentSkin: 'pink', equipped: {} });
  const state = { currentSkin: 'pink', appearance: { choices: selection.choices, wornIds: [] } };
  let attempts = 0, listener;
  dom.nodes['#wardrobeSlots'].querySelectorAll = () => [];
  dom.nodes['#wardrobeOptions'].querySelectorAll = () => [];
  const target = {};
  dom.nodes['#wardrobeOptions'].querySelector = selector => selector.includes('data-item-preview') ? target : null;
  const feature = createPopoverWardrobeFeature({ document: dom.document, $: dom.$, getState: () => state,
    escapeHTML, surfaceClient: { equipAppearance() {}, resetAppearance() {} }, restoreModalFocus() {},
    drawPetPreview: canvas => { if (canvas === target && ++attempts === 1) throw new Error('paint failed'); } });
  feature.mount({ subscribe: callback => { listener = callback; return () => {}; } });
  assert.doesNotThrow(() => feature.render());
  assert.equal(dom.nodes['#wardrobeSummary'].textContent, '现在什么都没戴');
  assert.match(dom.nodes['#wardrobeOptions'].innerHTML, /aria-pressed="true"/);
  const before = attempts;
  listener({ localeOnly: true, state, dirty: { all: true } });
  feature.render();
  assert.ok(attempts > before, 'same projection retries failed optional art');
  feature.dispose();
});


test('uncertain wardrobe writes stay locked until a fresh canonical projection is rendered', async () => {
  const dom = createDom();
  let state = { revision: 1, currentSkin: 'pink', appearance: { choices: [], wornIds: [] } };
  let reads = 0, writes = 0, resolveRead;
  const previews = [];
  const feature = createPopoverWardrobeFeature({ document: dom.document, $: dom.$, getState: () => state,
    escapeHTML, restoreModalFocus() {}, drawPetPreview: (canvas, options) => previews.push(options),
    surfaceClient: { equipAppearance() {}, resetAppearance() { writes++; throw new Error('lost receipt'); } } });
  feature.mount({ subscribe: () => () => {}, refresh: async () => {
    reads++; state = await new Promise(resolve => { resolveRead = resolve; }); return state;
  } });
  feature.open(); dom.fire('#wardrobeReset', 'click');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reads, 1); assert.equal(dom.nodes['#wardrobeReset'].disabled, true);
  dom.fire('#wardrobeReset', 'click'); assert.equal(writes, 1, 'uncertainty never retries a write');
  resolveRead({ revision: 2, currentSkin: 'pink', appearance: { choices: [], wornIds: ['canonical'] } });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(previews.at(-1).itemIds, ['canonical']);
  assert.equal(dom.nodes['#wardrobeReset'].disabled, false);
  feature.dispose();
});

test('late canonical refresh cannot repaint a disposed wardrobe visit', async () => {
  const dom = createDom();
  const state = { revision: 1, currentSkin: 'pink', appearance: { choices: [], wornIds: [] } };
  let resolveRead;
  const previews = [];
  const feature = createPopoverWardrobeFeature({ document: dom.document, $: dom.$, getState: () => state,
    escapeHTML, restoreModalFocus() {}, drawPetPreview: (canvas, options) => previews.push(options),
    surfaceClient: { equipAppearance() {}, resetAppearance() { throw new Error('lost receipt'); } } });
  feature.mount({ subscribe: () => () => {}, refresh: () => new Promise(resolve => { resolveRead = resolve; }) });
  feature.open(); dom.fire('#wardrobeReset', 'click'); await new Promise(resolve => setImmediate(resolve));
  feature.dispose(); const count = previews.length;
  resolveRead({ revision: 2, currentSkin: 'usagi', appearance: { choices: [], wornIds: ['late'] } });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(previews.length, count);
});


test('confirmed outfit projection synchronizes every custom slot, selected card, and main model', () => {
  const { USAGI_OUTFIT_SETS } = require('../src/content/companion/usagi-wardrobe.mjs');
  const harness = createHarness({ currentSkin: 'usagi', level: 25 });
  const look = USAGI_OUTFIT_SETS[0];
  const before = harness.slots();
  const equipped = Object.fromEntries(harness.state.appearance.choices.map(choice => [choice.group, null]));
  for (const choice of harness.state.appearance.choices) {
    const item = choice.options.find(option => look.itemIds.includes(option.id));
    if (item) equipped[choice.group] = item.id;
  }
  const projection = companion.appearanceSelection.selectAppearance({ items: PET_APPEARANCE_ITEMS,
    level: 25, unlockedSkins: ['pink'], currentSkin: 'usagi', equipped });
  assert.equal(harness.slots(), before, 'preparing a preview never changes custom controls');
  harness.state.appearance = { choices: projection.choices, wornIds: projection.worn.map(item => item.id) };
  harness.publish({ state: harness.state, dirty: { appearance: true } });
  for (const choice of projection.choices) {
    harness.focusSlot(choice.group);
    const expectedId = equipped[choice.group] || '';
    assert.match(harness.options(), new RegExp(`data-item="${expectedId.replace(/\./g, '\\.')}"[^>]*aria-pressed="true"`));
    const name = choice.options.find(item => item.id === expectedId)?.label || '—';
    assert.ok(harness.slots().includes(`<span class="slot-worn">${name}</span>`));
  }
  assert.deepEqual([...harness.previews.at(-1).itemIds].sort(), [...look.itemIds].sort());
  assert.deepEqual(harness.equips, [], 'projection subscription never chains single-piece writes');
});
