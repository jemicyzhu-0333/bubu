const test = require('node:test');
const assert = require('node:assert/strict');
const { createChromeMotion } = require('../src/surfaces/popover/ui/chrome-motion.mjs');
const { energyPath } = require('../src/surfaces/popover/ui/energy-path.mjs');
test('curve interpolation passes through the supplied values without overshooting', () => {
  const levels = [20,90,10,80];
  const path = energyPath(levels,400,100);
  assert.match(path, /^M0,80 C50,80 50,9/);
  const lastPoint = path.split(' ').at(-1).split(',').map(Number);
  assert.equal(lastPoint[0],400);
  assert.ok(Math.abs(lastPoint[1]-20)<1e-10);
  assert.deepEqual(levels,[20,90,10,80]);
  const controls = [...path.matchAll(/C[\d.]+,([\d.]+) [\d.]+,([\d.]+) [\d.]+,([\d.]+)/g)];
  assert.equal(controls.length,4);
  controls.forEach(([, ...heights]) => heights.forEach(height => assert.ok(+height >= 0 && +height <= 90)));
  assert.equal(energyPath([]),'');
});
test('header and collection controls animate their own glyph and remove all listeners on disposal', () => {
  const variants = ['bell','settings','capture','companion','form','wardrobe','food','journey'];
  const buttons = variants.map(variant => ({ dataset: { feedback: variant }, icon: {}, events: new Map(),
    querySelector() { return this.icon; }, addEventListener(name,fn) { this.events.set(name,fn); },
    removeEventListener(name) { this.events.delete(name); }
  }));
  const calls=[];
  const motion = createChromeMotion({ querySelectorAll: () => buttons }, {
    motion: { feedback: (...args) => calls.push(args), dispose() {} }
  });
  motion.mount();
  buttons.forEach(button => { button.events.get('focus')(); button.events.get('click')(); });
  assert.equal(calls.length,16);
  buttons.forEach((button,i) => {
    assert.deepEqual(calls[i*2],[button.icon,variants[i],false]);
    assert.deepEqual(calls[i*2+1],[button.icon,variants[i],true]);
  });
  motion.dispose();
  assert.ok(buttons.every(button=>button.events.size===0));
});
