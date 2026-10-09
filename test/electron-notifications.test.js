'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createNotificationHost } = require('../src/platform/electron/notifications');

function createNotificationHarness({ supported = true, showError = null, closeError = null, constructionError = null, onShow = null } = {}) {
  const instances = [];
  class FakeNotification extends EventEmitter {
    static isSupported() { return supported; }
    constructor(options) {
      super();
      if (constructionError) throw constructionError;
      this.options = options;
      this.shown = false;
      this.closed = false;
      instances.push(this);
    }
    show() {
      if (showError) throw showError;
      this.shown = true;
      if (onShow) onShow(this);
    }
    close() {
      this.closed = true;
      this.emit('close');
      if (closeError) throw closeError;
    }
  }
  return { Notification: FakeNotification, instances };
}

function createHost(harness, options = {}) {
  return createNotificationHost({
    Notification: harness.Notification,
    isSuppressed: options.isSuppressed || (() => false),
    isSoundEnabled: options.isSoundEnabled || (() => true),
    onError: options.onError,
    presentCompanion: options.presentCompanion
  });
}

test('only opted-in feedback goes to the pet; everything else stays a native notification', () => {
  const harness = createNotificationHarness();
  const said = [];
  let suppressed = false;
  const host = createHost(harness, { presentCompanion: text => said.push(text), isSuppressed: () => suppressed });
  host.show({ delivery: 'companion', title: '🌟 升级！Lv.3', body: '新形态已解锁' });
  assert.deepEqual(said, ['升级！Lv.3 · 新形态已解锁']);
  assert.equal(harness.instances.length, 0);
  // A due time or deadline never depends on whether the pet happens to be visible.
  host.show({ title: '⌛ 2 个任务到期' });
  host.show({ delivery: 'system', title: '预约已到时间' });
  assert.equal(harness.instances.length, 2);
  assert.equal('delivery' in harness.instances[0].options, false);
  suppressed = true;
  host.show({ delivery: 'companion', title: '不应出现' });
  host.show({ title: '不应出现' });
  assert.equal(said.length, 1);
  assert.equal(harness.instances.length, 2);
});

test('a failed pet feedback effect never creates a retryable operation or native fallback storm', () => {
  const harness = createNotificationHarness();
  const errors = [];
  const host = createHost(harness, { presentCompanion: () => { throw new Error('pet unavailable'); }, onError: e => errors.push(e) });
  assert.equal(host.show({ delivery: 'companion', title: '已保存' }), null);
  assert.equal(errors.length, 1);
  assert.equal(harness.instances.length, 0);
});

test('suppression and platform support prevent notification construction', () => {
  const suppressed = createNotificationHarness();
  const suppressedHost = createHost(suppressed, { isSuppressed: () => true });
  assert.equal(suppressedHost.show({ title: 'hidden' }), null);
  assert.equal(suppressed.instances.length, 0);

  const unsupported = createNotificationHarness({ supported: false });
  const unsupportedHost = createHost(unsupported);
  assert.equal(unsupportedHost.show({ title: 'unsupported' }), null);
  assert.equal(unsupported.instances.length, 0);
});

test('sound policy supplies a default without overriding an explicit silent option', () => {
  const harness = createNotificationHarness();
  const host = createHost(harness, { isSoundEnabled: () => false });

  host.show({ title: 'default' });
  host.show({ title: 'explicit', silent: false });

  assert.deepEqual(harness.instances.map(item => item.options), [
    { title: 'default', silent: true },
    { title: 'explicit', silent: false }
  ]);
  assert.ok(harness.instances.every(item => item.shown));
});

test('shown notifications leave the active set on close and closeAll is idempotent', () => {
  const harness = createNotificationHarness();
  const host = createHost(harness);
  const first = host.show({ title: 'first' });
  const second = host.show({ title: 'second' });

  first.close();
  host.closeAll();
  host.closeAll();

  assert.equal(first.closed, true);
  assert.equal(second.closed, true);
});

test('show and close failures stay best-effort and do not strand later notifications', () => {
  const showFailure = new Error('show unavailable');
  const showHarness = createNotificationHarness({ showError: showFailure });
  const showErrors = [];
  const showHost = createHost(showHarness, { onError: error => showErrors.push(error) });
  assert.equal(showHost.show({ title: 'committed already' }), null);
  assert.deepEqual(showErrors, [showFailure]);

  const closeFailure = new Error('close unavailable');
  const closeHarness = createNotificationHarness({ closeError: closeFailure });
  const closeErrors = [];
  const closeHost = createHost(closeHarness, { onError: error => closeErrors.push(error) });
  closeHost.show({ title: 'one' });
  closeHost.show({ title: 'two' });
  assert.doesNotThrow(() => closeHost.closeAll());
  assert.equal(closeHarness.instances.filter(item => item.closed).length, 2);
  assert.deepEqual(closeErrors, [closeFailure, closeFailure]);
});

test('construction validates its narrow policy and diagnostic ports', () => {
  const harness = createNotificationHarness();
  assert.throws(() => createNotificationHost({
    Notification: harness.Notification,
    isSuppressed: null,
    isSoundEnabled: () => true
  }), /isSuppressed/);
  assert.throws(() => createNotificationHost({
    Notification: harness.Notification,
    isSuppressed: () => false,
    isSoundEnabled: null
  }), /isSoundEnabled/);
  assert.throws(() => createNotificationHost({
    Notification: {},
    isSuppressed: () => false,
    isSoundEnabled: () => true
  }), /Notification/);
});

