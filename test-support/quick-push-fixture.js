'use strict';
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const ROOT = path.resolve(__dirname, '..');
const { buildQuickPanelView } = require(path.join(ROOT, 'src/application/queries/quick-panel-view'));
const settle = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function element(tagName = 'DIV') {
  const node = { tagName, value: '', textContent: '', dataset: {}, style: {}, classes: new Set(), attributes: {}, listeners: {}, children: [], focused: false,
    classList: {
      toggle(name, on) { if (on === undefined ? !node.classes.has(name) : on) node.classes.add(name); else node.classes.delete(name); },
      add: name => node.classes.add(name), remove: name => node.classes.delete(name), contains: name => node.classes.has(name)
    },
    setAttribute(name, value) { node.attributes[name] = String(value); }, getAttribute: name => node.attributes[name],
    addEventListener(type, fn) { (node.listeners[type] ||= []).push(fn); },
    removeEventListener(type, fn) { node.listeners[type] = (node.listeners[type] || []).filter(item => item !== fn); },
    append(...items) { node.children.push(...items); }, appendChild(item) { node.children.push(item); return item; },
    replaceChildren(...items) { node.children = items; },
    querySelector(selector) { const stack = [...node.children]; while (stack.length) { const child = stack.shift(); if (child.tagName?.toLowerCase() === selector) return child; stack.push(...(child.children || [])); } return null; },
    querySelectorAll() { return []; }, focus() { node.focused = true; }, blur() { node.focused = false; }
  }; return node;
}
function fakeDocument() {
  const nodes = new Map(), listeners = {};
  return { nodes, listeners, body: element('BODY'), createElement: tag => element(tag.toUpperCase()),
    querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, element(selector.includes('Input') ? 'INPUT' : 'DIV')); return nodes.get(selector); },
    querySelectorAll() { return []; },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    removeEventListener(type, fn) { listeners[type] = (listeners[type] || []).filter(item => item !== fn); },
    press(event) { const e = { preventDefault() {}, stopPropagation() {}, ...event }; for (const fn of listeners.keydown || []) fn(e); }
  };
}
const canonicalTask = (extra = {}) => ({ id: 'task-a', title: 'Synthetic title', description: '', nextAction: null, steps: [], ...extra });
function idle({ version = 1, title = 'Synthetic title', ready = false } = {}) {
  const task = canonicalTask({ title, updatedAt: version, nextAction: ready ? 'Open notes' : null });
  return buildQuickPanelView({ tasks: [task], now: 1000, startState: {}, pomodoro: {}, focusMinutes: { chosen: 25 }, recommendations: { candidates: [{ task }] } });
}
function active({ sessionId = 'session-a', kind = 'focus', paused = false, held = false, done = false, disabledReason = null } = {}) {
  const task = canonicalTask({ nextAction: 'Open notes', done, steps: [{ id: 'step-a', title: 'Open notes', done: false }] });
  const resumeAction = paused ? { sessionId, intent: held ? 'confirm-completion' : 'resume', enabled: !disabledReason, reason: disabledReason } : null;
  return buildQuickPanelView({ tasks: [task], pomodoro: { sessionId, taskId: task.id, kind, paused, running: !paused, elapsedMs: 1000,
    remainingMs: held ? 0 : 100000, awaitingOfflineConfirmation: held, recoveryReason: held ? 'offline-due' : null, resumeAction }, focusMinutes: { chosen: 25 } });
}
const push = (revision, quickPanel) => ({ revision, dirty: { pomodoro: true }, delta: { quickPanel } });
function emit(node, type) { for (const fn of node.listeners[type] || []) fn({ preventDefault() {} }); }
async function harness(t, { initial = idle(), getState, client: overrides = {}, deferTimeouts = false } = {}) {
  const { createQuickPanelFeature } = await import(pathToFileURL(path.join(ROOT, 'src/surfaces/impulse/quick-panel.mjs')).href);
  const document = fakeDocument(), calls = [], frames = [], timers = [], events = new Map(); let reads = 0, onDiff;
  const window = { performance: { now: () => 0 }, navigator: { platform: 'Linux' },
    requestAnimationFrame: fn => { frames.push(fn); return frames.length; }, setInterval: () => 1, clearInterval() {},
    setTimeout: fn => { if (deferTimeouts) timers.push(fn); else fn(); },
    addEventListener(name, fn) { events.set(name, fn); }, removeEventListener(name) { events.delete(name); } };
  const succeed = name => async (...args) => { calls.push([name, ...args]); return { ok: true }; };
  const client = { getState: () => { reads++; return getState ? getState(reads) : Promise.resolve({ revision: 1, quickPanel: initial }); },
    addImpulse: succeed('capture'), kickstart: succeed('start'), completeStep: succeed('step'), completeTask: succeed('complete'),
    appendTaskStep: succeed('append'), renameTaskStep: succeed('rename'), pausePomodoro: succeed('pause'), resumePomodoro: succeed('resume'),
    stopPomodoro: succeed('stop'), hideImpulse: succeed('hide'),
    onStateDiff: fn => { onDiff = fn; return () => {}; }, onSensoryProfile: () => () => {}, ...overrides };
  const feature = createQuickPanelFeature({ window, document, client }); feature.mount(); t.after(() => feature.dispose()); await settle();
  const $ = selector => document.querySelector(selector);
  return { feature, document, window, client, calls, frames, timers, events, $, reads: () => reads, diff: message => onDiff(message),
    open() { emit($('#quickCandidates').children[0], 'click'); }, submit() { emit($('#quickStartForm'), 'submit'); },
    cancel() { emit($('#quickStartCancel'), 'click'); }, capture() { emit($('#impulseForm'), 'submit'); },
    flushFrames() { frames.splice(0).forEach(fn => fn()); }, flushTimers() { timers.splice(0).forEach(fn => fn()); } };
}
module.exports = { ROOT, harness, deferred, settle, idle, active, push, emit };
