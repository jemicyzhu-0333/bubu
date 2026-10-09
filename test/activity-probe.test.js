'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { parseProbeLine, parseLsappinfoValue } = require('../src/platform/activity/probe-line');
const { createActivityProbeHost, resolveProbeCommand, MAX_RESTARTS } = require('../src/platform/activity/activity-probe-host');

test('probe lines are closed: version, bounded identifiers, deduplicated audio', () => {
  assert.deepEqual({ ...parseProbeLine('{"v":1,"front":"com.microsoft.VSCode","audio":["com.spotify.client","com.spotify.client"]}') },
    { front: 'com.microsoft.VSCode', audio: ['com.spotify.client'] });
  assert.deepEqual({ ...parseProbeLine('{"v":1,"front":null,"audio":"Spotify"}') }, { front: null, audio: ['Spotify'] });
  assert.deepEqual([...parseProbeLine(JSON.stringify({ v: 1, front: 'x'.repeat(201), audio: Array.from({ length: 40 }, (_, i) => `a${i}`) })).audio].length, 32);
  for (const bad of ['', 'not json', '[]', '{"v":2,"front":"a"}', 'x'.repeat(20_000)]) assert.equal(parseProbeLine(bad), null);
  assert.equal(parseLsappinfoValue('"CFBundleIdentifier"="com.apple.Terminal"\n'), 'com.apple.Terminal');
  assert.equal(parseLsappinfoValue(''), null);
});

test('the helper path resolves inside packaged resources or the repository, with a macOS fallback', () => {
  const none = () => false, all = () => true;
  assert.deepEqual(resolveProbeCommand({ platform: 'darwin', isPackaged: true, resourcesPath: '/R', appPath: '/A', exists: all }),
    { kind: 'helper', file: path.join('/R', 'activity-probe', 'activity-probe'), args: [] });
  assert.deepEqual(resolveProbeCommand({ platform: 'darwin', isPackaged: false, resourcesPath: '/R', appPath: '/A', exists: none }), { kind: 'lsappinfo' });
  const windows = resolveProbeCommand({ platform: 'win32', isPackaged: false, resourcesPath: '/R', appPath: '/A', exists: all });
  assert.equal(windows.file, 'powershell.exe');
  assert.ok(windows.args.includes('Bypass') && windows.args.at(-1).endsWith('activity-probe.ps1'));
  assert.equal(resolveProbeCommand({ platform: 'linux', exists: all }), null);
});

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stdout.setEncoding = () => {};
  child.stdin = { end: () => { child.stdinClosed = true; } };
  child.kill = () => { child.killed = true; };
  return child;
}

test('the host splits lines across chunks, restarts a crashed helper with backoff and stops cleanly', () => {
  const children = [], samples = [], timers = [], errors = [];
  const host = createActivityProbeHost({
    command: { kind: 'helper', file: 'probe', args: [] }, onSample: sample => samples.push(sample), onError: e => errors.push(e),
    spawn: () => { const child = fakeChild(); children.push(child); return child; },
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimer: () => {}
  });
  assert.equal(host.start(), true);
  children[0].stdout.emit('data', '{"v":1,"front":"a","au');
  children[0].stdout.emit('data', 'dio":[]}\ngarbage\n{"v":1,"front":"b","audio":[]}\n');
  assert.deepEqual(samples.map(sample => sample.front), ['a', 'b']);
  children[0].emit('exit', 1);
  assert.equal(timers.at(-1).ms, 2_000);
  timers.at(-1).fn();
  assert.equal(children.length, 2);
  for (let i = 0; i < MAX_RESTARTS + 1; i += 1) {
    children.at(-1).emit('exit', 1);
    if (timers.length && timers.at(-1).fn) { const next = timers.pop(); next.fn(); }
  }
  assert.ok(errors.some(error => /repeated failures/.test(error.message)), 'gives up instead of spinning');
  host.stop();

  const live = [];
  const second = createActivityProbeHost({
    command: { kind: 'helper', file: 'probe', args: [] }, onSample: sample => samples.push(sample),
    spawn: () => { const child = fakeChild(); live.push(child); return child; }, setTimer: () => 1, clearTimer: () => {}
  });
  second.start();
  second.stop();
  assert.equal(live[0].stdinClosed && live[0].killed, true, 'stop closes stdin and kills the helper');
  live[0].stdout.emit('data', '{"v":1,"front":"late","audio":[]}\n');
  live[0].emit('exit', 0);
  assert.ok(!samples.some(sample => sample.front === 'late'), 'nothing is delivered after stop');
  assert.equal(live.length, 1, 'no restart after stop');
});

test('the macOS fallback polls lsappinfo for the front bundle and reports no audio', () => {
  const samples = [], timers = [];
  const host = createActivityProbeHost({
    command: { kind: 'lsappinfo' }, onSample: sample => samples.push(sample),
    execFile: (_file, args, _options, done) => { assert.match(args[1], /lsappinfo/); done(null, '"CFBundleIdentifier"="dev.zed.Zed"'); },
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return 1; }, clearTimer: () => {}
  });
  host.start();
  assert.deepEqual({ ...samples[0], audio: [...samples[0].audio] }, { front: 'dev.zed.Zed', audio: [] });
  assert.equal(timers[0].ms, 2_000);
  host.stop();
  timers[0].fn();
  assert.equal(samples.length, 1);
});
