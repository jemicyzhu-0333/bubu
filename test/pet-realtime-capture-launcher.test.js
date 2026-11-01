'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const load = () => Promise.all([import('../tools/pet-realtime-capture/options.mjs'), import('../tools/pet-realtime-capture/supervisor.mjs')]);

function fixture({ pid = 8123, platform = 'linux', killError, helperClose = true } = {}) {
  const child = new EventEmitter(); child.pid = pid;
  child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
  child.stdout.destroy = () => {}; child.stderr.destroy = () => {};
  const calls = [], kills = [], helpers = [];
  let groupAlive = true;
  const options = { platform, env: { ONLY: 'provided' }, cwd: '/fixture', timeoutMs: 100,
    killGraceMs: 2, cleanupMs: 35,
    spawn(command, args, settings) {
      calls.push({ command, args, settings });
      if (command !== 'taskkill.exe') return child;
      const helper = new EventEmitter(); helpers.push(helper);
      helper.kill = signal => { kills.push(['helper', signal]); setImmediate(() => helper.emit('close', 1)); };
      if (helperClose) setImmediate(() => helper.emit('close', 0));
      return helper;
    },
    killProcess(target, signal) {
      kills.push([target, signal]);
      if (killError) throw Object.assign(new Error('Permission denied'), { code: 'EPERM' });
      if (!groupAlive) throw Object.assign(new Error('No such process'), { code: 'ESRCH' });
      if (signal === 'SIGKILL') groupAlive = false;
    },
  };
  return { child, calls, kills, helpers, options, gone() { groupAlive = false; } };
}
function close(child, code = 0, signal = null) { child.emit('exit', code, signal); child.emit('close', code, signal); }

test('capture options are closed, immutable and have fixed resource/time limits', async () => {
  const [{ parseCaptureOptions, LIMITS }] = await load();
  assert.deepEqual(parseCaptureOptions([]), { prepare: false, out: null, screenshots: true, help: false });
  assert.deepEqual(parseCaptureOptions(['--prepare', '--out=/tmp/fresh.zip', '--no-screenshots']),
    { prepare: true, out: path.resolve('/tmp/fresh.zip'), screenshots: false, help: false });
  assert.equal(parseCaptureOptions(['--help']).help, true);
  assert.ok(Object.isFrozen(parseCaptureOptions([]))); assert.ok(Object.isFrozen(LIMITS));
  assert.deepEqual(LIMITS, { preparationMs: 300000, collectionMs: 180000, decodedBytes: 16777216,
    compressedBytes: 8388608, frames: 18000, events: 512, errors: 64, screenshots: 6, maxLogsBytes: 65536 });
});

test('capture rejects profile, URL, sandbox, arbitrary duration, positional and duplicate options', async () => {
  const [{ parseCaptureOptions }] = await load();
  for (const args of [['--user-data-dir=/real'], ['--session-data-dir=/real'], ['--profile=/real'], ['--no-sandbox'],
    ['--duration=100'], ['--manual'], ['https://example.com'], ['--out'], ['--out='], ['--out=http:x'],
    ['--out=file:/tmp/a'], ['--out=https://example.com/a'], ['--out=//host/share'], ['--out=\\\\host\\share'],
    ['--out=a\0b'], ['--out=a\nb'], ['--prepare', '--prepare'], ['--out=a', '--out=b'], ['--help=yes']])
    assert.throws(() => parseCaptureOptions(args), { name: 'Error' }, JSON.stringify(args));
  assert.throws(() => parseCaptureOptions([7]), TypeError);
});

test('normal process preserves exit and uses only provided env, direct argv and a private group', async () => {
  const [, { runOwnedProcess }] = await load(); const f = fixture();
  const pending = runOwnedProcess('/node', ['tool.js', 'a b'], f.options);
  f.child.stdout.emit('data', 'ready\n'); f.gone(); close(f.child, 7);
  const result = await pending;
  assert.equal(result.code, 7); assert.equal(result.signal, null); assert.equal(result.stopReason, 'exited');
  assert.equal(result.stdout, 'ready\n'); assert.equal(result.cleanup.confirmed, true);
  assert.equal(result.maximumElapsedMs, 135); assert.ok(result.elapsedMs >= 0);
  assert.deepEqual(f.calls[0].args, ['tool.js', 'a b']);
  assert.equal(f.calls[0].settings.shell, false); assert.equal(f.calls[0].settings.detached, true);
  assert.deepEqual(f.calls[0].settings.env, { ONLY: 'provided' });
  assert.ok(f.kills.every(([pid]) => pid === -8123));
});

