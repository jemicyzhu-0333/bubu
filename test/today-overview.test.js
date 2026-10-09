'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPopoverTodayOverview } = require('../src/surfaces/popover/features/today-overview.mjs');

function harness(initial) {
  let state = initial;
  const listeners = new Map();
  const node = selector => ({
    selector, hidden: false, textContent: '', attributes: {},
    classList: { names: new Set(), toggle(name, force) { if (force) this.names.add(name); else this.names.delete(name); }, contains(name) { return this.names.has(name); } },
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(type, handler) { listeners.set(`${selector}:${type}`, handler); },
    removeEventListener(type) { listeners.delete(`${selector}:${type}`); }
  });
  const nodes = Object.fromEntries(['#energyStrip', '#routinesStrip', '#tileEnergy', '#tileRoutines', '#tileInbox',
    '#todayInboxCount', '#todayInboxSub', '#energyTileSub'].map(selector => [selector, node(selector)]));
  nodes['[data-overview="energy"]'] = nodes['#tileEnergy'];
  nodes['[data-overview="routines"]'] = nodes['#tileRoutines'];
  let subscriber = null;
  const opened = [];
  const overview = createPopoverTodayOverview({ $: selector => nodes[selector] || null, getState: () => state, openInbox: () => opened.push('inbox') });
  overview.mount({ subscribe: fn => { subscriber = fn; return () => { subscriber = null; }; } });
  return {
    nodes, opened, overview, click: selector => listeners.get(`${selector}:click`)(),
    push(next, dirty) { state = next; subscriber({ state, dirty }); }
  };
}

const base = { impulses: [{ id: 'a' }, { id: 'b' }], routines: { today: { counts: { due: 0 } } }, wake: { ask: false } };

test('the three tiles report energy, routines and the inbox; only one detail panel is open at a time', () => {
  const h = harness(base);
  assert.equal(h.nodes['#todayInboxCount'].textContent, '2');
  assert.equal(h.nodes['#todayInboxSub'].textContent, '条待整理');
  assert.equal(h.nodes['#energyStrip'].hidden, true, 'energy never unfolds on its own');
  assert.equal(h.nodes['#routinesStrip'].hidden, true);
  h.click('#tileEnergy');
  assert.equal(h.nodes['#energyStrip'].hidden, false);
  assert.equal(h.nodes['#tileEnergy'].attributes['aria-expanded'], 'true');
  h.click('#tileRoutines');
  assert.equal(h.nodes['#energyStrip'].hidden, true);
  assert.equal(h.nodes['#routinesStrip'].hidden, false);
  h.click('#tileRoutines');
  assert.equal(h.nodes['#routinesStrip'].hidden, true);
  h.click('#tileInbox');
  assert.deepEqual(h.opened, ['inbox']);
});

test('a due routine opens its panel until the person chooses; a wake question only changes the energy hint', () => {
  const h = harness({ ...base, routines: { today: { counts: { due: 1 } } }, wake: { ask: true } });
  assert.equal(h.nodes['#routinesStrip'].hidden, false);
  assert.equal(h.nodes['#energyStrip'].hidden, true);
  assert.equal(h.nodes['#energyTileSub'].textContent, '今天几点起？');
  h.click('#tileRoutines');
  h.push({ ...base, impulses: [], routines: { today: { counts: { due: 2 } } } }, { routines: true, impulses: true });
  assert.equal(h.nodes['#routinesStrip'].hidden, true, 'a later projection never overrides the person');
  assert.equal(h.nodes['#todayInboxSub'].textContent, '已清空');
  assert.equal(h.nodes['#tileInbox'].classList.contains('is-empty'), true);
});
