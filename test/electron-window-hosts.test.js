'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const {
  createPopoverWindowHost,
  createImpulseWindowHost,
  createPetWindowHost
} = require('../src/platform/electron/windows');
const { createHardenedWindow, createWindowHost } = require('../src/platform/electron/windows/window-host');

function createWindowHarness({ withShowInactive = true } = {}) {
  const instances = [];

  class FakeContents extends EventEmitter {
    constructor() {
      super();
      this.destroyed = false;
      this.loading = false;
      this.messages = [];
      this.openHandler = null;
    }
    setWindowOpenHandler(handler) { this.openHandler = handler; }
    isDestroyed() { return this.destroyed; }
    isLoading() { return this.loading; }
    isDevToolsOpened() { return false; }
    send(channel, payload) { this.messages.push({ channel, payload }); }
    reload() { this.reloaded = true; }
  }

  class FakeBrowserWindow extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.webContents = new FakeContents();
      this.bounds = {
        x: options.x || 0,
        y: options.y || 0,
        width: options.width,
        height: options.height
      };
      this.visible = false;
      this.destroyed = false;
      this.focusable = options.focusable !== false;
      this.calls = [];
      if (!withShowInactive) this.showInactive = undefined;
      instances.push(this);
    }
    loadFile(pagePath) { this.pagePath = pagePath; }
    isDestroyed() { return this.destroyed; }
    isVisible() { return this.visible; }
    getBounds() { return { ...this.bounds }; }
    setPosition(x, y, animate) {
      this.bounds.x = x;
      this.bounds.y = y;
      this.calls.push(['setPosition', x, y, animate]);
    }
    setSize(width, height, animate) {
      this.bounds.width = width;
      this.bounds.height = height;
      this.calls.push(['setSize', width, height, animate]);
    }
    setBounds(bounds, animate) {
      this.bounds = { ...this.bounds, ...bounds };
      this.calls.push(['setBounds', bounds, animate]);
    }
    setIgnoreMouseEvents(value, options) { this.calls.push(['setIgnoreMouseEvents', value, options]); }
    setResizable(value) { this.calls.push(['setResizable', value]); }
    setFocusable(value) { this.focusable = value; this.calls.push(['setFocusable', value]); }
    setSkipTaskbar(value) { this.calls.push(['setSkipTaskbar', value]); }
    setVisibleOnAllWorkspaces(value, options) {
      this.calls.push(['setVisibleOnAllWorkspaces', value, options]);
    }
    setAlwaysOnTop(value, level) { this.calls.push(['setAlwaysOnTop', value, level]); }
    show() { this.visible = true; this.calls.push(['show']); }
    showInactive() { this.visible = true; this.calls.push(['showInactive']); }
    focus() { this.calls.push(['focus']); }
    hide() { this.visible = false; this.calls.push(['hide']); }
    close() { this.destroyed = true; this.calls.push(['close']); }
  }

  return { BrowserWindow: FakeBrowserWindow, instances };
}