test('native construction and show invocation remain pending until the actual show event', () => {
  const harness = createNotificationHarness();
  const host = createHost(harness);
  const receipts = [];
  const notification = host.show({ title: 'pending' }, receipt => receipts.push(receipt));
  assert.ok(notification.shown);
  assert.deepEqual(receipts, []);
  notification.emit('show');
  notification.emit('show');
  notification.emit('failed', {}, 'late failure');
  notification.close();
  assert.deepEqual(receipts, [{ shown: true }]);
});

test('show and failed listeners exist before native show is invoked', () => {
  for (const eventName of ['show', 'failed']) {
    const receipts = [];
    const harness = createNotificationHarness({ onShow: notification => {
      assert.equal(notification.listenerCount('show'), 1);
      assert.equal(notification.listenerCount('failed'), 1);
      notification.emit(eventName);
    } });
    createHost(harness).show({ title: eventName }, receipt => receipts.push(receipt));
    assert.deepEqual(receipts, eventName === 'show' ? [{ shown: true }] : [{ shown: false, reason: 'failed' }]);
  }
});

test('native failed and close-before-show settle false once and ignore late delivery', () => {
  for (const eventName of ['failed', 'close']) {
    const harness = createNotificationHarness();
    const host = createHost(harness);
    const receipts = [];
    const notification = host.show({ title: eventName }, receipt => receipts.push(receipt));
    notification.emit(eventName);
    notification.emit('show');
    notification.emit(eventName);
    host.closeAll();
    assert.deepEqual(receipts, [{ shown: false, reason: eventName === 'close' ? 'closed' : 'failed' }]);
  }
});

test('unsupported and suppressed notifications return negative receipts without construction', () => {
  for (const reason of ['unsupported', 'suppressed']) {
    const harness = createNotificationHarness({ supported: reason !== 'unsupported' });
    const host = createHost(harness, { isSuppressed: () => reason === 'suppressed' });
    const receipts = [];
    assert.equal(host.show({ title: reason }, receipt => receipts.push(receipt)), null);
    assert.deepEqual(receipts, [{ shown: false, reason }]);
    assert.equal(harness.instances.length, 0);
  }
});

test('construction, policy and show exceptions produce false receipts without escaping', () => {
  for (const failure of ['construction', 'suppression', 'sound', 'show']) {
    const error = new Error(`${failure} failed`);
    const harness = createNotificationHarness({
      constructionError: failure === 'construction' ? error : null,
      showError: failure === 'show' ? error : null
    });
    const errors = [];
    const receipts = [];
    const host = createHost(harness, {
      isSuppressed: failure === 'suppression' ? () => { throw error; } : () => false,
      isSoundEnabled: failure === 'sound' ? () => { throw error; } : () => true,
      onError: item => errors.push(item)
    });
    assert.equal(host.show({ title: failure }, receipt => receipts.push(receipt)), null);
    assert.deepEqual(receipts, [{ shown: false, reason: 'error' }]);
    assert.deepEqual(errors, [error]);
    harness.instances[0]?.emit('show');
    assert.equal(receipts.length, 1);
  }
});

test('closeAll cancels pending receipts even if native close throws and late show cannot revive them', () => {
  const harness = createNotificationHarness({ closeError: new Error('close failed') });
  const host = createHost(harness, { onError: () => { throw new Error('diagnostic failed'); } });
  const receipts = [];
  const notification = host.show({ title: 'pending' }, receipt => receipts.push(receipt));
  assert.doesNotThrow(() => host.closeAll());
  host.closeAll();
  notification.emit('show');
  assert.deepEqual(receipts, [{ shown: false, reason: 'closed' }]);
  assert.equal(notification.listenerCount('show'), 0);
  assert.equal(notification.listenerCount('failed'), 0);
});

test('receipt exceptions are isolated and cannot change delivery or strand other notifications', () => {
  const harness = createNotificationHarness();
  const errors = [];
  const host = createHost(harness, { onError: error => errors.push(error) });
  const notification = host.show({ title: 'shown' }, () => { throw new Error('receipt failed'); });
  assert.doesNotThrow(() => notification.emit('show'));
  notification.emit('show');
  assert.deepEqual(errors.map(error => error.message), ['receipt failed']);
  assert.doesNotThrow(() => host.closeAll());
  assert.equal(notification.closed, true);
});

test('a receipt reentering closeAll cannot duplicate cancellation or native close', () => {
  const harness = createNotificationHarness();
  const host = createHost(harness);
  let closed = 0;
  const receipts = [];
  const first = host.show({ title: 'first' }, receipt => { receipts.push(receipt); host.closeAll(); });
  const second = host.show({ title: 'second' }, receipt => receipts.push(receipt));
  first.on('close', () => closed++);
  second.on('close', () => closed++);
  host.closeAll();
  assert.equal(closed, 2);
  assert.deepEqual(receipts, [{ shown: false, reason: 'closed' }, { shown: false, reason: 'closed' }]);
});

test('companion feedback preserves its existing path without attesting native delivery', () => {
  const harness = createNotificationHarness();
  const lines = [];
  const receipts = [];
  const host = createHost(harness, { presentCompanion: line => lines.push(line) });
  assert.equal(host.show({ delivery: 'companion', title: '已保存' }, receipt => receipts.push(receipt)), null);
  assert.deepEqual(lines, ['已保存']);
  assert.deepEqual(receipts, [{ shown: false, reason: 'companion' }]);
  assert.equal(harness.instances.length, 0);
});

test('a routine option cannot bypass suppression in the general notification host', () => {
  const harness = createNotificationHarness();
  const host = createHost(harness, { isSuppressed: () => true });
  const receipts = [];
  host.show({ routine: true, title: 'blocked', silent: true }, receipt => receipts.push(receipt));
  assert.deepEqual(receipts, [{ shown: false, reason: 'suppressed' }]);
  assert.equal(harness.instances.length, 0);
});
