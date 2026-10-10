'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { DISABLE_AUDIO, supportsAudioProbe, reusableProbe, prepareProbe, run } = require('../scripts/dev-app');

test('audio helper minimum OS is explicit and unknown versions fail closed', () => {
  for (const v of ['14.2', '14.2.1', '15.0', '26.0']) assert.equal(supportsAudioProbe(v), true);
  for (const v of ['13.7', '14.1.9', '', 'unknown', '14']) assert.equal(supportsAudioProbe(v), false);
});

test('reuse requires executable current-source thin Mach-O matching this architecture', () => {
  const header = Buffer.alloc(8); header.writeUInt32LE(0xfeedfacf, 0); header.writeUInt32LE(0x0100000c, 4);
  const ports = { root: '/repo', arch: 'arm64', stat: file => ({ isFile: () => true, mtimeMs: file.endsWith('activity-probe') ? 20 : 10 }),
    read: () => header, access() {} };
  assert.equal(reusableProbe(ports), true);
  assert.equal(reusableProbe({ ...ports, arch: 'x64' }), false);
  assert.equal(reusableProbe({ ...ports, arch: 'unknown' }), false);
  assert.equal(reusableProbe({ ...ports, read: () => Buffer.from('invalid') }), false);
  assert.equal(reusableProbe({ ...ports, access() { throw new Error('not executable'); } }), false);
  assert.equal(reusableProbe({ ...ports, stat: () => ({ isFile: () => false }) }), false);
  assert.equal(reusableProbe({ ...ports, stat: file => ({ isFile: () => true, mtimeMs: file.endsWith('activity-probe') ? 10 : 20 }) }), false);
});

function setup({ version = '14.2', developer = '/existing/developer', compiler = '/existing/swiftc', reusable = false, buildError = false } = {}) {
  const calls = [], warnings = []; let built = false;
  const ports = { platform: 'darwin', arch: 'arm64', root: '/repo',
    spawn: (file, args) => { calls.push([file, ...args]); const stdout = file.endsWith('sw_vers') ? version : file.endsWith('xcode-select') ? developer : compiler;
      return { status: stdout ? 0 : 1, stdout }; },
    reuse: () => reusable || built, build: options => { calls.push(['build', options.arch]); if (buildError) throw new Error('compile failed'); built = true; },
    access() {}, warn: message => warnings.push(message) };
  return { calls, warnings, ports };
}

test('dev reuses verified helper without invoking developer tools, otherwise compiles only existing tools', () => {
  const ready = setup({ reusable: true });
  assert.equal(prepareProbe(ready.ports), true);
  assert.deepEqual(ready.calls.map(call => call[0]), ['/usr/bin/sw_vers']);
  const fresh = setup(); assert.equal(prepareProbe(fresh.ports), true);
  assert.deepEqual(fresh.calls.map(call => call[0]), ['/usr/bin/sw_vers', '/usr/bin/xcode-select', '/usr/bin/xcrun', 'build']);
  assert.equal(fresh.warnings.length, 0);
  const linux = setup(); assert.equal(prepareProbe({ ...linux.ports, platform: 'linux' }), true); assert.equal(linux.calls.length, 0);
});

test('unsupported OS, missing toolchain and compilation errors degrade without install or permission commands', () => {
  for (const options of [{ version: '14.1' }, { developer: '' }, { compiler: '' }, { buildError: true }]) {
    const state = setup(options);
    assert.equal(prepareProbe(state.ports), false);
    assert.equal(state.warnings.length, 1);
    assert.match(state.warnings[0], /music detection unavailable/);
    assert.ok(state.calls.every(call => !call.includes('--install')));
    if (options.developer === '') assert.ok(!state.calls.some(call => call[0].endsWith('xcrun')));
  }
});

test('dev launcher preserves arguments, exit status, and signal forwarding while degrading audio', async () => {
  for (const audio of [true, false]) {
    const env = { [DISABLE_AUDIO]: '1', KEEP: 'yes' }; const calls = [], kills = [];
    const child = new EventEmitter(); child.kill = signal => kills.push(signal);
    const signals = new EventEmitter();
    const pending = run({ platform: 'darwin', root: '/repo', argv: ['--user-data-dir=/tmp/test profile'], env,
      prepare: () => audio, signals, electron: () => '/existing/electron',
      spawn: (...args) => { calls.push(args); return child; } });
    assert.equal(env[DISABLE_AUDIO], '1');
    assert.deepEqual(calls[0][1], ['.', '--dev', '--user-data-dir=/tmp/test profile']);
    assert.equal(calls[0][2].env[DISABLE_AUDIO], audio ? undefined : '1');
    assert.equal(calls[0][2].shell, false);
    signals.emit('SIGTERM'); assert.deepEqual(kills, ['SIGTERM']);
    child.emit('close', audio ? 17 : null, audio ? null : 'SIGTERM');
    assert.equal(await pending, audio ? 17 : 143);
    assert.equal(signals.listenerCount('SIGTERM'), 0);
  }
});

test('a failed Electron spawn exits once and removes signal handlers', async () => {
  const child = new EventEmitter(), signals = new EventEmitter(), warnings = [];
  const pending = run({ prepare: () => true, signals, electron: () => '/missing',
    spawn: () => child, warn: error => warnings.push(error) });
  child.emit('error', new Error('ENOENT'));
  child.emit('close', -2);
  assert.equal(await pending, 1);
  assert.equal(warnings.length, 1);
  assert.equal(signals.listenerCount('SIGINT'), 0);
});
