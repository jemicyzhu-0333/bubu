'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createAppHost } = require('../src/platform/electron/app-host');
const { fixture } = require('../test-support/config-admission-fixture');

function hostFor(directory, { lock = true, platform = 'win32', io = fs } = {}) {
  const app = new EventEmitter(), calls = [];
  app.getPath = () => directory;
  app.setPath = () => assert.fail('explicit profile must not move');
  app.commandLine = { hasSwitch: () => true };
  app.requestSingleInstanceLock = () => { calls.push('native-lock'); return lock; };
  app.quit = () => {}; app.isReady = () => false; app.whenReady = () => Promise.resolve();
  app.getLoginItemSettings = () => ({}); app.setLoginItemSettings = () => {};
  return { host: createAppHost({ app, platform, io }), calls };
}

test('Windows absent profile and empty regular lock still reach the real singleton ownership decision', t => {
  const f = fixture(t), absent = hostFor(path.join(f.directory, 'new'));
  assert.equal(absent.host.acquireSingleInstanceLock(), true);
  assert.deepEqual(absent.calls, ['native-lock']);
  fs.writeFileSync(path.join(f.directory, 'lockfile'), '');
  for (const lock of [true, false]) {
    const h = hostFor(f.directory, { lock });
    assert.equal(h.host.acquireSingleInstanceLock(), lock);
    assert.deepEqual(h.calls, ['native-lock']);
    assert.equal(fs.statSync(path.join(f.directory, 'lockfile')).size, 0);
  }
});

for (const kind of ['nonempty', 'directory', 'symlink', 'dangling-symlink']) {
  test(`Windows refuses preexisting ${kind} before Chromium can rewrite lockfile`, { skip: process.platform === 'win32' && kind.includes('symlink') }, t => {
    const f = fixture(t), lock = path.join(f.directory, 'lockfile');
    const target = path.join(fixture(t).directory, 'retained');
    fs.writeFileSync(target, 'retain target bytes');
    if (kind === 'nonempty') fs.writeFileSync(lock, 'retain lockfile bytes');
    if (kind === 'directory') fs.mkdirSync(lock);
    if (kind === 'symlink') fs.symlinkSync(target, lock);
    if (kind === 'dangling-symlink') fs.symlinkSync(`${target}-absent`, lock);
    const before = fs.lstatSync(lock, { bigint: true }), h = hostFor(f.directory);
    assert.throws(() => h.host.acquireSingleInstanceLock(), { code: 'config-profile-brand-required' });
    assert.deepEqual(h.calls, [], 'native CREATE_ALWAYS must never run on a refused member');
    assert.equal(fs.readFileSync(target, 'utf8'), 'retain target bytes');
    assert.deepEqual(fs.lstatSync(lock, { bigint: true }), before);
    if (kind === 'nonempty') assert.equal(fs.readFileSync(lock, 'utf8'), 'retain lockfile bytes');
    if (kind.includes('symlink')) assert.equal(fs.readlinkSync(lock), kind === 'symlink' ? target : `${target}-absent`);
  });
}

test('Windows rejects a symlink-selected profile before native lock acquisition', { skip: process.platform === 'win32' }, t => {
  const f = fixture(t), selected = path.join(fixture(t).directory, 'selected');
  fs.symlinkSync(f.directory, selected);
  const h = hostFor(selected);
  assert.throws(() => h.host.acquireSingleInstanceLock(), { code: 'config-profile-brand-required' });
  assert.deepEqual(h.calls, []);
  assert.deepEqual(fs.readdirSync(f.directory), []);
});

test('Windows metadata errors fail closed; other platforms retain their native lock behavior', t => {
  const f = fixture(t), error = Object.assign(new Error('synthetic metadata denial'), { code: 'EACCES' });
  const io = { lstatSync() { throw error; } };
  const denied = hostFor(f.directory, { io });
  assert.throws(() => denied.host.acquireSingleInstanceLock(), caught => caught === error);
  assert.deepEqual(denied.calls, []);
  for (const platform of ['linux', 'darwin']) {
    const other = hostFor(f.directory, { platform, io });
    assert.equal(other.host.acquireSingleInstanceLock(), true);
    assert.deepEqual(other.calls, ['native-lock']);
  }
});
