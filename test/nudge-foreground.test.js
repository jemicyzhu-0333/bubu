'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { probeForegroundApp, windowsForegroundCommand } = require('../src/platform/electron/nudge-foreground');
const { nudgePolicy } = require('../src/capabilities/attention');

function harness(overrides = {}) {
  const calls = [];
  const timers = new Map();
  let nextTimer = 0;
  let killed = 0;
  const signal = new AbortController();
  const launch = (file, args, options, callback) => {
    calls.push({ file, args, options, callback });
    return { kill() { killed += 1; } };
  };
  const request = {
    platform: 'win32', appPath: '/synthetic/app', resourcesPath: '/synthetic/resources', isPackaged: false,
    exists: () => true, whitelist: ['zoom'], signal: signal.signal,
    exec: (file, options, callback) => launch(file, [], options, callback), execFile: launch,
    setTimer: (callback, delay) => { timers.set(++nextTimer, { callback, delay }); return nextTimer; },
    clearTimer: timer => timers.delete(timer), ...overrides
  };
  return { calls, timers, signal, probe: () => probeForegroundApp(request), killed: () => killed };
}

test('Windows one-shot is independent of activity mirroring and returns known process identity', async () => {
  const h = harness({ activityMirrorEnabled: false });
  const pending = h.probe();
  assert.equal(h.calls.length, 1);
  const call = h.calls[0];
  assert.equal(call.file, 'powershell.exe');
  assert.deepEqual(call.args, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', path.join('/synthetic', 'app', 'native', 'windows', 'nudge-foreground.ps1')]);
  assert.equal(call.options.shell, false);
  assert.equal(call.options.timeout, 3000);
  assert.equal(call.options.maxBuffer, 512);
  assert.equal(call.options.windowsHide, true);
  call.callback(null, 'foreground-v1:Editor.EXE\r\n');
  assert.deepEqual(await pending, { appName: 'editor', inWhitelist: false });
  assert.equal(h.timers.size, 0);
});

test('Windows aliases apply only to selected whitelist names, with conservative existing substring matching', async () => {
  const groups = [
    ['tencent meeting', 'WeMeetApp'], ['腾讯会议', 'wemeet'], ['腾讯会议', 'TencentMeeting'],
    ['钉钉会议', 'DingTalk'], ['wechat', 'Weixin'], ['飞书', 'Feishu'], ['飞书', 'Lark'],
    ['obs', 'obs64'], ['obs', 'obs32'], ['quicktime', 'QuickTimePlayer'],
    ['camtasia', 'CamRecorder'], ['powerpoint', 'POWERPNT.EXE'],
    ['microsoft teams', 'ms-teams'], ['teams', 'Teams'], ['zoom', 'Zoom'], ['steam', 'Steam'],
    ['game', 'ExampleGame'], ['custom app', 'Custom App.EXE']
  ];
  for (const [entry, process] of groups) {
    const h = harness({ whitelist: [entry] }); const pending = h.probe();
    h.calls[0].callback(null, `foreground-v1:${process}\n`);
    assert.equal((await pending).inWhitelist, true, `${entry}: ${process}`);
    assert.equal(nudgePolicy.matchesForegroundWhitelist(process, [], 'win32'), false);
    assert.equal(nudgePolicy.matchesForegroundWhitelist(process, ['unrelated'], 'win32'), false);
  }
  assert.equal(nudgePolicy.matchesForegroundWhitelist('powerpnt', ['powerpoint'], 'darwin'), false);
  assert.equal(nudgePolicy.matchesForegroundWhitelist('Microsoft PowerPoint', ['powerpoint'], 'darwin'), true);
});

test('malformed, missing, duplicate, oversized and path-like Windows outputs are unknown', async () => {
  for (const output of [undefined, null, '', 'Editor', 'foreground-v2:Editor', 'foreground-v1:',
    'foreground-v1:Editor\nforeground-v1:Zoom\n', 'foreground-v1:Editor\nwarning',
    'foreground-v1:C:\\Apps\\Editor.exe', 'foreground-v1:/app/Editor',
    'foreground-v1:Editor\0', 'foreground-v1:Editor\t', 'foreground-v1: Editor', 'foreground-v1:Editor ',
    `foreground-v1:${'a'.repeat(201)}`, `foreground-v1:Editor${' '.repeat(512)}`,
    '{"v":1,"process":"Editor","process":"Zoom"}', Buffer.from('foreground-v1:Editor'),
    { toString() { throw new Error('must not coerce'); } }]) {
    const h = harness(); const pending = h.probe();
    h.calls[0].callback(null, output);
    assert.equal(await pending, null);
    assert.equal(h.timers.size, 0);
  }
});

test('error, policy denial, spawn throw and missing helper fail closed without alternate routes', async () => {
  for (const error of [new Error('denied by execution policy'), new Error('process error'), new Error('maxBuffer exceeded')]) {
    const h = harness(); const pending = h.probe(); h.calls[0].callback(error, 'foreground-v1:Editor');
    assert.equal(await pending, null); assert.equal(h.calls.length, 1);
  }
  const throwing = harness({ execFile() { throw new Error('spawn failure'); } });
  assert.equal(await throwing.probe(), null); assert.equal(throwing.timers.size, 0);
  for (const exists of [() => false, () => { throw new Error('unavailable'); }]) {
    const missing = harness({ exists });
    assert.equal(await missing.probe(), null); assert.equal(missing.calls.length, 0);
  }
});

test('timeout and pre/mid-abort settle once and kill; late or duplicate callbacks cannot change the result', async () => {
  const pre = harness(); pre.signal.abort();
  assert.equal(await pre.probe(), null); assert.equal(pre.calls.length, 0);
  for (const mode of ['timeout', 'abort']) {
    const h = harness(); const pending = h.probe(); const callback = h.calls[0].callback;
    if (mode === 'abort') h.signal.abort();
    else [...h.timers.values()][0].callback();
    assert.equal(await pending, null); assert.equal(h.killed(), 1); assert.equal(h.timers.size, 0);
    callback(null, 'foreground-v1:Editor'); callback(null, 'foreground-v1:Zoom');
    assert.equal(await pending, null); assert.equal(h.killed(), 1);
  }
  const h = harness(); const pending = h.probe();
  h.calls[0].callback(null, 'foreground-v1:Zoom'); h.calls[0].callback(null, 'foreground-v1:Editor'); h.signal.abort();
  assert.equal((await pending).inWhitelist, true); assert.equal(h.killed(), 0);
});

test('abort during synchronous launch kills the returned child, with no surviving listener/timer', async () => {
  const signal = new AbortController(); let killed = 0;
  const h = harness({ signal: signal.signal, execFile(_file, _args, _options, callback) {
    signal.abort(); callback(null, 'foreground-v1:Editor'); return { kill() { killed += 1; } };
  } });
  assert.equal(await h.probe(), null); assert.equal(killed, 1); assert.equal(h.timers.size, 0);
});

test('packaged/dev helpers resolve exactly, missing packaged helper never falls back, user strings are not commands', async () => {
  for (const isPackaged of [false, true]) {
    const existsCalls = [];
    const h = harness({ isPackaged, whitelist: ['$(payload)', '"; Write-Host secret'],
      exists: file => { existsCalls.push(file); return true; } });
    const pending = h.probe();
    const expected = isPackaged ? path.join('/synthetic', 'resources', 'nudge-foreground', 'nudge-foreground.ps1')
      : path.join('/synthetic', 'app', 'native', 'windows', 'nudge-foreground.ps1');
    assert.deepEqual(existsCalls, [expected]); assert.equal(h.calls[0].args.at(-1), expected);
    assert.equal(JSON.stringify(h.calls[0]).includes('payload'), false);
    h.calls[0].callback(null, 'foreground-v1:Editor'); await pending;
  }
  const missing = [];
  assert.equal(windowsForegroundCommand({ isPackaged: true, resourcesPath: '/synthetic/resources',
    exists: file => { missing.push(file); return false; } }), null);
  assert.equal(missing.length, 1);
  assert.equal(windowsForegroundCommand({ isPackaged: true, resourcesPath: undefined }), null);
  assert.equal(windowsForegroundCommand({ appPath: '/synthetic/resources/app.asar', resourcesPath: '/synthetic/resources',
    exists: () => true }).args.at(-1), path.join('/synthetic', 'resources', 'nudge-foreground', 'nudge-foreground.ps1'));
});

test('macOS preserves application matching while rejecting duplicate/malformed/oversized output; unsupported never launches', async () => {
  for (const [output, expected] of [['"LSDisplayName"="Zoom"\n', true], ['"LSDisplayName"="Editor"', false],
    ['Editor', null], ['"LSDisplayName"="Editor"\n"LSDisplayName"="Zoom"', null],
    [`"LSDisplayName"="${'x'.repeat(201)}"`, null], ['"LSDisplayName"="Editor"' + ' '.repeat(512), null]]) {
    const h = harness({ platform: 'darwin' }); const pending = h.probe();
    assert.equal(h.calls[0].file, '/usr/bin/lsappinfo info -only name "$(/usr/bin/lsappinfo front)"');
    assert.equal(h.calls[0].options.maxBuffer, 512); h.calls[0].callback(null, output);
    const result = await pending;
    assert.equal(result ? result.inWhitelist : null, expected);
  }
  for (const platform of ['linux', 'freebsd', 'unknown']) {
    const h = harness({ platform }); assert.equal(await h.probe(), null); assert.equal(h.calls.length, 0);
  }
});

test('Windows packaging contains the separate one-shot helper without enabling automatic publishing', () => {
  const root = path.join(__dirname, '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.ok(pkg.build.win.extraResources.some(entry => entry.from === 'native/windows/nudge-foreground.ps1'
    && entry.to === 'nudge-foreground/nudge-foreground.ps1'));
  // Packaging is now host-local; retaining a mac-only script is no longer a safety boundary.
  // The one-shot helper's privacy guard below and the no-publish build contract remain mandatory.
  assert.equal(pkg.scripts.build, 'node scripts/build-app.js');
  assert.equal(pkg.scripts['build:win'], 'node scripts/build-app.js --platform=win');
  const { buildPlan } = require('../scripts/build-app');
  const plan = buildPlan({ platform: 'win32', arch: 'x64',
    argv: pkg.scripts['build:win'].split(' ').slice(2) });
  assert.equal(plan.target, 'win');
  assert.deepEqual(plan.builderArgs, ['--win', '--x64', '--publish', 'never',
    '--config.extraMetadata.bubuCapabilities.schemaVersion=1', '--config.extraMetadata.bubuCapabilities.aiDiagnostics=false']);
  assert.deepEqual(plan.prepare, [['scripts/make-icon.js']], 'Windows must not compile the macOS helper');
  const helper = fs.readFileSync(path.join(root, 'native/windows/nudge-foreground.ps1'), 'utf8');
  assert.match(helper, /GetForegroundWindow/); assert.match(helper, /GetWindowThreadProcessId/); assert.match(helper, /process\.ProcessName/);
  assert.doesNotMatch(helper, /GetWindowText|MainWindowTitle|MainModule|FileName|Audio|while\s*\(|Start-Sleep|ExecutionPolicy|Set-Item|WriteAllText/);
  assert.equal((helper.match(/Out\.WriteLine/g) || []).length, 1);
});

test('strict single-line framing rejects bare CR and internal whitespace line breaks', async () => {
  for (const [platform, stdout] of [
    ['win32', 'foreground-v1:Editor\r'], ['win32', 'foreground-v1:Editor\n\n'],
    ['win32', 'foreground-v1:Editor\r\n\n'], ['darwin', '"LSDisplayName"="Editor"\r'],
    ['darwin', '"LSDisplayName"="Editor"\n\n'], ['darwin', '"LSDisplayName"\n="Editor"\n'],
    ['darwin', '"LSDisplayName"=\n"Editor"\n'], ['darwin', '"LSDisplayName"\r="Editor"']
  ]) {
    const h = harness({ platform }); const pending = h.probe(); h.calls[0].callback(null, stdout);
    assert.equal(await pending, null, JSON.stringify({ platform, stdout }));
  }
  const h = harness({ platform: 'darwin' }); const pending = h.probe();
  h.calls[0].callback(null, '"LSDisplayName" \t=\t "Editor"\r\n');
  assert.deepEqual(await pending, { appName: 'Editor', inWhitelist: false });
});

test('even successful exits with a valid identity fail closed when stderr is nonempty or malformed', async () => {
  for (const platform of ['win32', 'darwin']) {
    for (const stderr of ['synthetic diagnostic\n', ' ', '\n', 'x'.repeat(513), null, Buffer.from('warning')]) {
      const h = harness({ platform }); const pending = h.probe();
      const stdout = platform === 'win32' ? 'foreground-v1:Editor\n' : '"LSDisplayName"="Editor"\n';
      h.calls[0].callback(null, stdout, stderr);
      assert.equal(await pending, null); assert.equal(h.timers.size, 0);
    }
  }
});
