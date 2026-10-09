import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { orbitPointAtProgress } from '../src/surfaces/pet/session-orbit-geometry.mjs';
import { createSessionOrbit, PHASES, SESSION_ORBIT_BOUNDS } from '../src/surfaces/pet/session-orbit.mjs';
function element() {
  const classes = new Set(), listeners = new Map();
  return { dataset: {}, attributes: {}, writes: 0,
    classList: { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value) },
    setAttribute(name, value) { this.attributes[name] = String(value); this.writes++; },
    removeAttribute(name) { delete this.attributes[name]; this.writes++; },
    addEventListener(name, callback) { listeners.set(name, callback); },
    removeEventListener(name, callback) { if (listeners.get(name) === callback) listeners.delete(name); },
    dispatch(name) { listeners.get(name)?.({ stopPropagation() {} }); }, listeners };
}
const display = (changes = {}) => ({ sessionId: 'a', kind: 'focus', mode: 'focus', phase: 'focus', reason: null,
  plannedMs: 120000, elapsedMs: 58000, running: true, ...changes });
function fixture() {
  const nodes = Object.fromEntries(['stage', 'sessionOrbit', 'sessionOrbitArc', 'sessionOrbitStar', 'sessionStatus', 'sessionStatusIcon'].map(id => [id, element()]));
  let at = 0, calm = false, hidden = false, opened = 0;
  const orbit = createSessionOrbit({ document: { getElementById: id => nodes[id] }, now: () => at,
    isCalm: () => calm, isHidden: () => hidden, openPanel: () => { opened++; } });
  return { orbit, ...nodes, setTime: value => { at = value; }, calm: value => { calm = value; }, hidden: value => { hidden = value; }, opened: () => opened,
    offset: () => Number(nodes.sessionOrbitArc.attributes['stroke-dashoffset']) };
}
test('native status button exposes every distinct phase without visible text or settlement', async () => {
  const f = fixture();
  assert.equal(f.sessionStatus.attributes.tabindex, '-1');
  for (const phase of Object.keys(PHASES)) {
    f.orbit.sync(display({ phase, running: false, ...(phase === 'complete' ? { plannedMs: 0, elapsedMs: 0 } : {}) }));
    assert.equal(f.stage.dataset.sessionPhase, phase);
    assert.equal(f.sessionStatusIcon.attributes.d, PHASES[phase].icon);
    assert.match(f.sessionStatus.attributes['aria-label'], new RegExp(PHASES[phase].label));
    assert.equal(f.sessionStatus.attributes.tabindex, '0');
    f.sessionStatus.dispatch('click'); await Promise.resolve();
  }
  assert.equal(f.opened(), 7);
  assert.doesNotMatch(f.sessionStatus.attributes.title, /0:00/);
  f.orbit.sync(null); f.sessionStatus.dispatch('click'); await Promise.resolve();
  assert.equal(f.opened(), 7); assert.equal(f.sessionStatus.attributes.tabindex, '-1');
  assert.equal(f.sessionStatus.attributes['aria-hidden'], 'true');
  assert.equal(f.sessionStatusIcon.attributes.d, undefined); assert.equal(f.stage.dataset.sessionPhase, undefined);
  assert.equal(f.sessionOrbitStar.attributes.transform, undefined); assert.equal(f.offset(), 100);
});
test('same running anchor deduplicates interpolation; replacements and large corrections reanchor', () => {
  const f = fixture(); f.orbit.sync(display());
  f.setTime(1000); f.orbit.render(); assert.ok(Math.abs(f.offset() - 50.83) < .01);
  f.orbit.sync(display({ elapsedMs: 58500 })); assert.ok(Math.abs(f.offset() - 50.83) < .01);
  f.orbit.sync(display({ elapsedMs: 10000 })); assert.ok(Math.abs(f.offset() - 91.67) < .01);
  f.orbit.sync(display({ sessionId: 'b', elapsedMs: 11000 })); assert.ok(Math.abs(f.offset() - 90.83) < .01);
  f.orbit.sync(display({ sessionId: 'b', kind: 'quick-start', elapsedMs: 12000 })); assert.equal(f.offset(), 90);
  f.orbit.sync(display({ sessionId: 'b', mode: 'break', phase: 'break', elapsedMs: 13000 })); assert.ok(Math.abs(f.offset() - 89.17) < .01);
});
test('paused canonical 58 to 59 seconds is never swallowed; confirm accepts the exact full anchor', () => {
  const f = fixture(); f.calm(true);
  f.orbit.sync(display({ phase: 'paused', running: false })); const first = f.offset();
  f.setTime(5000); f.orbit.sync(display({ phase: 'paused', running: false, elapsedMs: 59000 }));
  assert.ok(f.offset() < first); assert.match(f.sessionStatus.attributes.title, /1:01/);
  f.setTime(20000); f.orbit.render(); assert.match(f.sessionStatus.attributes.title, /1:01/);
  f.orbit.sync(display({ phase: 'confirm', running: false, elapsedMs: 120000 })); assert.equal(f.offset(), 0);
  assert.match(f.sessionStatus.attributes.title, /0:00/);
});
test('calm initial, repeated canonical updates and frame progress stay on 30-second steps', () => {
  const f = fixture(); f.calm(true); f.orbit.sync(display()); assert.equal(f.offset(), 75);
  f.setTime(1000); f.orbit.sync(display({ elapsedMs: 59000 })); assert.equal(f.offset(), 75);
  f.setTime(2000); f.orbit.render(); assert.equal(f.offset(), 50);
  const writes = f.sessionOrbitArc.writes;
  f.setTime(3000); f.orbit.render(); assert.equal(f.sessionOrbitArc.writes, writes);
  f.calm(false); f.orbit.render(); assert.notEqual(f.offset(), 50);
  f.calm(true); f.orbit.render(); assert.equal(f.offset(), 50);
});
test('hidden status has no focus or writes; elapsed completion never settles or invents a pending decision', async () => {
  const f = fixture(); f.orbit.sync(display()); const star = f.sessionOrbitStar.attributes.transform;
  f.hidden(true); f.orbit.render(); const writes = f.sessionOrbitStar.writes;
  f.setTime(600000); f.orbit.render(); f.sessionStatus.dispatch('click'); await Promise.resolve();
  assert.equal(f.opened(), 0); assert.equal(f.sessionStatus.attributes.tabindex, '-1');
  assert.equal(f.sessionOrbitStar.attributes.transform, star); assert.equal(f.sessionOrbitStar.writes, writes);
  f.hidden(false); f.orbit.render(); assert.equal(f.offset(), 0);
  assert.equal(f.stage.dataset.sessionPhase, 'focus');
  f.orbit.sync(display({ phase: 'complete', plannedMs: 0, elapsedMs: 0, running: false }));
  assert.equal(f.stage.dataset.sessionPhase, 'complete');
  f.orbit.dispose(); f.orbit.sync(display()); f.orbit.render(); f.sessionStatus.dispatch('click');
  assert.equal(f.sessionStatus.listeners.size, 0); assert.equal(f.sessionStatus.attributes.tabindex, '-1');
  assert.equal(f.stage.dataset.sessionPhase, undefined);
});
test('malformed display fails closed and never writes NaN geometry', () => {
  const f = fixture();
  for (const value of [null, {}, display({ phase: '__proto__' }), display({ plannedMs: Infinity }), display({ plannedMs: 0 })]) {
    f.orbit.sync(value); assert.equal(f.sessionStatus.attributes.tabindex, '-1');
  }
  for (const elapsedMs of [-3, NaN, Infinity]) {
    f.orbit.sync(display({ elapsedMs })); assert.equal(f.offset(), 100);
  }
});
test('default orbit and footer proxy stay within unchanged 220 geometry; one native button and decorative track', () => {
  const b = SESSION_ORBIT_BOUNDS;
  assert.ok(b.left >= 0 && b.top >= 0 && b.left + b.width <= 220 && b.top + b.height <= 220);
  assert.ok(b.top + b.height < 184);
  const html = fs.readFileSync(new URL('../src/renderer/pet.html', import.meta.url), 'utf8');
  assert.match(html, /<button type="button" class="session-status" id="sessionStatus" aria-hidden="true" tabindex="-1">/);
  assert.match(html, /<div class="session-orbit" id="sessionOrbit" aria-hidden="true">/);
  for (const id of ['sessionStatus', 'sessionStatusIcon', 'sessionOrbit', 'sessionOrbitStar']) assert.equal(html.split(`id="${id}"`).length, 2);
  const css = fs.readFileSync(new URL('../src/surfaces/pet/session-orbit.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /@keyframes|animation:\s*[^\s][^;]*[0-9]s/);
  assert.match(css, /\[data-session-display="canonical"\] \.focus-ring \{ display: none/);
});

test('star tracks the SVG ellipse path-length endpoint between quarter turns', () => {
  // Independent dense trapezoidal integration of the analytic ellipse speed,
  // rather than reusing the production chord lookup or the old angle formula.
  const steps = 100000, delta = Math.PI * 2 / steps, samples = [0];
  const speed = angle => Math.hypot(56 * Math.cos(angle), 11 * Math.sin(angle));
  let total = 0, previous = speed(0);
  for (let i = 1; i <= steps; i++) {
    const current = speed(i * delta); total += (previous + current) * delta / 2;
    samples.push(total); previous = current;
  }
  for (const fraction of [.001, .05, .125, .2, .25, .375, .5, .625, .75, .875, .95, .999]) {
    const target = total * fraction;
    let i = samples.findIndex(value => value >= target);
    const angle = (i - 1 + (target - samples[i - 1]) / (samples[i] - samples[i - 1])) * delta;
    const expected = { x: 62 + 56 * Math.sin(angle), y: 15 - 11 * Math.cos(angle) };
    const actual = orbitPointAtProgress(fraction);
    const cssDistance = Math.hypot((actual.x - expected.x) * 120 / 124, (actual.y - expected.y) * 26 / 30);
    assert.ok(cssDistance < .01, `${fraction}: star/arc gap ${cssDistance}`);
    const f = fixture(); f.orbit.sync(display({ plannedMs: 100000, elapsedMs: fraction * 100000, running: false }));
    assert.equal(f.sessionOrbitStar.attributes.transform, `translate(${actual.x} ${actual.y})`);
  }
  for (const fraction of [-1, 0, NaN, 1, 2]) {
    const p = orbitPointAtProgress(fraction); assert.ok(Math.hypot(p.x - 62, p.y - 4) < 1e-10);
  }
});