test('stdout/stderr share a 64KiB bound; logs and callbacks are sanitized across chunks', async () => {
  const [, { runOwnedProcess }] = await load(); const f = fixture(); const outputs = [];
  const pending = runOwnedProcess('/node', [], { ...f.options, onStdout: data => outputs.push(data) });
  f.child.stdout.emit('data', '\x1b[31mAuthorization: Bearer se');
  f.child.stdout.emit('data', 'cret\x1b[0m\npassword=hunter2\0\n');
  f.child.stderr.emit('data', Buffer.alloc(70000, 120));
  f.gone(); close(f.child);
  const result = await pending;
  assert.equal(result.stderrTruncated, true);
  assert.ok(Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) <= 65536);
  assert.doesNotMatch(result.stdout, /hunter2|secret|\x1b|\0/); assert.match(result.stdout, /\[redacted\]/);
  assert.deepEqual(outputs, [result.stdout]);
});

test('timeout escalates only its own group and awaits actual root close before confirmation', async t => {
  const [, { runOwnedProcess }] = await load(); const f = fixture(); let done = false;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = runOwnedProcess('/node', [], { ...f.options, timeoutMs: 3 }).then(value => { done = true; return value; });
  t.mock.timers.tick(3);
  assert.equal(done, false); assert.ok(f.kills.some(([, signal]) => signal === 'SIGTERM'));
  assert.equal(f.kills.some(([, signal]) => signal === 'SIGKILL'), false);
  t.mock.timers.tick(2);
  assert.ok(f.kills.some(([, signal]) => signal === 'SIGKILL'));
  close(f.child, null, 'SIGKILL');
  const result = await pending;
  assert.equal(result.stopReason, 'timeout'); assert.equal(result.signal, 'SIGKILL');
  assert.equal(result.cleanup.confirmed, true); assert.ok(f.kills.every(([pid]) => pid === -8123));
});

test('abort cleanup waits for root close; pre-aborted signals do not spawn or kill anything', async () => {
  const [, { runOwnedProcess }] = await load(); const control = new AbortController(); control.abort(); const f = fixture();
  const before = await runOwnedProcess('/node', [], { ...f.options, signal: control.signal });
  assert.equal(before.stopReason, 'aborted-before-start'); assert.equal(f.calls.length, 0); assert.equal(f.kills.length, 0);
  const active = fixture(), second = new AbortController();
  const pending = runOwnedProcess('/node', [], { ...active.options, signal: second.signal });
  second.abort(); active.gone(); close(active.child, null, 'SIGTERM');
  const result = await pending; assert.equal(result.stopReason, 'aborted'); assert.equal(result.cleanup.confirmed, true);
});

test('a cleanup denial is bounded and explicitly unknown, never misreported as terminated', async () => {
  const [, { runOwnedProcess }] = await load(); const f = fixture({ killError: true });
  const result = await runOwnedProcess('/node', [], { ...f.options, timeoutMs: 2, cleanupMs: 12 });
  assert.equal(result.stopReason, 'timeout'); assert.equal(result.cleanup.confirmed, false);
  assert.ok(result.cleanup.errors.some(error => /Permission denied/.test(error)));
  assert.ok(result.cleanup.errors.some(error => /close was not confirmed/.test(error)));
  assert.ok(f.kills.every(([pid]) => pid === -8123));
  // Late events must not mutate the already returned result or start another kill.
  const count = f.kills.length; close(f.child, 0); f.child.emit('error', new Error('late'));
  await new Promise(resolve => setTimeout(resolve, 5)); assert.equal(f.kills.length, count); assert.equal(result.code, null);
});

test('synchronous and asynchronous launch failure never kill an arbitrary existing process', async () => {
  const [, { runOwnedProcess }] = await load();
  const thrown = await runOwnedProcess('/missing', [], { timeoutMs: 20, spawn() { throw new Error('ENOENT'); } });
  assert.equal(thrown.stopReason, 'start-failed'); assert.match(thrown.startError, /ENOENT/);
  const f = fixture({ pid: undefined }); f.child.pid = undefined;
  const pending = runOwnedProcess('/missing', [], f.options); f.child.emit('error', new Error('ENOENT'));
  const result = await pending; assert.equal(result.stopReason, 'start-failed'); assert.equal(f.kills.length, 0);
  assert.equal(result.cleanup.confirmed, true);
});

