'use strict';

const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../src/renderer/popover.html'), 'utf8');

// Deliberately a mock DOM, not browser/layout evidence. IDs come from the real
// production markup so missing wiring targets cannot be invented by a fixture.
function createCollaborationDom() {
  const nodes = {};
  const listeners = new Map();
  const document = { activeElement: null };
  for (const match of html.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const selector = `#${match[1]}`;
    const names = new Set((match[0].match(/class="([^"]+)"/)?.[1] || '').split(/\s+/));
    const node = {
      value: '', textContent: '', innerHTML: '', disabled: false, checked: false,
      scrollTop: 0, scrollHeight: 9876, dataset: {}, attributes: {}, focused: 0,
      classList: {
        add(name) { names.add(name); }, remove(name) { names.delete(name); },
        contains(name) { return names.has(name); },
        toggle(name, on) { if (on) names.add(name); else names.delete(name); }
      },
      setAttribute(name, value) { this.attributes[name] = value; },
      getAttribute(name) { return this.attributes[name]; },
      focus() { this.focused += 1; document.activeElement = this; },
      querySelector() { return null; },
      addEventListener(type, handler) { listeners.set(`${selector}:${type}`, handler); },
      removeEventListener(type) { listeners.delete(`${selector}:${type}`); }
    };
    nodes[selector] = node;
  }
  const $ = selector => nodes[selector] || null;
  const fire = (selector, type, event = {}) => listeners.get(`${selector}:${type}`)?.(event);
  return { nodes, $, document, listeners, fire, html };
}

module.exports = { createCollaborationDom };
