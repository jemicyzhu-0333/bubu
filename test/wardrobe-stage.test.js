'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createWardrobeStage, wardrobeStageLooks } = require('../src/surfaces/popover/features/wardrobe-stage.mjs');
const { USAGI_OUTFIT_SETS } = require('../src/content/companion/usagi-wardrobe.mjs');
const { setLocale } = require('../src/surfaces/shared/interface/i18n.mjs');

function fixture({ locked = false } = {}) {
  let state = { currentSkin: 'usagi', appearance: { wornIds: ['custom-item'], choices: [{ options:
    [...new Set(USAGI_OUTFIT_SETS.flatMap(look => look.itemIds))].map(id => ({ id, label: id, available: !locked, lockReason: { kind: 'level', minLevel: 5 } })) }] } };
  const nodes = new Map(), paints = [], calls = [], skins = []; let pending = false;
  function $(selector) {
    if (!nodes.has(selector)) {
      const listeners = new Map(), classes = new Set();
      nodes.set(selector, { hidden: false, disabled: false, textContent: '', attributes: {},
        classList: { toggle(name, on) { on ? classes.add(name) : classes.delete(name); }, contains: name => classes.has(name) },
        setAttribute(name, value) { this.attributes[name] = value; },
        addEventListener(type, handler) { listeners.set(type, handler); },
        removeEventListener(type) { listeners.delete(type); },
        emit(type, event = {}) { listeners.get(type)?.(event); }, listeners });
    }
    return nodes.get(selector);
  }
  const stage = createWardrobeStage({ $, getState: () => state, formFor: next => ({ id: next.currentSkin === 'usagi' ? 'usagi' : 'dango' }),
    drawPetPreview: (canvas, options) => paints.push({ canvas, options }), onApply: (id, skin) => { calls.push(id); skins.push(skin); }, busy: () => pending, lockText: () => 'Lv.5' });
  stage.mount(); stage.render(state);
  return { $, stage, paints, calls, skins, get state() { return state; }, setState(next) { state = next; }, setPending(value) { pending = value; },
    next: () => $('#wardrobeStageNext').emit('click'), previous: () => $('#wardrobeStagePrevious').emit('click'), apply: () => $('#wardrobeApplyOutfit').emit('click') };
}

test('stage starts at editable main outfit with a faint-next recipe and no apply action', () => {
  const h = fixture();
  assert.equal(h.$('#wardrobeStagePosition').textContent, '1 / 4');
  assert.equal(h.$('#wardrobeApplyOutfit').hidden, true);
  assert.equal(h.$('#wardrobePreviewPrevious').hidden, true);
  assert.deepEqual(h.paints.map(paint => paint.options.itemIds), [['custom-item'], [...USAGI_OUTFIT_SETS[0].itemIds]]);
  assert.deepEqual(h.calls, []);
});

test('browsing paints only adjacent models and never equips or changes immutable recipes', () => {
  const h = fixture(), before = JSON.stringify(USAGI_OUTFIT_SETS);
  h.next();
  assert.equal(h.$('#wardrobeStagePosition').textContent, '2 / 4');
  assert.equal(h.paints.length, 5, 'at most three new model previews per navigation');
  assert.equal(h.$('#wardrobeApplyOutfit').hidden, false);
  const count = h.paints.length; h.stage.render(h.state); h.stage.repaintCopy();
  assert.equal(h.paints.length, count, 'unchanged and locale repaint reuse static canvases');
  assert.equal(JSON.stringify(USAGI_OUTFIT_SETS), before);
  assert.deepEqual(h.state.appearance.wornIds, ['custom-item']); assert.deepEqual(h.calls, []);
  h.apply(); assert.deepEqual(h.calls, [USAGI_OUTFIT_SETS[0].id]); assert.deepEqual(h.skins, ['usagi']);
});