test('Windows taskkill uses only the live owned PID and waits for child and helper close', async () => {
  const [, { runOwnedProcess }] = await load(); const f = fixture({ platform: 'win32', helperClose: false });
  const controller = new AbortController(); let done = false;
  const pending = runOwnedProcess('/node', [], { ...f.options, signal: controller.signal }).then(result => { done = true; return result; });
  controller.abort();
  assert.equal(f.calls.length, 2); assert.equal(f.calls[0].settings.detached, false);
  assert.deepEqual(f.calls[1].args, ['/PID', '8123', '/T', '/F']); assert.equal(f.calls[1].settings.shell, false);
  close(f.child, null, 'SIGTERM'); await Promise.resolve(); assert.equal(done, false);
  f.helpers[0].emit('close', 0);
  const result = await pending; assert.equal(result.cleanup.confirmed, true); assert.equal(f.kills.length, 0);
});

test('Windows never invokes taskkill after an observed root exit', async () => {
  const [, { runOwnedProcess }] = await load(); const f = fixture({ platform: 'win32' });
  const pending = runOwnedProcess('/node', [], f.options); close(f.child, 3);
  const result = await pending; assert.equal(result.code, 3); assert.equal(result.cleanup.confirmed, false);
  assert.equal(result.cleanup.rootReaped, true); assert.equal(result.cleanup.descendantsEvidence, 'normal-Windows-descendants-unverified');
  assert.equal(f.calls.length, 1); assert.equal(f.kills.length, 0);
});

test('arguments and timeout windows fail closed before spawn', async () => {
  const [, { runOwnedProcess }] = await load(); const f = fixture();
  for (const options of [{ timeoutMs: 0 }, { timeoutMs: Infinity }, { timeoutMs: 300001 }, { cleanupMs: 10001 }, { cleanupMs: 1, killGraceMs: 2 }])
    await assert.rejects(runOwnedProcess('/node', [], { ...f.options, ...options }), RangeError);
  await assert.rejects(runOwnedProcess('', [], f.options), TypeError);
  await assert.rejects(runOwnedProcess('/node', [4], f.options), TypeError);
  await assert.rejects(runOwnedProcess('/node', [], { ...f.options, signal: {} }), TypeError);
  await assert.rejects(runOwnedProcess('/node', [], { ...f.options, env: null }), TypeError);
  assert.equal(f.calls.length, 0);
});

test('Windows helper failure cannot confirm cleanup and helper timeout stays owned and bounded', async () => {
  const [, { runOwnedProcess }] = await load(); const f = fixture({ platform: 'win32', helperClose: false });
  const controller = new AbortController();
  const pending = runOwnedProcess('/node', [], { ...f.options, signal: controller.signal, cleanupMs: 14 });
  controller.abort(); f.helpers[0].emit('error', new Error('taskkill unavailable'));
  const result = await pending;
  assert.equal(result.cleanup.confirmed, false); assert.equal(result.stopReason, 'aborted');
  assert.ok(result.cleanup.errors.some(error => /taskkill unavailable/.test(error)));
  assert.equal(f.calls[1].args[1], '8123');
  assert.ok(f.kills.every(([target]) => target === 'helper'));
});

test('failed output observers cannot expose raw logs or alter the process exit', async () => {
  const [, { runOwnedProcess }] = await load(); const f = fixture();
  const pending = runOwnedProcess('/node', [], { ...f.options, onStdout(text) {
    assert.doesNotMatch(text, /quoted-value|privatepass/); throw new Error('password=observer-secret');
  } });
  f.child.stdout.emit('data', 'API_KEY="quoted-value" https://name:privatepass@example.com\n');
  f.gone(); close(f.child, 2);
  const result = await pending;
  assert.equal(result.code, 2); assert.doesNotMatch(result.stdout, /quoted-value|privatepass/);
  assert.ok(result.cleanup.errors.some(message => message === 'password=[redacted]'));
});
