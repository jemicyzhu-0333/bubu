'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validAclReport, verifyProbePermissions, verifyWindowsProbePermissions, ACL_PROGRAM } = require('../src/platform/persistence/sqlite/config-admission-permissions');
const SID = 'S-1-5-21-100-200-300-1001';
const allow = (sid = SID, flags = 0) => ({ sid, type: 'AccessAllowed', flags });
const report = (count = 1) => ({ sid: SID, entries: Array.from({ length: count }, (_, index) => ({
  index, owner: SID, nullDacl: false, reparse: false, directory: index === 0, aces: [allow()]
})) });
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'admission-permissions-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, '探针 & $quote; [data].sqlite'); fs.writeFileSync(file, 'synthetic', { mode: 0o600 });
  return { directory, file };
}
test('trusted current user, SYSTEM and Administrators have explicit owner and grant semantics', () => {
  for (const owner of [SID, 'S-1-5-18', 'S-1-5-32-544']) {
    const value = report(2); value.entries.forEach(entry => { entry.owner = owner; entry.aces = [allow(owner), allow(SID)]; });
    assert.equal(validAclReport(value, 2), true);
  }
});
for (const kind of ['nullDacl', 'empty', 'foreign-owner', 'foreign-allow', 'deny-and-foreign-allow', 'inherit-only-foreign',
  'creator-effective', 'creator-file', 'creator-noninheritable', 'unknown-type', 'unknown-flags', 'reparse', 'missing', 'duplicate', 'extra']) {
  test(`ACL ${kind} fails closed`, () => {
    const value = report(2), entry = value.entries[0];
    if (kind === 'nullDacl') entry.nullDacl = true;
    if (kind === 'empty') entry.aces = [];
    if (kind === 'foreign-owner') entry.owner = 'S-1-1-0';
    if (kind === 'foreign-allow') entry.aces.push(allow('S-1-1-0'));
    if (kind === 'deny-and-foreign-allow') entry.aces.push({ ...allow('S-1-1-0'), type: 'AccessDenied' }, allow('S-1-1-0'));
    if (kind === 'inherit-only-foreign') entry.aces.push(allow('S-1-1-0', 11));
    if (kind === 'creator-effective') entry.aces.push(allow('S-1-3-0', 3));
    if (kind === 'creator-file') value.entries[1].aces.push(allow('S-1-3-0', 11));
    if (kind === 'creator-noninheritable') entry.aces.push(allow('S-1-3-0', 8));
    if (kind === 'unknown-type') entry.aces[0].type = 'SystemAudit';
    if (kind === 'unknown-flags') entry.aces[0].flags = 32;
    if (kind === 'reparse') entry.reparse = true;
    if (kind === 'missing') value.entries.pop();
    if (kind === 'duplicate') value.entries[1].index = 0;
    if (kind === 'extra') value.unexpected = true;
    assert.equal(validAclReport(value, 2), false);
  });
}
test('only directory inherit-only inheritable CREATOR OWNER templates are allowed', () => {
  const value = report(2); value.entries[0].aces.push(allow('S-1-3-0', 11));
  assert.equal(validAclReport(value, 2), true);
});
test('read-only fixed system command receives literal paths through stdin with bounded execution', t => {
  const f = fixture(t); let calls = 0;
  verifyWindowsProbePermissions(f.directory, [f.file], { environment: { SystemRoot: 'C:\\Windows' }, run(executable, args, options) {
    calls++; assert.equal(executable, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    assert.deepEqual(args, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', ACL_PROGRAM]);
    assert.deepEqual(JSON.parse(options.input), [f.directory, f.file]);
    assert.equal(options.shell, false); assert.equal(options.windowsHide, true); assert.equal(options.timeout, 5000);
    assert.equal(options.maxBuffer, 65536); assert.doesNotMatch(ACL_PROGRAM, /Set-Acl|ExecutionPolicy|icacls/i);
    return { status: 0, signal: null, stdout: JSON.stringify(report(2)), stderr: '' };
  } }); assert.equal(calls, 1);
});
for (const result of [{ error: Error('private path timeout') }, { status: 1, stderr: 'private account' },
  { status: 0, stdout: '{}', stderr: '' }, { status: 0, stdout: '{', stderr: '' },
  { status: 0, stdout: JSON.stringify(report()), stderr: 'warning' }]) {
  test('unavailable, denied or malformed ACL observation never leaks details or falls back', t => {
    const f = fixture(t); let calls = 0;
    assert.throws(() => verifyWindowsProbePermissions(f.directory, [], { environment: { SystemRoot: 'C:\\Windows' },
      run: () => { calls++; return result; } }), /^Error: config-admission-permissions-unavailable$/);
    assert.equal(calls, 1);
  });
}
test('ACL paths cannot include outside or duplicate files and no PATH fallback exists', t => {
  const f = fixture(t); let calls = 0;
  const options = { environment: { SystemRoot: 'relative' }, run: () => { calls++; } };
  for (const files of [[], [path.join(path.dirname(f.directory), 'unowned')], [f.file, f.file]]) {
    assert.throws(() => verifyWindowsProbePermissions(f.directory, files, options), /permissions-unavailable/);
  }
  assert.equal(calls, 0);
});
test('descriptor identity change during Windows ACL observation is refused', t => {
  const f = fixture(t);
  assert.throws(() => verifyProbePermissions(f.directory, [f.file], { platform: 'win32', verifyWindows() {
    fs.renameSync(f.file, `${f.file}.retained`); fs.writeFileSync(f.file, 'synthetic', { mode: 0o600 });
  } }), /permissions-unavailable/);
});
test('host private temporary directory and created file satisfy native permissions', t => {
  const f = fixture(t);
  try { verifyProbePermissions(f.directory, [f.file]); }
  catch (error) { t.diagnostic(`native permission stage: ${error.diagnostic}`); throw error; }
});

test('unexpected probe members are rejected before and after the ACL observation', t => {
  const f = fixture(t); let calls = 0;
  assert.throws(() => verifyProbePermissions(f.directory, [], { platform: 'win32', verifyWindows() { calls++; } }), /permissions-unavailable/);
  assert.equal(calls, 0);
  assert.throws(() => verifyProbePermissions(f.directory, [f.file], { platform: 'win32', verifyWindows() {
    fs.writeFileSync(path.join(f.directory, 'unowned'), 'retain');
  } }), /permissions-unavailable/);
  assert.equal(fs.readFileSync(path.join(f.directory, 'unowned'), 'utf8'), 'retain');
});

test('admission verifies all empty-file permissions before copying any private bytes', t => {
  const { admitConfigCopy } = require('../src/platform/persistence/sqlite/config-admission-copy');
  const f = fixture(t), identityPath = path.join(f.directory, 'identity.sqlite');
  fs.writeFileSync(identityPath, 'private identity', { mode: 0o600 });
  const before = fs.readFileSync(f.file); let calls = 0, writes = 0, opened = 0, probe;
  assert.throws(() => admitConfigCopy({ filePath: f.file, identityPath, io: { ...fs,
    writeSync(...args) { writes++; return fs.writeSync(...args); }
  } }, { driver: { open() { opened++; } }, makeHandle() {}, verifyPermissions(directory, files) {
    calls++; probe = directory;
    if (calls === 1) assert.deepEqual(files, []);
    else {
      assert.equal(files.length, 2);
      for (const file of files) assert.equal(fs.statSync(file).size, 0);
      throw new Error('synthetic empty-file ACL rejected');
    }
  } }), /synthetic empty-file ACL rejected/);
  assert.equal(calls, 2); assert.equal(writes, 0); assert.equal(opened, 0);
  assert.deepEqual(fs.readFileSync(f.file), before); assert.equal(fs.existsSync(probe), false);
});

for (const failure of ['fstat', 'close']) {
  test(`admission ${failure} failure still attempts every allocated descriptor close`, t => {
    const { admitConfigCopy } = require('../src/platform/persistence/sqlite/config-admission-copy');
    const f = fixture(t), identityPath = path.join(f.directory, 'identity.sqlite');
    fs.writeFileSync(identityPath, 'private identity', { mode: 0o600 });
    const allocated = new Set(), closed = new Set(); let injected = false, gates = 0, probe;
    const io = { ...fs,
      openSync(target, flags, ...rest) {
        const fd = fs.openSync(target, flags, ...rest);
        if (flags === 'wx') allocated.add(fd);
        return fd;
      },
      fstatSync(fd, ...args) {
        if (failure === 'fstat' && allocated.has(fd) && !injected) { injected = true; throw Error('synthetic fstat failure'); }
        return fs.fstatSync(fd, ...args);
      },
      closeSync(fd) {
        if (allocated.has(fd)) {
          closed.add(fd);
          if (failure === 'close' && !injected) { injected = true; fs.closeSync(fd); throw Error('synthetic close acknowledgement'); }
        }
        return fs.closeSync(fd);
      }
    };
    assert.throws(() => admitConfigCopy({ filePath: f.file, identityPath, io }, { driver: {}, makeHandle() {},
      verifyPermissions(directory) { probe = directory; if (++gates === 2) throw Error('stop before bytes'); }
    }), failure === 'fstat' ? /synthetic fstat failure/ : /config-admission-cleanup-failed/);
    assert.ok(allocated.size >= 1); assert.deepEqual(closed, allocated);
    assert.equal(fs.existsSync(probe), false);
  });
}

for (const [label, result, expected] of [
  ['timeout', { error: { code: 'ETIMEDOUT', message: 'private detail' } }, 'timeout'],
  ['spawn', { error: Error('private detail') }, 'spawn'],
  ['known stage', { status: 1, stderr: 'config-admission-acl:streams' }, 'streams'],
  ['unknown stderr', { status: 1, stderr: 'private account and path' }, 'process-exit'],
  ['CLIXML progress', { status: 0, stdout: JSON.stringify(report()), stderr: '#< CLIXML\n<Objs>private detail</Objs>' }, 'stderr'],
  ['extra stderr', { status: 0, stdout: JSON.stringify(report()), stderr: 'warning' }, 'stderr'],
  ['non-JSON', { status: 0, stdout: 'private detail', stderr: '' }, 'json'],
  ['two BOMs', { status: 0, stdout: '\uFEFF\uFEFF' + JSON.stringify(report()), stderr: '' }, 'json'],
  ['unexpected policy', { status: 0, stdout: '{}', stderr: '' }, 'acl-shape']
]) {
  test(`ACL diagnostic ${label} stays bounded, sanitized and fail-closed`, t => {
    const f = fixture(t);
    assert.throws(() => verifyWindowsProbePermissions(f.directory, [], { environment: { SystemRoot: 'C:\\Windows' }, run: () => result }), error => {
      assert.equal(error.message, 'config-admission-permissions-unavailable');
      assert.equal(error.diagnostic, expected);
      assert.equal(error.cause, undefined);
      assert.doesNotMatch(JSON.stringify(error), /private|CLIXML/);
      return true;
    });
  });
}
test('one optional UTF-8 BOM preserves a valid report without permitting stderr', t => {
  const f = fixture(t);
  verifyWindowsProbePermissions(f.directory, [], { environment: { SystemRoot: 'C:\\Windows' }, run: () => ({
    status: 0, stdout: '\uFEFF' + JSON.stringify(report()), stderr: ''
  }) });
});
test('fixed ACL script uses pipe-local UTF-8 and direct JSON-array assignment on Windows PowerShell 5.1', () => {
  assert.match(ACL_PROGRAM, /StreamReader.*OpenStandardInput/);
  assert.match(ACL_PROGRAM, /StreamWriter.*OpenStandardOutput/);
  assert.doesNotMatch(ACL_PROGRAM, /\[Console\]::(?:Input|Output)Encoding\s*=/);
  assert.match(ACL_PROGRAM, /\$paths = ConvertFrom-Json -InputObject/);
  assert.doesNotMatch(ACL_PROGRAM, /\$paths = @\(/);
  assert.match(ACL_PROGRAM, /\$ProgressPreference = 'SilentlyContinue'/);
});
test('native Windows PowerShell 5.1 protocol rejects empty/nested input and preserves one/multiple literal paths', { skip: process.platform !== 'win32' }, t => {
  const { spawnSync } = require('node:child_process');
  const f = fixture(t), executable = path.win32.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  function run(paths) {
    return spawnSync(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', ACL_PROGRAM], {
      input: JSON.stringify(paths), encoding: 'utf8', shell: false, windowsHide: true, timeout: 5000, maxBuffer: 65536,
      env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PSMODULEPATH'))
    });
  }
  for (const invalid of [[], [[f.directory]], f.directory]) {
    const result = run(invalid);
    assert.equal(result.status, 1, 'native protocol must reject invalid input');
    assert.ok(result.stderr === 'config-admission-acl:input', 'native protocol must reject at the input stage');
    assert.ok(result.stdout === '', 'invalid native input must not emit a report');
  }
  for (const paths of [[f.directory], [f.directory, f.file]]) {
    const result = run(paths);
    const stage = /^config-admission-acl:(streams|input|identity|item|acl(?:-access-denied|-module-load|-command-not-found|-path-not-found|-parameter|-other)?|descriptor|aces|serialize)$/.exec(result.stderr || '')?.[1];
    assert.equal(result.status, 0, `native ACL process failed: ${stage || (result.error?.code === 'ETIMEDOUT' ? 'timeout' : 'process-exit')}`);
    assert.equal(result.stderr.length, 0, 'native ACL process emitted stderr');
    let parsed;
    try { parsed = JSON.parse(result.stdout.replace(/^\uFEFF/, '')); } catch (_) { assert.fail('native ACL output is not JSON'); }
    assert.equal(validAclReport(parsed, paths.length), true, 'native ACL report is invalid or untrusted');
  }
});

test('native subprocess failure at the empty-directory gate prevents every copy and preserves its fixed diagnostic', t => {
  const { admitConfigCopy } = require('../src/platform/persistence/sqlite/config-admission-copy');
  const f = fixture(t), before = fs.readFileSync(f.file); let writes = 0, probe;
  assert.throws(() => admitConfigCopy({ filePath: f.file, identityPath: path.join(f.directory, 'absent-identity'), io: { ...fs,
    writeSync(...args) { writes++; return fs.writeSync(...args); }
  } }, { driver: {}, makeHandle() {}, verifyPermissions(directory, files) {
    probe = directory;
    verifyProbePermissions(directory, files, { platform: 'win32', verifyWindows(dir, members) {
      verifyWindowsProbePermissions(dir, members, { environment: { SystemRoot: 'C:\\Windows' }, run: () => ({ status: 1, stderr: 'config-admission-acl:streams' }) });
    } });
  } }), error => error.code === 'config-admission-permissions-unavailable' && error.diagnostic === 'streams');
  assert.equal(writes, 0); assert.deepEqual(fs.readFileSync(f.file), before); assert.equal(fs.existsSync(probe), false);
});

test('ACL report rejection categories reveal structure only and preserve every trust guard', t => {
  const f = fixture(t);
  const cases = [
    ['acl-shape', value => { value.extra = true; }],
    ['acl-count', value => { value.entries = []; }],
    ['acl-owner', value => { value.entries[0].owner = 'S-1-1-0'; }],
    ['acl-dacl', value => { value.entries[0].nullDacl = true; }],
    ['acl-reparse', value => { value.entries[0].reparse = true; }],
    ['acl-type', value => { value.entries[0].directory = false; }],
    ['acl-ace', value => { value.entries[0].aces[0].type = 'SystemAudit'; }],
    ['acl-grant', value => { value.entries[0].aces.push(allow('S-1-1-0')); }]
  ];
  for (const [diagnostic, mutate] of cases) {
    const value = report(); mutate(value);
    assert.throws(() => verifyWindowsProbePermissions(f.directory, [], { environment: { SystemRoot: 'C:\\Windows' }, run: () => ({
      status: 0, stderr: '', stdout: JSON.stringify(value)
    }) }), error => error.message === 'config-admission-permissions-unavailable' && error.diagnostic === diagnostic);
  }
});

test('Windows probe removes inherited PSModulePath case variants only from its copied child environment', t => {
  const f = fixture(t), environment = Object.freeze({ SystemRoot: 'C:\\Windows', PSModulePath: 'synthetic PS7 modules',
    PSMODULEPATH: 'synthetic uppercase modules', pSmOdUlEpAtH: 'synthetic mixed modules', KEEP: 'unchanged', WinPSModulePath: 'unchanged alternate' });
  verifyWindowsProbePermissions(f.directory, [], { environment, run(_file, _args, options) {
    assert.notEqual(options.env, environment);
    assert.deepEqual(options.env, { SystemRoot: 'C:\\Windows', KEEP: 'unchanged', WinPSModulePath: 'unchanged alternate' });
    return { status: 0, stdout: JSON.stringify(report()), stderr: '' };
  } });
  assert.equal(environment.PSModulePath, 'synthetic PS7 modules');
  assert.equal(environment.PSMODULEPATH, 'synthetic uppercase modules');
  assert.equal(environment.pSmOdUlEpAtH, 'synthetic mixed modules');
});
for (const diagnostic of ['acl-access-denied', 'acl-module-load', 'acl-command-not-found', 'acl-path-not-found', 'acl-parameter', 'acl-other']) {
  test(`native ${diagnostic} is a bounded rejection with no alternate attempt`, t => {
    const f = fixture(t); let calls = 0;
    assert.throws(() => verifyWindowsProbePermissions(f.directory, [], { environment: { SystemRoot: 'C:\\Windows' }, run() {
      calls++; return { status: 1, stderr: `config-admission-acl:${diagnostic}` };
    } }), error => error.code === 'config-admission-permissions-unavailable' && error.diagnostic === diagnostic);
    assert.equal(calls, 1);
  });
}
test('native Windows ACL reader works through an intermediate process with polluted module search without mutating it', { skip: process.platform !== 'win32' }, t => {
  const f = fixture(t), original = fs.readFileSync(f.file), inherited = process.env.PSModulePath;
  const poisoned = path.join(f.directory, 'nonexistent-foreign-modules');
  const environment = { ...process.env, PSModulePath: poisoned };
  try { verifyWindowsProbePermissions(f.directory, [f.file], { environment }); }
  catch (error) { t.diagnostic(`native polluted-environment permission stage: ${error.diagnostic}`); throw error; }
  assert.ok(environment.PSModulePath === poisoned, 'supplied parent environment remains unchanged');
  assert.ok(process.env.PSModulePath === inherited, 'process environment remains unchanged');
  assert.deepEqual(fs.readFileSync(f.file), original);
});

test('an environment without PSModulePath is cloned without changing any keys', t => {
  const f = fixture(t), environment = Object.freeze({ SystemRoot: 'C:\\Windows', Path: 'unchanged', KEEP: 'value' });
  verifyWindowsProbePermissions(f.directory, [], { environment, run(_file, _args, options) {
    assert.notEqual(options.env, environment); assert.deepEqual(options.env, environment);
    return { status: 0, stdout: JSON.stringify(report()), stderr: '' };
  } });
});
