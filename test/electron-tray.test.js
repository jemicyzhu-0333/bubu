'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTrayHost } = require('../src/platform/electron');
const { decodePNG } = require('../scripts/app-icon-png');

const PALETTE = Object.freeze({
  1: '#1a1b26',
  2: '#f7768e',
  3: '#c53b53',
  4: '#1a1b26'
});

function createTrayHarness() {
  const calls = [];
  const images = [];
  let nativeTray;

  const nativeImage = {
    createFromBuffer(buffer) {
      const image = {
        buffer,
        representations: [],
        isEmpty() { return false; },
        getScaleFactors() { return [1, ...this.representations.map(item => item.scaleFactor)]; },
        setTemplateImage(value) { this.template = value; },
        addRepresentation(representation) {
          this.representations.push(representation);
        }
      };
      images.push(image);
      return image;
    }
  };
  const Menu = {
    buildFromTemplate(template) {
      calls.push(['build-menu', template]);
      return { template };
    }
  };
  class Tray {
    constructor(image) {
      this.image = image;
      this.bounds = { x: 120, y: 8, width: 22, height: 22 };
      this.listeners = new Map();
      this.destroyed = false;
      nativeTray = this;
      calls.push(['construct', image]);
    }

    setToolTip(value) { calls.push(['tooltip', value]); }
    on(event, listener) { this.listeners.set(event, listener); }
    removeListener(event, listener) {
      calls.push(['remove-listener', event]);
      if (this.listeners.get(event) === listener) this.listeners.delete(event);
    }
    getBounds() { return this.bounds; }
    setImage(image) { this.image = image; calls.push(['image', image]); }
    setTitle(value) { calls.push(['title', value]); }
    popUpContextMenu(menu) { calls.push(['menu', menu]); }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; calls.push(['destroy']); }
  }

  return { calls, images, Menu, nativeImage, Tray, get nativeTray() { return nativeTray; } };
}

function createHost(harness, overrides = {}) {
  return createTrayHost({
    Tray: harness.Tray,
    Menu: harness.Menu,
    nativeImage: harness.nativeImage,
    platform: 'linux',
    initialIcon: { frame: 0, mood: 'idle', palette: PALETTE },
    tooltip: 'ImAdhder',
    onClick: () => {},
    onRightClick: () => {},
    ...overrides
  });
}

test('tray host builds deterministic 1x and 2x pixel icon representations', () => {
  const harness = createTrayHarness();
  const host = createHost(harness);
  const initialImage = harness.images[0];

  assert.equal(decodePNG(initialImage.buffer).width, 22);
  assert.equal(decodePNG(initialImage.buffer).height, 22);
  assert.equal(initialImage.representations.length, 1);
  assert.equal(initialImage.representations[0].scaleFactor, 2);
  assert.equal(decodePNG(initialImage.representations[0].buffer).width, 44);
  assert.equal(decodePNG(initialImage.representations[0].buffer).height, 44);

  assert.equal(host.setIcon({ frame: 7, mood: 'idle', palette: PALETTE }), true);
  assert.notDeepEqual(harness.images[1].buffer, initialImage.buffer);
});

test('tray host exposes copied geometry and materializes menus at the platform edge', () => {
  const harness = createTrayHarness();
  const click = () => {};
  const rightClick = () => {};
  const host = createHost(harness, { onClick: click, onRightClick: rightClick });
  const bounds = host.getBounds();
  const template = [{ label: 'Open', click }];

  assert.equal(Object.isFrozen(bounds), true);
  assert.deepEqual(bounds, { x: 120, y: 8, width: 22, height: 22 });
  harness.nativeTray.bounds.x = 999;
  assert.equal(bounds.x, 120);
  assert.equal(harness.nativeTray.listeners.get('click'), click);
  assert.equal(harness.nativeTray.listeners.get('right-click'), rightClick);
  assert.equal(host.showMenu(template), true);
  assert.deepEqual(harness.calls.at(-2), ['build-menu', template]);
  assert.deepEqual(harness.calls.at(-1), ['menu', { template }]);
});

test('tray host owns native cleanup and becomes inert after disposal', () => {
  const harness = createTrayHarness();
  const host = createHost(harness);

  assert.equal(host.setTitle(' 24:00'), true);
  assert.equal(host.dispose(), true);
  assert.equal(host.dispose(), false);
  assert.equal(host.setTitle(''), false);
  assert.equal(host.showMenu([]), false);
  assert.equal(host.setIcon({ frame: 0, mood: 'idle', palette: PALETTE }), false);
  assert.deepEqual(
    harness.calls.filter(([kind]) => kind === 'remove-listener' || kind === 'destroy'),
    [['remove-listener', 'click'], ['remove-listener', 'right-click'], ['destroy']]
  );
});

test('tray host rejects malformed platform dependencies and icon inputs', () => {
  const harness = createTrayHarness();
  assert.throws(() => createHost(harness, { Tray: null }), /Tray must be a constructor/);
  assert.throws(() => createHost(harness, { Menu: {} }), /Menu must build/);
  assert.throws(() => createHost(harness, { tooltip: '' }), /tooltip/);
  assert.throws(
    () => createHost(harness, { initialIcon: { frame: 8, mood: 'idle', palette: PALETTE } }),
    /frame/
  );
  assert.throws(
    () => createHost(harness, { initialIcon: { frame: 0, mood: 'focus', palette: { 1: '#fff' } } }),
    /six-digit hex|missing color/
  );
});

test('macOS template flag and Retina representations survive host icon updates', () => {
  const harness = createTrayHarness();
  const host = createHost(harness, { platform: 'darwin' });
  host.setIcon({ frame: 7, mood: 'idle', palette: PALETTE });
  for (const image of harness.images) {
    assert.equal(image.template, true);
    assert.equal(decodePNG(image.buffer).width, 16);
    assert.equal(image.representations[0].scaleFactor, 2);
    assert.equal(decodePNG(image.representations[0].buffer).width, 32);
  }
});
