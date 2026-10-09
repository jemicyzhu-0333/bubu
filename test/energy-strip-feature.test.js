'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createPopoverEnergyStrip } = require('../src/surfaces/popover/features/energy-strip.mjs');

const ROOT = path.resolve(__dirname, '..');

// No jsdom in this repo, so the host elements are literal stubs that record what the
// feature wrote. Only the members the feature actually touches are present — anything
// it reaches for beyond them throws, which is the point.
function element() {
  const node = {
    innerHTML: '',
    textContent: '',
    dataset: {},
    style: {},
    classes: new Set(),
    attributes: {},
    classList: {
      toggle(name, on) { if (on) node.classes.add(name); else node.classes.delete(name); },
      contains: name => node.classes.has(name)
    },
    setAttribute(name, value) { node.attributes[name] = value; },
    addEventListener(type, handler) { (node.listeners[type] ||= []).push(handler); },
    removeEventListener(type, handler) {
      node.listeners[type] = (node.listeners[type] || []).filter(fn => fn !== handler);
    },
    listeners: {}
  };
  return node;
}

function fixture({ state, adjustments = [] } = {}) {
  const nodes = new Map();
  const $ = selector => {
    if (!nodes.has(selector)) nodes.set(selector, element());
    return nodes.get(selector);
  };
  const chips = ['lower', 'same', 'higher'].map(direction => (
    Object.assign(element(), { dataset: { direction } })
  ));
  const pressed = [];
  const strip = createPopoverEnergyStrip({
    $,
    $$: selector => (selector === '.energy-checkin-btn' ? chips : [$(selector)]),
    getState: () => state,
    surfaceClient: { adjustEnergy: async direction => adjustments.push(direction) },
    // The same escaper the renderer injects (ui/dom.mjs). A looser stub here would let the
    // escaping assertion pass against a module that only half-escapes.
    escapeHTML: value => String(value).replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch])),
    syncPressedButtons: (selector, predicate) => (
      pressed.push(chips.filter(predicate).map(chip => chip.dataset.direction))
    )
  });
  return { strip, $, chips, adjustments, pressed, nodes };
}

const CURVE = {
  dayKey: '2026-09-20',
  sampleMinutes: 15,
  levels: Array.from({ length: 96 }, (_unused, index) => (index < 40 ? 30 : index < 60 ? 55 : 88)),
  nowMinute: 630,
  nowLevel: 55,
  modelLevel: 55,
  trend: 'rising',
  confidence: 'medium',
  calibrated: true,
  observations: 12,
  attribution: [{ source: 'routine', id: 'r-coffee', delta: 9 }, { source: 'check-in', id: null, delta: -4 }],
  marks: [{ minute: 540, id: 'r-coffee', kind: 'stimulant' }]
};

const STATE = {
  energy: { level: 55, band: 'medium', label: { emoji: '☀️', text: '中等' } },
  energyCurve: CURVE,
  routines: { items: [{ id: 'r-coffee', title: '早上那杯咖啡' }], today: [] }
};

test('the reading is stated once and the plot is not drawn when the curve is off', () => {
  // F6 section 9: there used to be a progress bar here as well, fed by
  // currentEnergyEstimate while the curve came from buildEnergyCurve. Two algorithms on
  // one screen eventually disagree, and the user has no way to tell which one is lying.
  const off = fixture({ state: { ...STATE, energyCurve: null } });
  off.strip.render();
  assert.match(off.$('#energyReading').textContent, /中等/);
  assert.match(off.$('#energyReading').textContent, /55/);
  assert.equal(off.$('#energyCurve').classList.contains('hidden'), true);
  assert.equal(off.$('#energyCurvePlot').innerHTML, '', '曲线关掉时不该留下一片上次的柱子');
  assert.equal(off.$('#energyAttribution').classList.contains('hidden'), true,
    '没有曲线就没有归因可说,空着一行比留一行旧解释好');

  // And with the curve on, the reading is still one number — the strip never computes
  // its own; state.energy already carries the curve's reading as its prior.
  const on = fixture({ state: STATE });
  on.strip.render();
  assert.equal(on.$('#energyCurve').classList.contains('hidden'), false);
  assert.match(on.$('#energyCurvePlot').innerHTML, /<svg[^>]+viewBox="0 0 1000 100"/);
  assert.doesNotMatch(on.$('#energyCurvePlot').innerHTML, /<i /);
  assert.equal(on.$('#energyReading').textContent, off.$('#energyReading').textContent);
});

