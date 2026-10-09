'use strict';

// 进展页第一次被打开时今天自动摊开，只一次；用户自己合上以后不再替他弹开。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

function node() {
  const n = {
    innerHTML: '', textContent: '', classes: new Set(), attrs: {},
    classList: { add: c => n.classes.add(c), remove: c => n.classes.delete(c), toggle: (c, on) => (on ? n.classes.add(c) : n.classes.delete(c)), contains: c => n.classes.has(c) },
    setAttribute(k, v) { n.attrs[k] = v; },
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {}
  };
  return n;
}

test('showToday selects today once and never re-opens what the person closed', async () => {
  const { createPopoverProgressFeature } = await import(pathToFileURL(path.resolve(__dirname, '../src/surfaces/popover/features/progress.mjs')).href);
  const nodes = new Map();
  const selected = [];
  const now = new Date(2026, 8, 29, 9, 30).getTime();
  const feature = createPopoverProgressFeature({
    document: {},
    getState: () => ({ serverNow: now, stats: {} }),
    $: selector => { if (!nodes.has(selector)) nodes.set(selector, node()); return nodes.get(selector); },
    formatMs: ms => `${ms}`,
    escapeHTML: value => String(value),
    onDaySelected: dayKey => selected.push(dayKey)
  });
  feature.showToday();
  assert.deepEqual(selected, ['2026-09-29']);
  feature.showToday();
  assert.deepEqual(selected, ['2026-09-29'], 'a second visit while it is open changes nothing');
  feature.selectHeatmapDay('2026-09-29');           // the person closes it
  assert.deepEqual(selected, ['2026-09-29', null]);
  feature.showToday();
  assert.deepEqual(selected, ['2026-09-29', null], 'closed by the person: it stays closed this session');
});
