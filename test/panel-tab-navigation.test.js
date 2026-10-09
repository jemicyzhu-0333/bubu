'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createPopoverAppChrome } = require('../src/surfaces/popover/features/app-chrome.mjs');
const { nextRovingIndex } = require('../src/core/keyboard-navigation.mjs');

test('the real app chrome wires main and arrangement keyboard groups, companion return, and disposal', () => {
  const html = fs.readFileSync(path.join(__dirname, '../src/renderer/popover.html'), 'utf8');
  const attr = (markup, name) => new RegExp(`\\b${name}="([^"]+)"`).exec(markup)?.[1];
  let focused = null;
  const node = markup => {
    const id = attr(markup, 'id');
    const attributes = new Map();
    const listeners = new Map();
    return {
      id, dataset: { tab: attr(markup, 'data-tab'), nav: attr(markup, 'data-nav') }, hidden: false, tabIndex: -1,
      classList: { toggle() {} },
      setAttribute: (key, value) => attributes.set(key, value),
      getAttribute: key => attributes.get(key),
      addEventListener: (type, handler) => listeners.set(type, handler),
      removeEventListener: type => listeners.delete(type),
      focus: () => { focused = id; },
      fire: (type, event) => listeners.get(type)?.(event),
      listenerCount: () => listeners.size
    };
  };
  const buttons = [...html.matchAll(/<button\b[^>]*>/g)].map(match => match[0]);
  const tabs = buttons.filter(markup => attr(markup, 'role') === 'tab').map(node);
  assert.deepEqual(tabs.filter(tab => tab.dataset.nav === 'main').map(tab => tab.dataset.tab), ['today', 'tasks', 'progress']);
  assert.deepEqual(tabs.filter(tab => tab.dataset.nav === 'arrange').map(tab => tab.dataset.tab), ['tasks', 'routines', 'inbox', 'archive']);
  const companion = node(buttons.find(markup => attr(markup, 'id') === 'tabCompanion'));
  const panels = [...html.matchAll(/<section\b[^>]*>/g)].map(match => match[0])
    .filter(markup => (attr(markup, 'class') || '').split(/\s+/).includes('tab-content')).map(node);
  const byId = Object.fromEntries([...tabs, companion].map(tab => [tab.id, tab]));
  const arrange = { hidden: true }, shown = [];
  const document = { body: { dataset: {} }, querySelector: () => null, querySelectorAll: () => [],
    documentElement: { dataset: {}, style: { setProperty() {} } } };
  const feature = createPopoverAppChrome({
    document, $: selector => selector === '#arrangeNavigation' ? arrange : byId[selector.slice(1)] || null,
    $$: selector => selector === '.tab-btn' ? tabs : selector === '.tab-content' ? panels : [],
    getState: () => null, getSession: () => ({}), surfaceClient: {}, escapeHTML: String,
    nextRovingIndex, onTabShown: name => shown.push(name)
  });
  feature.mount();
  const expectActive = name => {
    const arranging = ['tasks', 'routines', 'inbox', 'archive'].includes(name);
    for (const tab of tabs) {
      const active = tab.id === 'tabArrange' ? arranging : tab.dataset.tab === name;
      assert.equal(tab.getAttribute('aria-selected'), String(active), `${tab.id} selection`);
      assert.equal(tab.tabIndex, active || name === 'companion' && tab.id === 'tabToday' ? 0 : -1, `${tab.id} keyboard entry`);
    }
    assert.deepEqual(panels.filter(panel => !panel.hidden).map(panel => panel.dataset.tab), [name]);
    for (const panel of panels) assert.equal(panel.getAttribute('aria-hidden'), String(panel.dataset.tab !== name));
    assert.equal(shown.at(-1), name);
    assert.equal(document.body.dataset.destination, name);
    assert.equal(arrange.hidden, !arranging);
    assert.equal(companion.getAttribute('aria-pressed'), String(name === 'companion'));
  };
  byId.tabRoutines.fire('click'); expectActive('routines');
  for (const [from, key, to, destination] of [
    ['tabRoutines', 'ArrowLeft', 'tabTasks', 'tasks'], ['tabTasks', 'End', 'tabArchive', 'archive'],
    ['tabArchive', 'ArrowRight', 'tabTasks', 'tasks'], ['tabTasks', 'ArrowLeft', 'tabArchive', 'archive'],
    ['tabArchive', 'Home', 'tabTasks', 'tasks'], ['tabTasks', 'ArrowRight', 'tabRoutines', 'routines'],
    ['tabArrange', 'Home', 'tabToday', 'today'], ['tabToday', 'End', 'tabProgress', 'progress'],
    ['tabProgress', 'ArrowRight', 'tabToday', 'today'], ['tabToday', 'ArrowLeft', 'tabProgress', 'progress']
  ]) {
    let prevented = false;
    byId[from].fire('keydown', { key, preventDefault() { prevented = true; } });
    assert.equal(prevented, true); assert.equal(focused, to); expectActive(destination);
  }
  byId.tabArrange.fire('click'); expectActive('routines');
  companion.fire('click'); expectActive('companion');
  byId.tabArrange.fire('click'); expectActive('routines');
  feature.dispose();
  assert.ok([...tabs, companion].every(tab => tab.listenerCount() === 0));
});