test('the uncertainty of the model is visible without being recomputed here', () => {
  // Section 10: a curve known to be off by 30 points must not be drawn as solid as one
  // that matches. The surface does not judge that — it renders the one word the query
  // layer already decided, so the fading and the sentence can never disagree.
  for (const confidence of ['high', 'medium', 'low']) {
    const view = fixture({ state: { ...STATE, energyCurve: { ...CURVE, confidence } } });
    view.strip.render();
    assert.equal(view.$('#energyCurve').dataset.confidence, confidence);
  }
  const shaky = fixture({ state: { ...STATE, energyCurve: { ...CURVE, confidence: 'low' } } });
  shaky.strip.render();
  assert.match(shaky.$('#energyAttribution').textContent, /数据还少/,
    '画淡只是提示,说出来才是交代');
  const solid = fixture({ state: { ...STATE, energyCurve: { ...CURVE, confidence: 'high' } } });
  solid.strip.render();
  assert.doesNotMatch(solid.$('#energyAttribution').textContent, /数据还少|估算/);
});

test('names are resolved from the routine list rather than carried by the curve', () => {
  // Section 12: the curve crosses the process boundary, so it carries ids and numbers
  // only. If a title were copied in, renaming a routine would leave the old name on the
  // tick until the next full rebuild — and deleting one would leak it forever.
  const view = fixture({ state: STATE });
  view.strip.render();
  assert.match(view.$('#energyCurveMarks').innerHTML, /title="早上那杯咖啡"/);
  assert.match(view.$('#energyAttribution').textContent, /早上那杯咖啡 \+9/);
  assert.match(view.$('#energyAttribution').textContent, /你的自评 −4/,
    '自评那一条没有 routineId,得有自己的说法');

  // Renamed: the same curve, a different list, and the tick follows the list.
  const renamed = fixture({
    state: { ...STATE, routines: { items: [{ id: 'r-coffee', title: '换了个名字' }], today: [] } }
  });
  renamed.strip.render();
  assert.match(renamed.$('#energyCurveMarks').innerHTML, /title="换了个名字"/);

  // Deleted: a mark whose routine is gone still marks the moment, anonymously. Dropping
  // it would make the curve bend with nothing to explain the bend.
  const deleted = fixture({ state: { ...STATE, routines: { items: [], today: [] } } });
  deleted.strip.render();
  assert.match(deleted.$('#energyCurveMarks').innerHTML, /title="一次日常"/);
  assert.match(deleted.$('#energyAttribution').textContent, /日常 \+9/);
});

test('a title with markup in it cannot reach the tick as markup', () => {
  const view = fixture({
    state: { ...STATE, routines: { items: [{ id: 'r-coffee', title: '<img src=x> "喝"' }], today: [] } }
  });
  view.strip.render();
  const html = view.$('#energyCurveMarks').innerHTML;
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img src=x&gt; &quot;喝&quot;/);
});

test('the past half of today is marked as past and the now line is placed on it', () => {
  const view = fixture({ state: STATE });
  view.strip.render();
  const plot = view.$('#energyCurvePlot').innerHTML;
  // nowMinute 630 with 15-minute samples: the first 42 columns have already happened.
  assert.match(plot, /<rect width="437.5" height="100"/);
  assert.match(plot, /energy-forecast/);
  assert.equal(view.$('#energyCurveNow').style.left, `${(630 / 1440) * 100}%`);
  assert.equal(view.$('#energyCurveNow').classList.contains('hidden'), false);

  // A past day has no "now": the line has to go away rather than sit at midnight.
  const past = fixture({ state: { ...STATE, energyCurve: { ...CURVE, nowMinute: null, trend: null } } });
  past.strip.render();
  assert.equal(past.$('#energyCurveNow').classList.contains('hidden'), true);
  assert.match(past.$('#energyCurvePlot').innerHTML, /<rect width="1000"/);
});

test('the smooth trace preserves sample height while relative actions never pretend to be selected state', () => {
  for (const level of [20, 55, 90]) {
    const view = fixture({
      state: {
        ...STATE,
        energy: { level, band: 'x', label: { text: 'x' } },
        energyCurve: { ...CURVE, levels: Array.from({ length: 96 }, () => level) }
      }
    });
    view.strip.render();
    assert.deepEqual(view.pressed.at(-1), [], `level ${level}`);
    assert.match(view.$('#energyCurvePlot').innerHTML, new RegExp(`d="M0,${100 * (1 - level / 100)}`));
  }
});

test('an unchanged projection is not repainted, and a moved curve is', () => {
  const state = { ...STATE };
  const view = fixture({ state });
  view.strip.render();
  view.$('#energyCurvePlot').innerHTML = 'sentinel';
  view.strip.render();
  assert.equal(view.$('#energyCurvePlot').innerHTML, 'sentinel', '同一份投影不该重画');
  // The level alone is not enough of a key: logging a routine reshapes the rest of the
  // day without moving the current reading at all.
  state.energyCurve = { ...CURVE, levels: CURVE.levels.map(level => level + 1) };
  view.strip.render();
  assert.notEqual(view.$('#energyCurvePlot').innerHTML, 'sentinel');
});