test('locked recipes expose requirements but never show or dispatch apply', () => {
  const h = fixture({ locked: true }); h.next(); h.apply();
  assert.equal(h.$('#wardrobeApplyOutfit').hidden, true);
  assert.match(h.$('#wardrobeStageRequirement').textContent, /Lv\.5/);
  assert.deepEqual(h.calls, []);
});

test('apply rechecks the live form and availability, plus pending/equipped guards', () => {
  const h = fixture(); h.next(); h.setPending(true); h.apply(); assert.deepEqual(h.calls, []);
  h.setPending(false); h.state.appearance.wornIds = [...USAGI_OUTFIT_SETS[0].itemIds]; h.stage.render(h.state); h.apply();
  assert.equal(h.$('#wardrobeApplyOutfit').disabled, true); assert.deepEqual(h.calls, []);
  h.state.appearance.wornIds = []; h.stage.render(h.state);
  h.state.appearance.choices[0].options[0].available = false; h.apply(); assert.deepEqual(h.calls, []);
  h.setState({ currentSkin: 'pink', appearance: { wornIds: [], choices: [] } }); h.apply();
  assert.equal(h.$('#wardrobeStagePosition').textContent, '1 / 1'); assert.deepEqual(h.calls, []);
});

test('horizontal swipe and arrow keys browse, vertical gestures and cancelled pointers do not', () => {
  const h = fixture(), stage = h.$('#wardrobeStage');
  const swipe = (x, y) => { stage.emit('pointerdown', { pointerId: 1, clientX: 100, clientY: 100 }); stage.emit('pointerup', { pointerId: 1, clientX: x, clientY: y }); };
  swipe(50, 180); assert.equal(h.$('#wardrobeStagePosition').textContent, '1 / 4');
  swipe(50, 104); assert.equal(h.$('#wardrobeStagePosition').textContent, '2 / 4');
  let prevented = 0; stage.emit('keydown', { key: 'ArrowRight', preventDefault() { prevented++; } });
  assert.equal(h.$('#wardrobeStagePosition').textContent, '3 / 4'); assert.equal(prevented, 1);
  stage.emit('pointerdown', { pointerId: 2, clientX: 100, clientY: 100 }); stage.emit('pointercancel');
  stage.emit('pointerup', { pointerId: 2, clientX: 40, clientY: 100 }); assert.equal(h.$('#wardrobeStagePosition').textContent, '3 / 4');
  h.stage.showCurrent(); assert.equal(h.$('#wardrobeStagePosition').textContent, '1 / 4');
});

test('locale repaint preserves model identity and disposal/remount does not duplicate gestures', () => {
  const h = fixture(), count = h.paints.length; setLocale('en');
  try { h.stage.repaintCopy(); assert.equal(h.$('#wardrobeStageTitle').textContent, 'Mix & match'); assert.equal(h.paints.length, count); }
  finally { setLocale('zh'); }
  h.stage.dispose(); assert.equal(h.$('#wardrobeStage').listeners.size, 0); h.stage.mount(); h.stage.mount();
  h.next(); assert.equal(h.$('#wardrobeStagePosition').textContent, '2 / 4');
});

test('preset projection is form-scoped and never leaks into the main worn IDs', () => {
  const h = fixture(); const looks = wardrobeStageLooks(h.state, 'usagi');
  looks[0].itemIds.push('local-only'); assert.deepEqual(h.state.appearance.wornIds, ['custom-item']);
  assert.equal(wardrobeStageLooks(h.state, 'dango').length, 1);
});

