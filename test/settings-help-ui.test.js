'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHelpTooltips } = require('../src/surfaces/popover/ui/help-tooltips.mjs');
const { setLocale } = require('../src/surfaces/shared/interface/i18n.mjs');

function fixture() {
  const events = new Map(), windowEvents = new Map();
  const attrs = new Map([['aria-describedby', 'existing-help'], ['aria-expanded', 'false']]);
  const paragraphs = [{ dataset: { i18n: '工作时间用在哪' }, textContent: '工作时间用在哪' },
    { textContent: 'user text <script> 设置', childNodes: [] }];
  const source = { querySelectorAll: () => paragraphs, querySelector: () => summary };
  const summary = {
    closest: selector => selector === '.inline-help' ? source : null,
    getAttribute: name => attrs.get(name) ?? null,
    setAttribute: (name, value) => attrs.set(name, value), removeAttribute: name => attrs.delete(name),
    getBoundingClientRect: () => ({ left: 50, top: 50, bottom: 74 })
  };
  const popup = { style: {}, textContent: '', offsetWidth: 240, offsetHeight: 100, visible: false,
    setAttribute(name, value) { this[name] = value; }, contains: node => node === popup,
    showPopover() { this.visible = true; }, hidePopover() { this.visible = false; }, remove() { this.removed = true; } };
  const body = { appendChild: node => { node.parent = body; } };
  const document = { body, activeElement: null, createElement: () => popup,
    addEventListener: (name, fn) => events.set(name, fn), removeEventListener: name => events.delete(name),
    defaultView: { innerWidth: 560, innerHeight: 680,
      addEventListener: (name, fn) => windowEvents.set(name, fn), removeEventListener: name => windowEvents.delete(name) } };
  const feature = createHelpTooltips(document); feature.mount();
  const fire = (name, extra = {}) => { const event = { target: summary, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...extra }; events.get(name)?.(event); return event; };
  return { document, popup, summary, attrs, feature, fire, events, windowEvents };
}

test('compact help opens by keyboard and keeps focus while Escape dismisses only the tooltip', () => {
  const h = fixture(); h.document.activeElement = h.summary;
  h.fire('focusin'); assert.equal(h.popup.visible, true); assert.equal(h.popup.role, 'tooltip');
  assert.equal(h.attrs.get('aria-expanded'), 'true');
  assert.equal(h.attrs.get('aria-describedby'), 'existing-help panelHelpTooltip');
  const event = h.fire('keydown', { key: 'Escape' });
  assert.equal(h.popup.visible, false); assert.equal(event.prevented, true); assert.equal(event.stopped, true);
  assert.equal(h.document.activeElement, h.summary);
  assert.equal(h.attrs.get('aria-describedby'), 'existing-help'); assert.equal(h.attrs.get('aria-expanded'), 'false');
  h.feature.dispose();
});

test('click and touch-compatible click open help, blur closes it and disposal releases listeners', () => {
  const h = fixture(); const click = h.fire('click', { pointerType: 'touch' });
  assert.equal(click.prevented, true); assert.equal(h.popup.visible, true);
  h.fire('focusout', { relatedTarget: null }); assert.equal(h.popup.visible, false);
  h.fire('click'); assert.equal(h.popup.visible, true);
  h.feature.dispose(); assert.equal(h.popup.visible, false); assert.equal(h.popup.removed, true);
  assert.equal(h.events.size, 0); assert.equal(h.windowEvents.size, 0);
});

test('focused help stays open after pointer exit and translates explicit copy without changing raw text', async () => {
  setLocale('zh-CN'); const h = fixture(); h.document.activeElement = h.summary; h.fire('focusin');
  h.fire('pointerout'); await new Promise(resolve => setTimeout(resolve, 190));
  assert.equal(h.popup.visible, true);
  setLocale('en'); assert.equal(h.popup.visible, true); assert.match(h.popup.textContent, /How work hours are used/);
  assert.match(h.popup.textContent, /user text <script> 设置/); assert.equal(h.document.activeElement, h.summary);
  h.feature.dispose(); setLocale('zh-CN');
});

test('help glyph is visually compact but keeps a 24px target and accessible labels', () => {
  const root = path.join(__dirname, '..');
  const css = fs.readFileSync(path.join(root, 'src/surfaces/popover/styles/theme.css'), 'utf8');
  assert.match(css, /\.inline-help > summary \{[^}]*width: 24px; height: 24px;/);
  assert.match(css, /\.inline-help > summary::before \{[^}]*width: 14px; height: 14px;/);
  const html = fs.readFileSync(path.join(root, 'src/renderer/popover.html'), 'utf8');
  for (const match of html.matchAll(/<details class="inline-help[^\"]*"><summary([^>]*)>/g)) assert.match(match[1], /aria-label="[^"]+"/);
  assert.doesNotMatch(html, /class="setting-tip/);
});