test('a relative adjustment is reported once per press and never after disposal', async () => {
  const view = fixture({ state: STATE });
  view.strip.mount();
  view.strip.mount();
  await view.chips[0].listeners.click[0]();
  assert.deepEqual(view.adjustments, ['lower'], 'mount 两次不该绑两遍');
  await view.chips[2].listeners.click[0]();
  assert.deepEqual(view.adjustments, ['lower', 'higher']);
  view.strip.dispose();
  assert.deepEqual(view.chips.map(chip => chip.listeners.click.length), [0, 0, 0]);
});

test('a half-built projection is skipped instead of throwing', () => {
  // The first push can arrive before routines exist, and `levels` is absent whenever the
  // toggle is off. A surface that throws here takes the whole render pass down with it.
  for (const state of [
    null, {}, { energy: null },
    { energy: { level: 40 }, energyCurve: {} },
    { energy: { level: 40 }, energyCurve: { levels: CURVE.levels, marks: null, attribution: null } },
    { energy: { level: 40 }, energyCurve: CURVE }
  ]) {
    const view = fixture({ state });
    assert.doesNotThrow(() => view.strip.render());
  }
});

test('the painter is reusable and keeps its comments in Chinese', () => {
  // Section 11b paints this same curve above the day timeline. paintCurve takes a host
  // and a curve and nothing else — no #energyCurvePlot, no state, no surfaceClient.
  const view = fixture({ state: STATE });
  const host = element();
  view.strip.paintCurve(host, CURVE);
  assert.match(host.innerHTML, /class="energy-line"/);
  assert.doesNotThrow(() => view.strip.paintCurve(null, CURVE));
  assert.doesNotThrow(() => view.strip.paintCurve(host, null));

  const source = fs.readFileSync(path.join(ROOT, 'src/surfaces/popover/features/energy-strip.mjs'), 'utf8');
  assert.match(source, /ARCHITECTURE「日常与能量」/);
  assert.doesNotMatch(source, /require\(/, 'surfaces are ESM on file://');
  assert.match(source.split('\n').filter(line => line.trim().startsWith('//')).join('\n'), /[一-龥]/);
});

// ---- 今天几点起的（schema 11） ----
function wakeFixture(state) {
  const nodes = new Map();
  const $ = selector => {
    if (!nodes.has(selector)) nodes.set(selector, Object.assign(element(), { open: false }));
    return nodes.get(selector);
  };
  const buttons = [
    ['360', '6点'], ['540', '9点'], ['skip', '跳过']
  ].map(([minutes]) => Object.assign(element(), { dataset: { minutes } }));
  const calls = [];
  const strip = createPopoverEnergyStrip({
    $,
    $$: selector => (selector === '.energy-wake-btn' ? buttons : []),
    getState: () => state,
    surfaceClient: { setWakeTime: async minutes => { calls.push(minutes); } },
    escapeHTML: value => String(value),
    syncPressedButtons: () => {}
  });
  return { strip, $, buttons, calls };
}

const BASE_ENERGY = { level: 55, band: 'medium', label: { text: '中等' } };

test('the wake question follows the day without opening supplementary context', () => {
  const state = { energy: BASE_ENERGY, wake: { dayKey: '2026-09-29', ask: true, minutes: null } };
  const { strip, $ } = wakeFixture(state);
  strip.render();
  assert.equal($('#energyWake').classList.contains('hidden'), false);
  assert.equal($('#energyStrip').open, false, 'supplementary context does not interrupt the current action');

  $('#energyStrip').open = false;          // the person folds it away
  strip.render();
  assert.equal($('#energyStrip').open, false, 'it must not fight the person the same day');

  state.wake = { dayKey: '2026-09-29', ask: false, minutes: 540 };
  strip.render();
  assert.equal($('#energyWake').classList.contains('hidden'), true, 'answered or skipped: never asked twice');

  state.wake = { dayKey: '2026-09-30', ask: true, minutes: null };
  strip.render();
  assert.equal($('#energyStrip').open, false, 'a new day preserves the disclosure choice');
  $('#energyStrip').open = true;
  strip.render();
  assert.equal($('#energyStrip').open, true, 'render also preserves an explicitly opened block');
});

test('wake buttons send whole minutes, and skip sends null', async () => {
  const { strip, buttons, calls } = wakeFixture({ energy: BASE_ENERGY, wake: { dayKey: 'd', ask: true, minutes: null } });
  strip.mount();
  for (const button of buttons) for (const handler of button.listeners.click) await handler();
  assert.deepEqual(calls, [360, 540, null]);
});