test('caption keeps current and unlocked looks concise and exposes every locked condition through help', () => {
  const h = fixture();
  assert.equal(h.$('#wardrobeStageLocked').hidden, true);
  assert.equal(h.$('#wardrobeStageRequirement').textContent, '');
  assert.equal(h.$('#wardrobeSummary').hidden, true);
  assert.equal(h.$('#wardrobeStageEquipped').hidden, false);
  h.next();
  assert.equal(h.$('#wardrobeStageLocked').hidden, true);
  assert.equal(h.$('#wardrobeSummary').hidden, true);
  assert.equal(h.$('#wardrobeApplyOutfit').hidden, false);
  for (const piece of h.state.appearance.choices[0].options) piece.available = false;
  h.stage.render(h.state);
  assert.equal(h.$('#wardrobeStageLocked').hidden, false);
  for (const id of USAGI_OUTFIT_SETS[0].itemIds) assert.ok(h.$('#wardrobeStageRequirement').textContent.includes(id));
  assert.equal(h.$('#wardrobeStageRequirementHelp').attributes['aria-label'], '穿搭解锁条件');
  setLocale('en');
  try {
    h.stage.repaintCopy();
    assert.equal(h.$('#wardrobeStageLockedLabel').textContent, 'Locked');
    assert.equal(h.$('#wardrobeStageRequirementHelp').attributes['aria-label'], 'Outfit unlock requirements');
    assert.equal(h.$('#wardrobeStageNext').title, h.$('#wardrobeStageNext').attributes['aria-label']);
  } finally { setLocale('zh'); }
  h.stage.showCurrent();
  assert.equal(h.$('#wardrobeStageLocked').hidden, true);
  assert.equal(h.$('#wardrobeStageRequirement').textContent, '');
});

test('locked stage requirements use the shared focusable help primitive without clipped copy', () => {
  const fs = require('node:fs');
  const html = fs.readFileSync(require('node:path').join(__dirname, '../src/renderer/popover.html'), 'utf8');
  assert.match(html, /<details class="inline-help"><summary id="wardrobeStageRequirementHelp"[^>]*>\?<\/summary><p id="wardrobeStageRequirement"><\/p><\/details>/);
});


test('reading locked help does not let carousel arrows move focus into hidden help', () => {
  const h = fixture({ locked: true }); h.next();
  let prevented = false;
  h.$('#wardrobeStage').emit('keydown', { key: 'ArrowLeft', target: { closest: selector => selector === '.inline-help' }, preventDefault() { prevented = true; } });
  assert.equal(h.$('#wardrobeStagePosition').textContent, '2 / 4');
  assert.equal(h.$('#wardrobeStageLocked').hidden, false);
  assert.equal(prevented, false);
});


test('main title names only exact full recipes; subsets, extra items, and bare/custom looks stay mixed', () => {
  const h = fixture(), recipe = USAGI_OUTFIT_SETS[0];
  for (const wornIds of [[], ['custom-item'], recipe.itemIds.slice(1), [...recipe.itemIds, 'extra-aura']]) {
    h.state.appearance.wornIds = [...wornIds]; h.stage.showCurrent();
    assert.equal(h.$('#wardrobeStageTitle').textContent, '混搭');
    assert.equal(h.$('#wardrobeStageEquipped').textContent, '已搭配');
    assert.equal(h.$('#wardrobeStageEquipped').hidden, false);
    assert.equal(h.$('#wardrobeApplyOutfit').hidden, true);
  }
  h.state.appearance.wornIds = [...recipe.itemIds].reverse(); h.stage.showCurrent();
  assert.equal(h.$('#wardrobeStageTitle').textContent, recipe.label);
  assert.equal(h.$('#wardrobeStageFullName').textContent, recipe.label);
  h.next();
  assert.equal(h.$('#wardrobeStageEquipped').hidden, false);
  assert.equal(h.$('#wardrobeApplyOutfit').hidden, true, 'an exact worn recipe is status, not a disabled action');
});

