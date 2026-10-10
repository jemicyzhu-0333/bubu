'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createPopoverSkinPicker } = require('../src/surfaces/popover/features/skin-picker.mjs');

const ROOT = path.resolve(__dirname, '..');

globalThis.requestAnimationFrame = callback => { callback(); return 0; };

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

// Literal stub (this repo has no jsdom). The picker writes markup and then queries
// its own children back out to paint them, so the stub answers queries by reading
// the innerHTML it was just handed — that is enough to observe which canvas got
// which skin. Setting innerHTML drops the children, exactly as a real one does.
// Listeners are keyed by selector *and* type because the filmstrip carries both a
// click and a keydown handler.
function createDom() {
  const listeners = new Map();
  const element = selector => {
    let html = '';
    const thumbs = new Map();
    const canvas = { of: selector };
    const thumb = (skinId, classes) => {
      if (!thumbs.has(skinId)) {
        const item = {
          dataset: { skin: skinId }, className: classes, tabIndex: -1, attributes: {}, focused: 0,
          canvas: { of: `${selector} ${skinId}` },
          setAttribute(name, value) { item.attributes[name] = value; },
          getAttribute(name) { return item.attributes[name]; },
          querySelector: query => (query === 'canvas' ? item.canvas : null),
          focus() { item.focused += 1; }
        };
        thumbs.set(skinId, item);
      }
      return thumbs.get(skinId);
    };
    const node = {
      selector,
      focused: 0,
      dataset: {},
      tabIndex: -1,
      attributes: {},
      classList: {
        names: new Set(['hidden']),
        add(name) { this.names.add(name); },
        remove(name) { this.names.delete(name); },
        contains(name) { return this.names.has(name); }
      },
      style: { properties: {}, setProperty(name, value) { node.style.properties[name] = value; } },
      get innerHTML() { return html; },
      set innerHTML(value) { html = value; thumbs.clear(); },
      setAttribute(name, value) { node.attributes[name] = value; },
      getAttribute(name) { return node.attributes[name]; },
      querySelectorAll(query) {
        if (!query.startsWith('.skin-thumb')) return [];
        return [...html.matchAll(/class="(skin-thumb[^"]*)"[^>]*data-skin="([^"]+)"/g)]
          .map(match => thumb(match[2], match[1]));
      },
      querySelector(query) {
        if (query === 'canvas') return html.includes('<canvas>') ? canvas : null;
        const wanted = /data-skin="([^"]+)"/.exec(query);
        if (!wanted) return null;
        return node.querySelectorAll('.skin-thumb').find(item => item.dataset.skin === wanted[1]) || null;
      },
      focus() { node.focused += 1; },
      addEventListener(type, handler) { listeners.set(`${selector}:${type}`, handler); },
      removeEventListener(type) { listeners.delete(`${selector}:${type}`); }
    };
    return node;
  };
  const nodes = {};
  for (const selector of ['#skinMask', '#skinDrawer', '#btnSkinClose', '#btnOpenSkins',
    '#skinStrip', '#skinFocus', '#skinSpecies']) {
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

const SKINS = Object.freeze([
  { id: 'pink', name: '粉桃兽', unlockDesc: '初始形态', unlocked: true, current: true, progress: null },
  { id: 'mint', name: '薄荷兽', unlockDesc: 'Lv.5 解锁', unlocked: true, current: false, progress: null },
  { id: 'moon', name: '月光兽', unlockDesc: 'Lv.12 解锁', unlocked: false, current: false, progress: { current: 9, target: 12 } }
]);

test('species selection filters unlock shapes without writing the current skin, including keyboard navigation', () => {
  const harness = createHarness({ skins: [...SKINS, {
    id: 'usagi', formId: 'usagi', formName: '小奇', name: '小奇', unlockLevel: 1,
    unlocked: true, current: false, unlockDesc: '默认可用'
  }] });
  assert.doesNotMatch(harness.strip(), /data-skin="usagi"/);
  harness.dom.fire('#skinSpecies', 'click', { target: { closest: () => ({ dataset: { form: 'usagi' } }) } });
  assert.match(harness.strip(), /data-skin="usagi"/);
  assert.doesNotMatch(harness.strip(), /data-skin="pink"/);
  assert.match(harness.focus(), /小奇/);
  harness.dom.fire('#skinStrip', 'keydown', { key: 'ArrowRight', preventDefault() {} });
  assert.match(harness.focus(), /小奇/);
  assert.deepEqual(harness.switched, []);
  harness.pressApply({ skinId: 'usagi' });
  assert.deepEqual(harness.switched, ['usagi']);
});

function createHarness({ skins = SKINS, currentSkin = 'pink', wornIds = ['milestone.sunhat'], wornIdsBySkin } = {}) {
  const dom = createDom();
  const state = { currentSkin, skins, appearance: { wornIds, wornIdsBySkin } };
  const switched = [];
  const previews = [];
  const restored = [];
  const picker = createPopoverSkinPicker({
    document: dom.document,
    $: dom.$,
    getState: () => state,
    escapeHTML,
    surfaceClient: { switchSkin: id => switched.push(id) },
    drawPetPreview: (canvas, options) => previews.push(options),
    skinAccent: id => ({ primary: `#${id}-p`, accent: `#${id}-a` }),
    restoreModalFocus: target => restored.push(target)
  });
  picker.mount({ subscribe: () => () => undefined });
  picker.render(state);
  const clickThumb = skinId => dom.fire('#skinStrip', 'click', {
    target: { closest: () => ({ dataset: { skin: skinId } }) }
  });
  const pressApply = ({ disabled = false, skinId } = {}) => dom.fire('#skinFocus', 'click', {
    target: { closest: () => ({ disabled, dataset: { skin: skinId } }) }
  });
  return {
    dom, picker, state, switched, previews, restored, clickThumb, pressApply,
    strip: () => dom.nodes['#skinStrip'].innerHTML,
    focus: () => dom.nodes['#skinFocus'].innerHTML
  };
}

test('the picker requires its scoped dependencies and a projection store', () => {
  assert.throws(() => createPopoverSkinPicker(), /requires document and \$/);
  assert.throws(() => createPopoverSkinPicker({
    document: {}, $: () => null, getState: () => ({}), escapeHTML
  }), /requires drawPetPreview/);
  assert.throws(() => createPopoverSkinPicker({
    document: {}, $: () => null, getState: () => ({}), escapeHTML,
    drawPetPreview: () => undefined, skinAccent: () => ({}), restoreModalFocus: () => undefined
  }), /requires surfaceClient\.switchSkin/);
  const picker = createPopoverSkinPicker({
    document: {}, $: () => null, getState: () => ({}), escapeHTML,
    drawPetPreview: () => undefined, skinAccent: () => ({}), restoreModalFocus: () => undefined,
    surfaceClient: { switchSkin() {} }
  });
  assert.equal(Object.isFrozen(picker), true);
  assert.throws(() => picker.mount({}), /projection store/);
});

// This is the whole point of the redesign: the old grid switched the skin — and with
// it the entire app theme — on the first click, with no way back.
test('clicking a filmstrip frame previews it and does not switch the skin', () => {
  const harness = createHarness();
  harness.clickThumb('mint');
  assert.deepEqual(harness.switched, []);
  assert.match(harness.focus(), /薄荷兽/);
  assert.match(harness.focus(), /换成这个形态/);
  // The focus card borrows the previewed skin's colours; the document theme is
  // applyTheme's business and must stay untouched until the commit lands.
  assert.deepEqual(harness.dom.nodes['#skinFocus'].style.properties, {
    '--focus-primary': '#mint-p', '--focus-accent': '#mint-a'
  });
});

test('confirming is the only thing that switches the skin', () => {
  const harness = createHarness();
  harness.clickThumb('mint');
  harness.pressApply({ skinId: 'mint' });
  assert.deepEqual(harness.switched, ['mint']);
});

test('the current form and locked forms both refuse to be confirmed', () => {
  const harness = createHarness();
  // Opening lands on the current skin, whose button states the fact instead of switching.
  assert.match(harness.focus(), /id="btnSkinApply"[^>]*disabled>当前形态</);
  harness.pressApply({ disabled: true, skinId: 'pink' });
  assert.deepEqual(harness.switched, []);

  harness.clickThumb('moon');
  assert.match(harness.focus(), /id="btnSkinApply"[^>]*disabled>未解锁 · Lv\.12 解锁</);
  harness.pressApply({ disabled: true, skinId: 'moon' });
  assert.deepEqual(harness.switched, []);
});

test('a locked form still shows its art and how far along the unlock is', () => {
  const harness = createHarness();
  harness.clickThumb('moon');
  assert.match(harness.focus(), /skin-progress-inner" style="width:75%"/);
  assert.match(harness.focus(), /当前 9\/12/);
  // Unlocked forms get no bar at all: an empty track reads as "not full yet".
  harness.clickThumb('mint');
  assert.doesNotMatch(harness.focus(), /skin-progress-outer/);
});

test('the big preview wears what the pet is wearing; the filmstrip shows forms alone', () => {
  const harness = createHarness({ wornIds: ['milestone.sunhat', 'milestone.halo'] });
  const strip = harness.previews.filter(preview => preview.size === 'thumb');
  assert.equal(strip.length, 3);
  assert.deepEqual(strip.map(preview => preview.skinId), ['pink', 'mint', 'moon']);
  for (const preview of strip) assert.equal(preview.itemIds, undefined);
  const big = harness.previews.filter(preview => preview.size === 'preview').at(-1);
  assert.deepEqual(big, {
    skinId: 'pink', itemIds: ['milestone.sunhat', 'milestone.halo'], size: 'preview'
  });
});

test('previewing another species uses its saved outfit, not the current species accessories', () => {
  const skins = [...SKINS, {
    id: 'usagi', name: '乌萨奇', unlockDesc: '默认可用', unlocked: true, current: false
  }];
  const harness = createHarness({
    skins, wornIds: ['milestone.sunhat'],
    wornIdsBySkin: { pink: ['milestone.sunhat'], usagi: ['usagi.ear-bow', 'usagi.travel-cape'] }
  });
  harness.clickThumb('usagi');
  assert.deepEqual(harness.previews.at(-1), {
    skinId: 'usagi', itemIds: ['usagi.ear-bow', 'usagi.travel-cape'], size: 'preview'
  });
  harness.state.appearance.wornIdsBySkin.usagi = ['usagi.star-collar'];
  harness.picker.render(harness.state);
  assert.deepEqual(harness.previews.at(-1).itemIds, ['usagi.star-collar']);
});

test('arrow keys move the preview along the strip and wrap around', () => {
  const harness = createHarness();
  harness.dom.fire('#skinStrip', 'keydown', { key: 'ArrowRight', preventDefault() {} });
  assert.match(harness.focus(), /薄荷兽/);
  harness.dom.fire('#skinStrip', 'keydown', { key: 'ArrowRight', preventDefault() {} });
  harness.dom.fire('#skinStrip', 'keydown', { key: 'ArrowRight', preventDefault() {} });
  assert.match(harness.focus(), /粉桃兽/);
  harness.dom.fire('#skinStrip', 'keydown', { key: 'End', preventDefault() {} });
  assert.match(harness.focus(), /月光兽/);
  // Moving the preview must never commit anything.
  assert.deepEqual(harness.switched, []);
});

test('the strip markup is only rebuilt when the skin list itself changes', () => {
  const harness = createHarness();
  const painted = harness.previews.filter(preview => preview.size === 'thumb').length;
  harness.clickThumb('mint');
  harness.clickThumb('moon');
  assert.equal(harness.previews.filter(preview => preview.size === 'thumb').length, painted,
    'moving the preview must not re-rasterise every frame');
});

test('locked frames are still reachable, because a hidden unlock target motivates nobody', () => {
  const harness = createHarness();
  assert.match(harness.strip(), /class="skin-thumb locked"[^>]*data-skin="moon"/);
  assert.doesNotMatch(harness.strip(), /data-skin="moon"[^>]*disabled/);
  harness.clickThumb('moon');
  assert.match(harness.focus(), /月光兽/);
});

test('opening restarts from the current form and closing hands focus back', () => {
  const harness = createHarness();
  harness.clickThumb('mint');
  assert.equal(harness.picker.isOpen(), false);
  harness.dom.document.activeElement = harness.dom.nodes['#btnOpenSkins'];
  harness.dom.fire('#btnOpenSkins', 'click', {});
  assert.equal(harness.picker.isOpen(), true);
  assert.equal(harness.dom.nodes['#skinMask'].attributes['aria-hidden'], 'false');
  // Half-finished try-ons do not survive a close: reopening shows the current form.
  assert.match(harness.focus(), /粉桃兽/);

  harness.dom.fire('#skinMask', 'click', { target: harness.dom.nodes['#skinDrawer'] });
  assert.equal(harness.picker.isOpen(), true);
  harness.dom.fire('#skinMask', 'click', { target: harness.dom.nodes['#skinMask'] });
  assert.equal(harness.picker.isOpen(), false);
  assert.deepEqual(harness.restored, [harness.dom.nodes['#btnOpenSkins']]);
});

test('an empty skin list says so rather than drawing an empty stage', () => {
  const harness = createHarness({ skins: [], currentSkin: null });
  assert.match(harness.focus(), /还没有可选的形态。/);
  assert.equal(harness.strip(), '');
});

test('the closed drawer ignores projection pushes, and dispose drops every listener', () => {
  const dom = createDom();
  const state = { currentSkin: 'pink', skins: SKINS, appearance: { wornIds: [] } };
  const previews = [];
  let listener = null;
  const picker = createPopoverSkinPicker({
    document: dom.document, $: dom.$, getState: () => state, escapeHTML,
    surfaceClient: { switchSkin() {} },
    drawPetPreview: (canvas, options) => previews.push(options),
    skinAccent: () => ({ primary: '#p', accent: '#a' }),
    restoreModalFocus: () => undefined
  });
  picker.mount({ subscribe: handler => { listener = handler; return () => { listener = null; }; } });
  listener({ dirty: { all: true }, state });
  assert.deepEqual(previews, [], 'eleven canvases have no business repainting while hidden');
  dom.fire('#btnOpenSkins', 'click', {});
  listener({ dirty: { skin: true }, state });
  assert.ok(previews.length > 0);
  // Entry, close, mask, strip click, strip keydown, focus-card click.
  assert.equal(dom.listeners.size, 7);
  picker.dispose();
  assert.equal(dom.listeners.size, 0);
  assert.equal(listener, null);
});

test('the ids the picker reaches for exist in the popover markup', () => {
  const html = fs.readFileSync(path.join(ROOT, 'src/renderer/popover.html'), 'utf8');
  const source = fs.readFileSync(path.join(ROOT, 'src/surfaces/popover/features/skin-picker.mjs'), 'utf8');
  const ids = [...new Set([...source.matchAll(/\$\('#([A-Za-z]+)'\)/g)].map(match => match[1]))];
  assert.ok(ids.length >= 4);
  for (const id of ids) {
    assert.match(html, new RegExp(`id="${id}"`), `#${id} must exist in popover.html`);
  }
});

test('skin uncertainty reconciles through the canonical store before another change is allowed', async () => {
  const dom = createDom();
  let state = { revision: 1, currentSkin: 'pink', skins: [...SKINS], appearance: { wornIds: [] } };
  let writes = 0, reads = 0, resolveRead;
  const picker = createPopoverSkinPicker({ document: dom.document, $: dom.$, getState: () => state,
    escapeHTML, skinAccent: () => ({}), restoreModalFocus() {}, drawPetPreview() {},
    surfaceClient: { switchSkin() { writes++; throw new Error('lost receipt'); } } });
  picker.mount({ subscribe: () => () => {}, refresh: async () => {
    reads++; state = await new Promise(resolve => { resolveRead = resolve; }); return state;
  } });
  picker.open();
  dom.fire('#skinStrip', 'click', { target: { closest: () => ({ dataset: { skin: 'mint' } }) } });
  const press = () => dom.fire('#skinFocus', 'click', { target: { closest: () => ({ disabled: false, dataset: { skin: 'mint' } }) } });
  press(); await new Promise(resolve => setImmediate(resolve)); press();
  assert.equal(writes, 1); assert.equal(reads, 1);
  resolveRead({ revision: 2, currentSkin: 'mint', skins: SKINS.map(skin => ({ ...skin, current: skin.id === 'mint' })), appearance: { wornIds: [] } });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(dom.nodes['#skinFocus'].innerHTML, /当前形态/);
  assert.equal(writes, 1, 'readback never repeats the mutation');
  picker.dispose();
});
