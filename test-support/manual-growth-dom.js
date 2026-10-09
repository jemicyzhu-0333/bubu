'use strict';
function element(id = '') {
  const listeners = new Map(), classes = new Set();
  return { id, dataset: {}, style: { setProperty() {} }, attributes: {}, children: [], value: '', checked: false, disabled: false,
    textContent: '', innerHTML: '', open: false, focusCount: 0,
    classList: { add: (...items) => items.forEach(item => classes.add(item)), remove: (...items) => items.forEach(item => classes.delete(item)),
      contains: item => classes.has(item), toggle(item, force) { const on = force ?? !classes.has(item); if (on) classes.add(item); else classes.delete(item); return on; } },
    setAttribute(key, value) { this.attributes[key] = value; },
    append(...nodes) { this.children.push(...nodes); }, appendChild(node) { this.children.push(node); },
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    async emit(type, event = {}) { for (const fn of listeners.get(type) || []) await fn({ target: this, stopPropagation() {}, ...event }); },
    focus() { this.focusCount++; }, closest() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; }
  };
}
function dom() {
  const nodes = new Map();
  const $ = id => { const key = id.startsWith('#') ? id.slice(1) : id; if (!nodes.has(key)) nodes.set(key, element(key)); return nodes.get(key); };
  const document = { body: element('body'), activeElement: null, getElementById: $, querySelector: $, createElement: () => element() };
  return { $, document, nodes };
}
module.exports = { element, dom };