test('preview name remains stable across locked, applicable and canonical equipped states', () => {
  const h = fixture({ locked: true }), recipe = USAGI_OUTFIT_SETS[0]; h.next();
  assert.equal(h.$('#wardrobeStageTitle').textContent, recipe.label);
  assert.equal(h.$('#wardrobeStageLockedLabel').textContent, '待解锁');
  assert.equal(h.$('#wardrobeStageLocked').hidden, false);
  assert.equal(h.$('#wardrobeStageEquipped').hidden, true);
  for (const piece of h.state.appearance.choices[0].options) piece.available = true;
  h.stage.render(h.state);
  assert.equal(h.$('#wardrobeStageTitle').textContent, recipe.label);
  assert.equal(h.$('#wardrobeApplyOutfit').textContent, '一键换装');
  assert.equal(h.$('#wardrobeApplyOutfit').hidden, false);
  assert.equal(h.$('#wardrobeStageLocked').hidden, true);
  h.apply(); h.setPending(true); h.stage.render(h.state);
  assert.equal(h.$('#wardrobeStageEquipped').hidden, true, 'pending/unknown receipt must not manufacture matched state');
  assert.equal(h.$('#wardrobeApplyOutfit').disabled, true);
  assert.equal(h.$('#wardrobeStageTitle').textContent, recipe.label);
  h.state.appearance.wornIds = [...recipe.itemIds]; h.stage.render(h.state);
  assert.equal(h.$('#wardrobeStageEquipped').hidden, false, 'only fresh canonical equipment proves the look is worn');
  assert.equal(h.$('#wardrobeApplyOutfit').hidden, true);
});

test('production layout orders model then name then one stable action/status row', () => {
  const fs = require('node:fs'), path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, '../src/renderer/popover.html'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '../src/surfaces/popover/styles/theme.css'), 'utf8');
  assert.ok(html.indexOf('class="wardrobe-runway"') < html.indexOf('id="wardrobeStageTitle"'));
  assert.ok(html.indexOf('id="wardrobeStageTitle"') < html.indexOf('class="wardrobe-stage-state"'));
  assert.match(html, /<p id="wardrobeStageEquipped" class="wardrobe-stage-equipped"[^>]*>已搭配<\/p>/);
  assert.match(css, /#wardrobeStageTitle \{[^}]*font-size: 13px; font-weight: 500;[^}]*-webkit-line-clamp: 2;/);
  assert.match(css, /\.wardrobe-stage-caption \{[^}]*gap: 4px;/);
  assert.match(css, /\.wardrobe-stage-state \{[^}]*height: 32px;/);
  assert.match(css, /\.wardrobe-apply \{[^}]*height: 32px;[^}]*padding: 5px 12px;[^}]*font-size: 13px; font-weight: 500;/);
});


test('canonical apply replaces focused action with status without losing keyboard location', () => {
  const h = fixture(); h.next();
  let focused = 0; h.$('#wardrobeStage').focus = () => { focused++; };
  const apply = h.$('#wardrobeApplyOutfit'); apply.ownerDocument = { activeElement: apply };
  h.setPending(true); h.stage.render(h.state);
  assert.equal(focused, 0, 'pending or unknown never claims successful application');
  h.state.appearance.wornIds = [...USAGI_OUTFIT_SETS[0].itemIds]; h.stage.render(h.state);
  assert.equal(apply.hidden, true); assert.equal(focused, 1);
  h.stage.render(h.state); assert.equal(focused, 1, 'unchanged projection never steals focus again');
});


test('full names use a plain-text shared keyboard and tap help trigger without an extra icon', () => {
  const h = fixture(); h.stage.repaintCopy();
  assert.equal(h.$('#wardrobeStageFullName').textContent, h.$('#wardrobeStageTitle').textContent);
  assert.equal(h.$('#wardrobeStageTitle').attributes['aria-description'], '完整套装名称');
  const fs = require('node:fs'), path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, '../src/renderer/popover.html'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '../src/surfaces/popover/styles/theme.css'), 'utf8');
  assert.match(html, /<details class="inline-help wardrobe-stage-name" id="wardrobeStageNameHelp">\s*<summary id="wardrobeStageTitle"[^>]*>混搭<\/summary>\s*<p id="wardrobeStageFullName"><\/p>/);
  assert.match(css, /#wardrobeStageTitle::before \{ content: none; \}/);
  assert.match(css, /\.wardrobe-stage-arrow \{[^}]*width: 32px; height: 32px;/);
});


