'use strict';

// 热力图 84 个格子曾经是 84 个 Tab 停靠点：键盘用户要连按 84 次才能越过它。现在整个热力图是一个停靠点（漫游 tabindex），
// 方向键在格子之间移动；统计变化会把整块重建，重建后焦点要回到同一天。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

function makeDom() {
  const state = { active: null };
  const make = tag => {
    const node = {
      tag, children: [], attrs: {}, listeners: {}, classes: new Set(), tabIndex: 0, textContent: '', title: '',
      appendChild(child) { child.parent = node; node.children.push(child); return child; },
      setAttribute(key, value) { node.attrs[key] = String(value); },
      getAttribute(key) { return key in node.attrs ? node.attrs[key] : null; },
      addEventListener(type, handler) { (node.listeners[type] ||= []).push(handler); },
      classList: { add: c => node.classes.add(c), remove: c => node.classes.delete(c), toggle: (c, on) => (on ? node.classes.add(c) : node.classes.delete(c)) },
      focus() { state.active = node; },
      contains(other) { for (let n = other; n; n = n.parent) if (n === node) return true; return false; },
      querySelectorAll(selector) {
        const found = [];
        const walk = n => { for (const child of n.children) { if (selector === '[data-day]' && 'data-day' in child.attrs) found.push(child); walk(child); } };
        walk(node);
        return found;
      },
      querySelector(selector) {
        const match = /^\[data-day="([^"]+)"\]$/.exec(selector);
        return match ? node.querySelectorAll('[data-day]').find(cell => cell.attrs['data-day'] === match[1]) || null : null;
      }
    };
    Object.defineProperty(node, 'innerHTML', { set(value) { if (value === '') node.children = []; }, get() { return ''; } });
    return node;
  };
  return { state, make };
}

async function fixture() {
  const { createPopoverProgressFeature } = await import(pathToFileURL(path.resolve(__dirname, '../src/surfaces/popover/features/progress.mjs')).href);
  const { state, make } = makeDom();
  const nodes = new Map();
  const $ = selector => { if (!nodes.has(selector)) nodes.set(selector, make('div')); return nodes.get(selector); };
  const document = { createElement: make, get activeElement() { return state.active; } };
  const selected = [];
  const appState = { serverNow: new Date(2026, 8, 30, 10).getTime(), stats: { dailyFocus: {}, dailyCompletions: {} } };
  const feature = createPopoverProgressFeature({
    document, getState: () => appState, $, formatMs: ms => `${ms}`, escapeHTML: String, onDaySelected: day => selected.push(day)
  });
  return { feature, container: $('#heatmap'), state, selected, appState };
}

const cellsOf = container => container.querySelectorAll('[data-day]');
const press = (cell, key) => {
  const event = { key, prevented: false, preventDefault() { this.prevented = true; } };
  for (const handler of cell.listeners.keydown) handler(event);
  return event;
};
const stops = container => cellsOf(container).filter(cell => cell.tabIndex === 0).map(cell => cell.attrs['data-day']);

test('the whole heatmap is a single tab stop, resting on today', async () => {
  const { feature, container } = await fixture();
  feature.renderHeatmap();
  assert.equal(cellsOf(container).length, 84);
  assert.deepEqual(stops(container), ['2026-09-30']);
  assert.equal(container.attrs.role, 'group');
  assert.match(container.attrs['aria-label'], /方向键/);
});

test('arrow keys move by day and by week, Home and End jump to the ends, and the tab stop follows the focus', async () => {
  const { feature, container, state } = await fixture();
  feature.renderHeatmap();
  let cell = cellsOf(container).find(c => c.attrs['data-day'] === '2026-09-30');
  const go = key => { const event = press(cell, key); cell = state.active; return event; };
  assert.equal(go('ArrowLeft').prevented, true);
  assert.equal(cell.attrs['data-day'], '2026-09-23', 'left = one week earlier');
  go('ArrowUp');
  assert.equal(cell.attrs['data-day'], '2026-09-22', 'up = the day before');
  go('ArrowDown'); go('ArrowDown');
  assert.equal(cell.attrs['data-day'], '2026-09-24');
  go('ArrowLeft');
  assert.equal(cell.attrs['data-day'], '2026-09-17');
  go('ArrowRight');
  assert.equal(cell.attrs['data-day'], '2026-09-24', 'right = one week later');
  assert.deepEqual(stops(container), ['2026-09-24'], 'the single tab stop travels with the focus');
});

test('moving past either end does nothing and does not swallow the key', async () => {
  const { feature, container, state } = await fixture();
  feature.renderHeatmap();
  const cells = cellsOf(container);
  const last = cells[cells.length - 1];
  const right = press(last, 'ArrowRight');
  assert.equal(right.prevented, false, 'nothing to move to: let the key through');
  const first = cells[0];
  assert.equal(press(first, 'ArrowLeft').prevented, false);
  assert.equal(press(first, 'ArrowUp').prevented, false);
  assert.equal(press(first, 'Home').prevented, true, 'Home on the first cell still counts as handled');
  assert.equal(state.active.attrs['data-day'], first.attrs['data-day']);
  press(first, 'End');
  assert.equal(state.active.attrs['data-day'], last.attrs['data-day']);
  assert.deepEqual(stops(container), [last.attrs['data-day']], 'still exactly one tab stop');
});

test('Enter selects the focused day and the tab stop stays on the selected day', async () => {
  const { feature, container, state, selected } = await fixture();
  feature.renderHeatmap();
  const week = cellsOf(container).find(c => c.attrs['data-day'] === '2026-09-23');
  press(cellsOf(container).find(c => c.attrs['data-day'] === '2026-09-30'), 'ArrowLeft');
  assert.equal(state.active, week);
  press(week, 'Enter');
  assert.deepEqual(selected, ['2026-09-23']);
  assert.equal(week.attrs['aria-pressed'], 'true');
  assert.deepEqual(stops(container), ['2026-09-23']);
});

test('a rebuild caused by new stats hands the focus back to the same day', async () => {
  const { feature, container, state, appState } = await fixture();
  feature.renderHeatmap();
  const cell = cellsOf(container).find(c => c.attrs['data-day'] === '2026-09-16');
  cell.focus();
  appState.stats = { dailyFocus: { '2026-09-16': 25 * 60000 }, dailyCompletions: {} };
  feature.renderHeatmap();
  const rebuilt = cellsOf(container).find(c => c.attrs['data-day'] === '2026-09-16');
  assert.notEqual(rebuilt, cell, 'the grid really was rebuilt');
  assert.equal(state.active, rebuilt, 'focus came back to the same day instead of dropping to the page');
  assert.deepEqual(stops(container), ['2026-09-16']);
});