function assertHardened(instance, preloadPath, pagePath) {
  assert.equal(instance.options.webPreferences.preload, preloadPath);
  assert.equal(instance.options.webPreferences.contextIsolation, true);
  assert.equal(instance.options.webPreferences.nodeIntegration, false);
  assert.equal(instance.options.webPreferences.sandbox, true);
  assert.equal(instance.options.webPreferences.webviewTag, false);
  assert.deepEqual(instance.webContents.openHandler(), { action: 'deny' });
  for (const eventName of ['will-navigate', 'will-attach-webview']) {
    let prevented = false;
    instance.webContents.emit(eventName, { preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true, `${eventName} must be blocked`);
  }
  assert.equal(instance.pagePath, pagePath);
}

test('the common host enforces isolation and does not expose the native window', () => {
  const harness = createWindowHarness();
  const host = createHardenedWindow({
    BrowserWindow: harness.BrowserWindow,
    preloadPath: '/app/preload.js',
    pagePath: '/app/page.html',
    options: {
      width: 100,
      height: 80,
      webPreferences: {
        contextIsolation: false,
        nodeIntegration: true,
        sandbox: false,
        webviewTag: true
      }
    }
  });

  const instance = harness.instances[0];
  assertHardened(instance, '/app/preload.js', '/app/page.html');
  assert.equal(Object.prototype.hasOwnProperty.call(host, 'nativeWindow'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(host, 'webContents'), false);
  assert.equal(Object.isFrozen(host), true);
});

test('renderer delivery is best-effort for closed, destroyed and throwing contents', () => {
  const harness = createWindowHarness();
  const instance = new harness.BrowserWindow({ width: 1, height: 1 });
  const errors = [];
  const host = createWindowHost(instance, {
    onDeliveryError: (error, detail) => errors.push([error.message, detail.channel])
  });

  assert.equal(host.send('state:diff', { revision: 1 }), true);
  assert.deepEqual(instance.webContents.messages, [{ channel: 'state:diff', payload: { revision: 1 } }]);
  instance.webContents.send = () => { throw new Error('renderer gone'); };
  assert.equal(host.send('state:diff', { revision: 2 }), false);
  assert.deepEqual(errors, [['renderer gone', 'state:diff']]);
  instance.destroyed = true;
  assert.equal(host.send('state:diff', { revision: 3 }), false);
});

test('popover host owns its security options and blur policy', () => {
  const harness = createWindowHarness();
  const host = createPopoverWindowHost({
    BrowserWindow: harness.BrowserWindow,
    preloadPath: '/app/preload-popover.js',
    pagePath: '/app/popover.html',
    height: 720
  });
  const instance = harness.instances[0];

  assertHardened(instance, '/app/preload-popover.js', '/app/popover.html');
  assert.deepEqual(instance.bounds, { x: 0, y: 0, width: 560, height: 720 });
  assert.equal(instance.options.movable, process.platform !== 'darwin');
  instance.emit('blur');
  assert.equal(instance.calls.filter(call => call[0] === 'hide').length, 1);
  assert.deepEqual(Object.keys(host).sort(), [
    'anchorForOpen', 'close', 'fitToWorkArea', 'getBounds', 'hide', 'isVisible', 'justHiddenByBlur', 'placeForOpen', 'send', 'setPosition', 'showAndFocus'
  ]);
});

test('popover host owns display-clamped sizing and changes it only when the work area changes', () => {
  const harness = createWindowHarness();
  const host = createPopoverWindowHost({
    BrowserWindow: harness.BrowserWindow,
    preloadPath: '/app/preload-popover.js',
    pagePath: '/app/popover.html',
    workArea: { x: 0, y: 24, width: 1440, height: 900 }
  });
  const window = harness.instances[0];
  assert.equal(window.bounds.width, 560);
  assert.equal(window.bounds.height, 680);
  host.fitToWorkArea({ x: 0, y: 24, width: 520, height: 600 });
  assert.deepEqual([window.bounds.width, window.bounds.height], [504, 584]);
  host.fitToWorkArea({ x: 0, y: 24, width: 520, height: 600 });
  assert.equal(window.calls.filter(call => call[0] === 'setSize').length, 1);
});

test('impulse host wires load and blur while exposing only its required operations', () => {
  const harness = createWindowHarness();
  let loaded = 0;
  let hidden = 0;
  const host = createImpulseWindowHost({
    BrowserWindow: harness.BrowserWindow,
    preloadPath: '/app/preload-impulse.js',
    pagePath: '/app/impulse.html',
    onLoaded: () => { loaded += 1; },
    onHidden: () => { hidden += 1; }
  });
  const instance = harness.instances[0];

  assertHardened(instance, '/app/preload-impulse.js', '/app/impulse.html');
  assert.deepEqual(instance.bounds, { x: 0, y: 0, width: 480, height: 160 });
  instance.webContents.emit('did-finish-load');
  instance.emit('blur');
  instance.emit('hide');
  assert.equal(loaded, 1);
  assert.equal(hidden, 1);
  assert.equal(instance.visible, false);
  assert.deepEqual(host.setMode('idle'), { width: 480, height: 320 });
  assert.deepEqual(instance.bounds, { x: 0, y: 0, width: 480, height: 320 });
  assert.deepEqual(host.setMode('active'), { width: 480, height: 500 });
  assert.deepEqual(instance.bounds, { x: 0, y: 0, width: 480, height: 500 });
  assert.deepEqual(host.setMode('unknown'), { width: 480, height: 180 });
  assert.deepEqual(Object.keys(host).sort(), [
    'close', 'getBounds', 'hide', 'isAlive', 'isLoading', 'isVisible', 'send', 'setMode', 'setPosition', 'showAndFocus'
  ]);
});

test('impulse sizing reserves only the local clarification form and stays inside the work area', () => {
  const harness = createWindowHarness();
  const host = createImpulseWindowHost({ BrowserWindow: harness.BrowserWindow,
    preloadPath: '/app/preload-impulse.js', pagePath: '/app/impulse.html' });
  const view = { mode: 'idle', candidates: [{ quickStartAction: { intent: 'start', enabled: true } }] };
  const original = host.setMode(view);
  view.candidates[0].quickStartAction.intent = 'clarify-and-start';
  assert.equal(host.setMode(view).height, original.height + 156);
  assert.deepEqual(host.setMode(view, { width: 440, height: 300 }), { width: 424, height: 284 });
});

test('pet host keeps the passive companion focusable without stealing focus', () => {
  const harness = createWindowHarness();
  const events = [];
  const host = createPetWindowHost({
    BrowserWindow: harness.BrowserWindow,
    screen: null,
    preloadPath: '/app/preload-pet.js',
    pagePath: '/app/pet.html',
    bounds: { x: 10, y: 20, width: 220, height: 220 },
    onLoaded: () => events.push('loaded'),
    onHidden: () => events.push('hidden'),
    onClosed: () => events.push('closed')
  });
  const instance = harness.instances[0];

  assertHardened(instance, '/app/preload-pet.js', '/app/pet.html');
  assert.equal(instance.options.focusable, true);
  assert.ok(instance.calls.some(call => call[0] === 'setVisibleOnAllWorkspaces'));
  assert.ok(instance.calls.some(call => call[0] === 'setAlwaysOnTop' && call[2] === 'floating'));
  instance.webContents.emit('did-finish-load');
  host.showInactive();
  host.ensureFocusable();
  assert.equal(instance.options.skipTaskbar,true);
  assert.deepEqual(instance.calls.at(-1),['setSkipTaskbar',true]);
  instance.emit('hide');
  instance.emit('closed');
  assert.deepEqual(events, ['loaded', 'hidden', 'closed']);
  assert.ok(instance.calls.some(call => call[0] === 'showInactive'));
  assert.equal(instance.calls.some(call => call[0] === 'focus'), false);

  host.ensureFocusable({ focus: true });
  assert.ok(instance.calls.some(call => call[0] === 'focus'));
  assert.deepEqual(Object.keys(host).sort(), [
    'close', 'ensureFocusable', 'getBounds', 'isAlive', 'isVisible', 'send', 'setBounds', 'setMenuOpen', 'setPosition', 'showInactive'
  ]);
});

test('pet resize always restores the non-resizable native policy', () => {
  const harness = createWindowHarness();
  const instance = new harness.BrowserWindow({ width: 220, height: 220 });
  const host = createWindowHost(instance, { platform: 'darwin' });
  host.setBounds({ x: -40, y: -50, width: 520, height: 360 });
  assert.deepEqual(instance.calls.slice(-3), [
    ['setResizable', true],
    ['setBounds', { x: -40, y: -50, width: 520, height: 360 }, false],
    ['setResizable', false]
  ]);

  instance.setBounds = () => { throw new Error('resize failed'); };
  assert.throws(() => host.setBounds({ width: 220, height: 220 }), /resize failed/);
  assert.deepEqual(instance.calls.at(-1), ['setResizable', false]);
});

test('Windows menu resize never rebuilds the transparent window frame', () => {
  const harness = createWindowHarness();
  const instance = new harness.BrowserWindow({ width: 220, height: 220, resizable: false });
  const host = createWindowHost(instance, { platform: 'win32' });
  for (let i = 0; i < 3; i++) {
    host.setBounds({ x: -1000, y: 80, width: 520, height: 360 });
    host.setBounds({ x: -850, y: 150, width: 220, height: 220 });
  }
  assert.equal(instance.calls.filter(call => call[0] === 'setBounds').length, 6);
  assert.equal(instance.calls.some(call => call[0] === 'setResizable'), false);
});

test('pet host exposes reload only when development explicitly enables it', () => {
  const harness = createWindowHarness();
  const productionHost = createPetWindowHost({
    BrowserWindow: harness.BrowserWindow,
    screen: null,
    preloadPath: '/app/preload-pet.js',
    pagePath: '/app/pet.html',
    bounds: { x: 0, y: 0, width: 220, height: 220 }
  });
  assert.equal(Object.prototype.hasOwnProperty.call(productionHost, 'reload'), false);

  const developmentHost = createPetWindowHost({
    BrowserWindow: harness.BrowserWindow,
    screen: null,
    preloadPath: '/app/preload-pet.js',
    pagePath: '/app/pet.html',
    bounds: { x: 0, y: 0, width: 220, height: 220 },
    enableReload: true
  });
  assert.equal(typeof developmentHost.reload, 'function');
  const instance = harness.instances.at(-1);
  assert.equal(developmentHost.reload(), true);
  assert.equal(instance.webContents.messages.length, 0);
});

test('showInactive falls back to show on Electron versions without that API', () => {
  const harness = createWindowHarness({ withShowInactive: false });
  const instance = new harness.BrowserWindow({ width: 1, height: 1 });
  const host = createWindowHost(instance);
  host.showInactive();
  assert.deepEqual(instance.calls, [['show']]);
});

test('no overlay window swallows the first click on macOS', () => {
  // 浮在别的应用上的窗口不是当前窗口，第一次点击默认只用来激活它：桌宠和提醒气泡得点两次。
  const plain = createWindowHarness();
  createHardenedWindow({
    BrowserWindow: plain.BrowserWindow, preloadPath: '/app/preload.js', pagePath: '/app/page.html', options: { width: 10, height: 10 }
  });
  assert.equal(plain.instances[0].options.acceptFirstMouse, true, 'the common host accepts the first click by default');

  const optOut = createWindowHarness();
  createHardenedWindow({
    BrowserWindow: optOut.BrowserWindow, preloadPath: '/app/preload.js', pagePath: '/app/page.html',
    options: { width: 10, height: 10, acceptFirstMouse: false }
  });
  assert.equal(optOut.instances[0].options.acceptFirstMouse, false, 'a window can still opt out explicitly');

  const pet = createWindowHarness();
  createPetWindowHost({
    BrowserWindow: pet.BrowserWindow, preloadPath: '/app/preload-pet.js', pagePath: '/app/pet.html',
    screen: null,
    bounds: { x: 0, y: 0, width: 220, height: 220 }, onLoaded() {}, onHidden() {}, onClosed() {}
  });
  assert.equal(pet.instances[0].options.acceptFirstMouse, true, 'the pet is the window most often clicked while another app is in front');

  const popover = createWindowHarness();
  createPopoverWindowHost({
    BrowserWindow: popover.BrowserWindow, preloadPath: '/app/preload-popover.js', pagePath: '/app/popover.html', onDeliveryError() {}
  });
  assert.equal(popover.instances[0].options.acceptFirstMouse, true);
});

test('clicking the tray icon to close the popover does not reopen it', () => {
  // macOS：鼠标按下托盘图标的那一刻弹窗先失焦被隐藏，随后托盘的 click 才到。托盘点击靠 justHiddenByBlur 认出
  // “刚才是失焦把它藏起来的”，把这一下当作关闭，而不是再打开一次。
  let clock = 1000;
  const harness = createWindowHarness();
  const host = createPopoverWindowHost({
    BrowserWindow: harness.BrowserWindow, preloadPath: '/app/preload-popover.js', pagePath: '/app/popover.html',
    height: 720, now: () => clock
  });
  const instance = harness.instances[0];
  assert.equal(host.justHiddenByBlur(), false, 'nothing has been hidden yet');
  instance.emit('blur');
  clock += 120;                                             // the click event arrives a moment later
  assert.equal(host.justHiddenByBlur(), true);
  clock += 400;                                             // an unrelated click much later is a real "open"
  assert.equal(host.justHiddenByBlur(), false);
  assert.equal(host.justHiddenByBlur(1000), true, 'the window is adjustable');
});

test('only the tray click uses the blur guard; the menu item and the shortcut always open', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const main = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
  assert.match(main, /function togglePopover\(fromTray = false\) \{[\s\S]*?fromTray === true && popover\.justHiddenByBlur\(\)/);
  assert.match(main, /onClick: \(\) => togglePopover\(true\),/);
  // Electron 会把 menuItem 当第一个参数传给 click 处理器：必须是严格的 true 才算托盘点击。
  assert.match(main, /label: '打开面板', click: togglePopover/);
  assert.match(main, /accelerator: 'Alt\+Space', handler: togglePopover/);
});

test('the popover and the quick panel are rounded opaque cards: no vibrancy behind them', () => {
  // vibrancy 铺满整个矩形窗口、不理会页面的圆角：圆角外面会露出方形的毛玻璃和方形阴影，而页面自己是不透明的。
  const popover = createWindowHarness();
  createPopoverWindowHost({ BrowserWindow: popover.BrowserWindow, preloadPath: '/p.js', pagePath: '/p.html', height: 700 });
  const quick = createWindowHarness();
  createImpulseWindowHost({ BrowserWindow: quick.BrowserWindow, preloadPath: '/q.js', pagePath: '/q.html', onLoaded() {}, onHidden() {} });
  for (const [name, harness] of [['popover', popover], ['quick panel', quick]]) {
    const options = harness.instances[0].options;
    assert.equal(options.transparent, process.platform !== 'win32', `${name} stays transparent so the rounded corners show through`);
    assert.equal(options.vibrancy, undefined, `${name} must not paint a square vibrancy layer`);
    assert.equal(options.visualEffectState, undefined, name);
  }
});

test('ordinary macOS window show recomputes its shadow', () => {
  // 透明窗口的阴影按内容的透明度算，内容变了它不会自己重算：显示的一瞬间阴影和内容对不上。
  const harness = createWindowHarness();
  const instance = new harness.BrowserWindow({ width: 440, height: 700 });
  const host = createWindowHost(instance, { platform: 'darwin' });
  instance.invalidateShadow = function invalidateShadow() { this.calls.push(['invalidateShadow']); };
  host.showAndFocus();
  const order = instance.calls.map(call => call[0]).filter(name => ['show', 'focus', 'invalidateShadow'].includes(name));
  assert.deepEqual(order, ['show', 'focus', 'invalidateShadow'], 'after the window is up, not before');
  // 没有这个 API 的平台 / 版本：不抛。
  const plain = createWindowHarness();
  const other = createPopoverWindowHost({ BrowserWindow: plain.BrowserWindow, preloadPath: '/p.js', pagePath: '/p.html', height: 700 });
  assert.doesNotThrow(() => other.showAndFocus());
});


test('all native popover hide events notify only its scoped renderer lifecycle', () => {
  const harness = createWindowHarness();
  createPopoverWindowHost({ BrowserWindow: harness.BrowserWindow,
    preloadPath: '/app/preload-popover.js', pagePath: '/app/popover.html' });
  harness.instances[0].emit('hide');
  assert.deepEqual(harness.instances[0].webContents.messages.at(-1), { channel: 'popover:hidden', payload: undefined });
});

for (const platform of ['darwin', 'win32']) test(`${platform} pet menus retain native bounds and logical anchor for 30 round trips`, () => {
  const harness = createWindowHarness();
  let cursor = { x: 1601, y: 801 };
  const anchor = { x: 1600, y: 800, width: 220, height: 220 };
  const screen = { getCursorScreenPoint: () => cursor, getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) };
  const host = createPetWindowHost({ BrowserWindow: harness.BrowserWindow, platform, screen,
    preloadPath: '/app/preload-pet.js', pagePath: '/app/pet.html', bounds: anchor });
  const native = harness.instances[0], original = native.getBounds();
  assertHardened(native, '/app/preload-pet.js', '/app/pet.html');
  for (let i = 0; i < 30; i++) {
    for (const open of [true, false]) {
      const geo = host.setMenuOpen(open);
      assert.deepEqual(native.getBounds(), original);
      assert.deepEqual(host.getBounds(), anchor);
      assert.equal(original.x + geo.width / 2 + geo.stageOffset.x, anchor.x + 110);
      assert.equal(original.y + geo.height / 2 + geo.stageOffset.y, anchor.y + 110);
    }
  }
  assert.equal(native.calls.some(call => ['setBounds', 'setResizable', 'setPosition', 'focus', 'setFocusable'].includes(call[0])), false);
  cursor = { x: original.x + 1, y: original.y + 1 };
  host.setMenuOpen(false); assert.equal(native.calls.at(-1)[1], true);
  host.setMenuOpen(true); assert.equal(native.calls.at(-1)[1], false);
  host.setMenuOpen(false); assert.equal(native.calls.at(-1)[1], true);
  host.setPosition(1200, 650);
  assert.deepEqual(host.getBounds(), { ...anchor, x: 1200, y: 650 });
  host.setBounds({ x: 1100, y: 600, width: 220, height: 220 });
  assert.deepEqual(host.getBounds(), { ...anchor, x: 1100, y: 600 });
  native.emit('closed');
});
