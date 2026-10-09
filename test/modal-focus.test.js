'use strict';

// 弹层的焦点：陷阱要按“Tab 真正会停的地方”算。漫游 tabindex 的缩略图（tabindex="-1"）只能用方向键到达，
// 如果把它们也算进可聚焦清单，陷阱会以为“下一个还在弹层里”而放行，浏览器却直接跳出弹层。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');

function el(name, { tabindex = null, disabled = false, hidden = false, inCollapsed = false } = {}) {
  const node = {
    name, disabled, isConnected: true,
    querySelector: () => null,
    getAttribute: key => (key === 'tabindex' ? tabindex : null),
    closest: selector => {
      if (selector === '.hidden') return hidden ? node : null;
      if (selector === 'details:not([open])') return inCollapsed ? node : null;
      return null;
    },
    focus() { global.document.activeElement = node; }
  };
  return node;
}

async function primitive(items) {
  const { createPopoverModalPrimitive } = await import(pathToFileURL(path.join(ROOT, 'src/surfaces/popover/ui/modal.mjs')).href);
  const container = { querySelectorAll(selector) { this.selector = selector; return items; } };
  return { prim: createPopoverModalPrimitive({ $: () => container, $$: () => [] }), container };
}

test('the trap list contains only what Tab can actually reach', async () => {
  const close = el('close');
  const current = el('thumb-current', { tabindex: '0' });
  const roving = Array.from({ length: 6 }, (_unused, index) => el(`thumb-${index}`, { tabindex: '-1' }));
  const disabled = el('apply', { disabled: true });
  const hiddenOne = el('hidden', { hidden: true });
  const folded = el('folded', { inCollapsed: true });
  const { prim, container } = await primitive([close, current, ...roving, disabled, hiddenOne, folded]);
  assert.deepEqual(prim.focusable(container).map(node => node.name), ['close', 'thumb-current']);
});

test('Tab from the last real stop wraps to the first, even when roving thumbs sit in between', async () => {
  const close = el('close');
  const current = el('thumb-current', { tabindex: '0' });
  const roving = Array.from({ length: 10 }, (_unused, index) => el(`thumb-${index}`, { tabindex: '-1' }));
  const { prim, container } = await primitive([close, current, ...roving]);
  global.document = { activeElement: current };
  const event = { key: 'Tab', shiftKey: false, prevented: false, preventDefault() { this.prevented = true; } };
  prim.trapFocusWithin(event, container);
  assert.equal(event.prevented, true, 'the trap must take over here — the browser would step out of the dialog');
  assert.equal(global.document.activeElement, close);

  // 反方向：从第一个往回，绕到最后一个真正能停的地方，而不是某个 -1 的缩略图。
  global.document.activeElement = close;
  const back = { key: 'Tab', shiftKey: true, prevented: false, preventDefault() { this.prevented = true; } };
  prim.trapFocusWithin(back, container);
  assert.equal(global.document.activeElement, current);
  delete global.document;
});

test('when the focus is on a roving thumb reached by arrow keys, Tab is pulled back to a real stop', async () => {
  const close = el('close');
  const current = el('thumb-current', { tabindex: '0' });
  const other = el('thumb-3', { tabindex: '-1' });
  const { prim, container } = await primitive([close, current, other]);
  global.document = { activeElement: other };
  const event = { key: 'Tab', shiftKey: false, prevented: false, preventDefault() { this.prevented = true; } };
  prim.trapFocusWithin(event, container);
  assert.equal(event.prevented, true);
  assert.equal(global.document.activeElement, close);
  delete global.document;
});

test('closed disclosure summaries remain in the tab ring while hidden content stays out', async () => {
  const close = el('close'), summary = el('record-details'), content = el('record-link'), confirm = el('confirm');
  const details = { open: false, querySelector: () => summary };
  summary.contains = node => node === summary;
  const collapsed = selector => selector === 'details:not([open])' && !details.open ? details : null;
  summary.closest = content.closest = collapsed;
  const { prim, container } = await primitive([close, summary, content, confirm]);
  assert.deepEqual(prim.focusable(container).map(node => node.name), ['close', 'record-details', 'confirm']);
  assert.match(container.selector, /details > summary:first-of-type/);
  global.document = { activeElement: summary };
  try {
    for (const shiftKey of [false, true]) {
      const event = { key: 'Tab', shiftKey, prevented: false, preventDefault() { this.prevented = true; } };
      prim.trapFocusWithin(event, container);
      assert.equal(event.prevented, false, 'the browser may move naturally to the neighboring control');
    }
    details.open = true;
    assert.deepEqual(prim.focusable(container).map(node => node.name), ['close', 'record-details', 'record-link', 'confirm']);
    for (const key of ['Enter', ' ', 'Escape']) {
      prim.trapFocusWithin({ key, preventDefault() { assert.fail(`${key} belongs to native disclosure or dialog handling`); } }, container);
    }
  } finally { delete global.document; }
});

test('a disclosure summary inside another closed disclosure is still hidden', async () => {
  const outerSummary = el('outer'), innerSummary = el('inner');
  outerSummary.contains = node => node === outerSummary;
  innerSummary.contains = node => node === innerSummary;
  const outer = { querySelector: () => outerSummary };
  const inner = { querySelector: () => innerSummary, parentElement: { closest: () => outer } };
  outerSummary.closest = selector => selector === 'details:not([open])' ? outer : null;
  innerSummary.closest = selector => selector === 'details:not([open])' ? inner : null;
  const { prim, container } = await primitive([outerSummary, innerSummary]);
  assert.deepEqual(prim.focusable(container).map(node => node.name), ['outer']);
});

test('the settings drawer only focuses the motion control when it is actually visible', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src/surfaces/popover/features/settings-drawer.mjs'), 'utf8');
  const open = source.slice(source.indexOf('function openSettingsDrawer'), source.indexOf('function closeSettingsDrawer'));
  assert.match(open, /preferred\.offsetParent !== null/);
  assert.match(open, /closest\('details:not\(\[open\]\)'\)/);
  assert.match(open, /\$\('#btnSettingsClose'\)\)\.focus\(\)/, 'falls back to the close button, which is always reachable');
  assert.doesNotMatch(open, /\(\$\('#settingsDrawer \.motion-mode'\) \|\| \$\('#btnSettingsClose'\)\)\.focus\(\)/, 'the old form focused a hidden control and silently did nothing');
});
