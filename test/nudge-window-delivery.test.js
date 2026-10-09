'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createNudgeCornerWindow, createNudgeFullscreenWindow } = require('../src/platform/electron/windows/nudge-window');

function createHarness() {
  const instances = [];
  class FakeWindow {
    constructor(options) {
      this.options = options;
      this.visible = false;
      this.destroyed = false;
      this.webContents = new EventEmitter();
      this.webContents.setWindowOpenHandler = () => {};
      this.webContents.isDestroyed = () => this.destroyed;
      this.webContents.send = () => {};
      instances.push(this);
    }
    setIgnoreMouseEvents() {}
    setVisibleOnAllWorkspaces() {}
    isDestroyed() { return this.destroyed; }
    isVisible() { return this.visible; }
    loadFile() {}
    showInactive() { this.visible = true; }
    show() { this.visible = true; }
    focus() {}
    close() { this.destroyed = true; this.visible = false; }
  }
  return { BrowserWindow: FakeWindow, instances };
}

for (const kind of ['corner', 'fullscreen']) {
  test(`${kind} adapter exposes actual hardened visibility and retains guarded renderer delivery`, () => {
    const harness = createHarness();
    const ready = [];
    const create = kind === 'corner' ? createNudgeCornerWindow : createNudgeFullscreenWindow;
    const host = create({
      BrowserWindow: harness.BrowserWindow,
      preloadPath: '/fixture/preload-nudge.js',
      pagePath: '/fixture/nudge.html',
      corner: 'br',
      bounds: { x: 0, y: 0, width: 340, height: 170 },
      workArea: { x: 0, y: 0, width: 1024, height: 768 },
      onReady: api => ready.push(api)
    });
    const native = harness.instances[0];
    assert.equal(host.isVisible(), false);
    native.webContents.emit('did-finish-load');
    assert.deepEqual(ready, [host]);
    assert.equal(host.isVisible(), false);
    assert.equal(host.send('nudge:init', { instanceId: 'fixture' }), true);
    if (kind === 'corner') host.showInactive();
    else host.showAndFocus();
    assert.equal(host.isVisible(), true);
    native.webContents.send = () => { throw new Error('renderer delivery failed'); };
    assert.equal(host.send('nudge:init', {}), false);
    host.close();
    assert.equal(host.isAlive(), false);
    assert.equal(host.isVisible(), false);
    assert.equal(host.send('nudge:init', {}), false);
    assert.equal(Object.hasOwn(host, 'nativeWindow'), false);
    assert.equal(native.options.webPreferences.contextIsolation, true);
    assert.equal(native.options.webPreferences.nodeIntegration, false);
    assert.equal(native.options.webPreferences.sandbox, true);
  });
}