test('apply focus intent survives browser focus loss from disabled button but respects newer focus and visits', () => {
  const h = fixture(); h.next();
  const apply = h.$('#wardrobeApplyOutfit'), body = {}, document = { body, activeElement: null };
  apply.ownerDocument = document;
  let focused = 0;
  h.$('#wardrobeStage').focus = options => { focused++; assert.equal(options.preventScroll, true); };
  document.activeElement = apply; h.apply();
  h.setPending(true); document.activeElement = body; h.stage.render(h.state);
  assert.equal(focused, 0, 'browser blur while pending is not confirmation');
  h.state.appearance.wornIds = [...USAGI_OUTFIT_SETS[0].itemIds]; h.stage.render(h.state);
  assert.equal(focused, 1, 'canonical success restores focus lost by disabled action');

  h.state.appearance.wornIds = []; h.setPending(false); h.stage.render(h.state);
  document.activeElement = apply; h.apply(); document.activeElement = { id: 'another-control' };
  h.state.appearance.wornIds = [...USAGI_OUTFIT_SETS[0].itemIds]; h.stage.render(h.state);
  assert.equal(focused, 1, 'deliberate newer focus wins');

  h.state.appearance.wornIds = []; h.stage.render(h.state);
  document.activeElement = apply; h.apply(); document.activeElement = body; h.stage.cancelGesture();
  h.state.appearance.wornIds = [...USAGI_OUTFIT_SETS[0].itemIds]; h.stage.render(h.state);
  assert.equal(focused, 1, 'closing the visit cancels restoration intent');
});


test('a newer deliberate focus move cancels apply focus intent even if focus later returns to body', () => {
  const h = fixture(); h.stage.dispose();
  const listeners = new Map(), body = {};
  const document = { body, activeElement: body, addEventListener(type, fn) { listeners.set(type, fn); }, removeEventListener(type) { listeners.delete(type); } };
  h.$('#wardrobeStage').ownerDocument = document;
  const apply = h.$('#wardrobeApplyOutfit'); apply.ownerDocument = document;
  h.stage.mount(); h.next();
  let focused = 0; h.$('#wardrobeStage').focus = () => { focused++; };
  document.activeElement = apply; h.apply();
  listeners.get('focusin')({ target: { id: 'different-control' } });
  document.activeElement = body;
  h.state.appearance.wornIds = [...USAGI_OUTFIT_SETS[0].itemIds]; h.stage.render(h.state);
  assert.equal(focused, 0);
  h.stage.dispose(); assert.equal(listeners.size, 0);
});


test('only fixed recipe names receive the local serif nameplate, including a canonical exact match', () => {
  const h = fixture();
  assert.equal(h.$('#wardrobeStageTitle').attributes['data-named'], 'false');
  assert.equal(h.$('#wardrobeStageNameHelp').attributes['data-named'], 'false');
  h.next();
  assert.equal(h.$('#wardrobeStageTitle').attributes['data-named'], 'true');
  h.state.appearance.wornIds = [...USAGI_OUTFIT_SETS[0].itemIds]; h.stage.showCurrent();
  assert.equal(h.$('#wardrobeStageTitle').attributes['data-named'], 'true');
  h.state.appearance.wornIds.push('extra'); h.stage.showCurrent();
  assert.equal(h.$('#wardrobeStageTitle').attributes['data-named'], 'false');
  const css = require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/surfaces/popover/styles/theme.css'), 'utf8');
  assert.match(css, /#wardrobeStageTitle\[data-named="true"\] \{[^}]*font-family: "Songti SC", "Noto Serif CJK SC"[^}]*font-size: 15px; font-weight: 600; line-height: 18px; letter-spacing: \.12em;/);
  assert.match(css, /#wardrobeStageTitle \{[^}]*height: 36px; line-height: 18px; font-size: 13px; font-weight: 500;/);
});
