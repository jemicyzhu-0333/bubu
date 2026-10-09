const test = require('node:test');
const assert = require('node:assert/strict');
const { createMoodDock } = require('../src/surfaces/popover/ui/mood-dock.mjs');

function fixture() {
  function node() {
    const events = new Map();
    return { styles: {}, classes: new Set(),
      style: { setProperty(key, value) { this[key] = value; } },
      classList: { toggle() {} },
      addEventListener(type, fn) { if (!events.has(type)) events.set(type, new Set()); events.get(type).add(fn); },
      removeEventListener(type, fn) { events.get(type)?.delete(fn); },
      emit(type, props = {}) { const event = { button: 0, pointerId: 1, preventDefault() {}, ...props }; events.get(type)?.forEach(fn => fn(event)); },
    };
  }
  const writes = [];
  const host = node();
  const buttons = [0, 1, 2, 3, 4].map(index => ({ ...node(),
    getBoundingClientRect: () => ({ left: index * 50, right: index * 50 + 42, top: 20, bottom: 62 }),
    click: () => writes.push(index), focus() { this.emit('focus'); },
  }));
  const dock = createMoodDock({ host, buttons }); dock.mount();
  return { host, buttons, writes, dock };
}

test('hover and drag preview never save intermediate moods; release commits once', () => {
  const f = fixture();
  f.host.emit('pointermove', { clientX: 20, clientY: 40 });
  assert.ok(Number(f.buttons[0].style['--dock-scale']) > 1.29);
  f.host.emit('pointerdown', { clientX: 20, clientY: 40 });
  f.host.emit('pointermove', { clientX: 120, clientY: 40 });
  f.host.emit('pointermove', { clientX: 220, clientY: 40 });
  assert.deepEqual(f.writes, []);
  f.host.emit('pointerup', { clientX: 220, clientY: 40 });
  let blocked = false;
  f.host.emit('click', { detail: 1, stopImmediatePropagation() { blocked = true; } });
  assert.equal(blocked, true);
  assert.deepEqual(f.writes, [4]);
});

test('canceled or out-of-bounds gestures write nothing; keyboard arrows remain usable', () => {
  const f = fixture();
  f.host.emit('pointerdown', { clientX: 20, clientY: 40 });
  f.host.emit('pointercancel');
  f.host.emit('pointerup', { clientX: 220, clientY: 40 });
  f.host.emit('pointerdown', { clientX: 20, clientY: 40 });
  f.host.emit('pointerup', { clientX: 500, clientY: 40 });
  assert.deepEqual(f.writes, []);
  f.buttons[1].emit('keydown', { key: 'ArrowRight' });
  assert.deepEqual(f.writes, [2]);
});

test('mount and dispose do not accumulate pointer or keyboard listeners', () => {
  const f = fixture(); f.dock.mount(); f.dock.dispose(); f.dock.dispose();
  f.buttons[1].emit('keydown', { key: 'ArrowRight' });
  assert.deepEqual(f.writes, []);
  f.dock.mount(); f.buttons[1].emit('keydown', { key: 'ArrowRight' });
  assert.deepEqual(f.writes, [2]);
});
