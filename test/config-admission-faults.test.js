'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { verifyProbePermissions } = require('../src/platform/persistence/sqlite/config-admission-permissions');
const { MAX_ADMISSION_BYTES } = require('../src/platform/persistence/sqlite/config-admission-copy');
const { capture, facts, seed, tracedFactory, fixture } = require('../test-support/config-admission-fixture');
function compare(before, after) {
  assert.deepEqual(Object.keys(after), Object.keys(before));
  for (const name of Object.keys(before)) assert.ok(after[name].equals(before[name]), name);
}
function faultFixture(t) {
  const f = fixture(t); seed(f.directory);
  const probes = [], events = [], before = f.capture();
  const io = { ...fs, mkdtempSync(prefix) {
    const directory = fs.mkdtempSync(prefix); probes.push(directory); return directory;
  } };
  t.after(() => { for (const directory of probes) fs.rmSync(directory, { recursive: true, force: true }); });
  function refuse(pattern, onEvent) {
    assert.throws(() => f.open({ io, authorityFactory: tracedFactory(events, onEvent) }), pattern);
    assert.ok(events.every(event => path.dirname(event.filePath) !== f.directory), 'no original SQLite connection');
  }
  return { ...f, before, probes, io, events, refuse };
}
for (const operation of ['mkdtempSync', 'writeSync', 'readSync', 'unlinkSync', 'rmdirSync']) {
  test(`admission ${operation} failure closes before original SQLite and never restores source`, t => {
    const f = faultFixture(t);
    f.io[operation] = () => { throw new Error(`synthetic ${operation} failure`); };
    f.refuse(['unlinkSync', 'rmdirSync'].includes(operation) ? /config-admission-cleanup-failed/ : /synthetic/);
    compare(f.before, f.capture());
    if (!['unlinkSync', 'rmdirSync'].includes(operation)) assert.ok(f.probes.every(directory => !fs.existsSync(directory)));
  });
}
test('short copy writes finish exactly; zero-progress and silently corrupted copies fail closed', t => {
  for (const mode of ['short', 'zero', 'corrupt']) {
    const f = faultFixture(t);
    f.io.writeSync = (fd, bytes, offset, length) => {
      if (mode === 'zero') return 0;
      if (mode === 'short') return fs.writeSync(fd, bytes, offset, Math.min(length, 37));
      const changed = Buffer.from(bytes); changed[offset] ^= 1; return fs.writeSync(fd, changed, offset, length);
    };
    if (mode === 'short') { const repo = f.open({ io: f.io }); repo.close(); }
    else { f.refuse(/config-admission-copy-failed/); compare(f.before, f.capture()); }
    assert.ok(f.probes.every(directory => !fs.existsSync(directory)));
  }
});
test('private probe has bounded membership and owner-only permissions and is removed before original open', t => {
  const f = faultFixture(t); let checked = false;
  const repo = f.open({ io: f.io, authorityFactory: tracedFactory(f.events, event => {
    if (event.kind !== 'open') return;
    if (path.dirname(event.filePath) === f.directory) { assert.ok(checked); assert.ok(f.probes.every(directory => !fs.existsSync(directory))); return; }
    const directory = path.dirname(event.filePath); checked = true;
    verifyProbePermissions(directory, fs.readdirSync(directory).map(name => path.join(directory, name)));
  }) }); repo.close(); assert.equal(checked, true);
});
test('unexpected probe member prevents cleanup/admission without deleting unrelated content', t => {
  const f = faultFixture(t); let injected = false;
  f.refuse(/config-admission-cleanup-failed/, event => {
    if (!injected && event.kind === 'open') { injected = true; fs.writeFileSync(path.join(path.dirname(event.filePath), 'unowned'), 'retain'); }
  });
  assert.equal(fs.readFileSync(path.join(f.probes[0], 'unowned'), 'utf8'), 'retain'); compare(f.before, f.capture());
});
test('replaced probe directory is never recursively deleted', t => {
  const f = faultFixture(t); let injected = false, retained;
  f.refuse(/config-admission-cleanup-failed/, event => {
    if (!injected && event.kind === 'open') {
      injected = true; const directory = path.dirname(event.filePath); retained = `${directory}-retained`;
      fs.renameSync(directory, retained); f.probes.push(retained);
      fs.mkdirSync(directory); fs.writeFileSync(path.join(directory, 'unowned'), 'retain');
    }
  });
  assert.equal(fs.readFileSync(path.join(f.probes[0], 'unowned'), 'utf8'), 'retain');
  assert.ok(fs.readdirSync(retained).some(name => name.endsWith('-0.sqlite'))); compare(f.before, f.capture());
});
for (const targetName of ['config.sqlite', 'config.sqlite.identity.sqlite', 'config.sqlite-wal', 'config.sqlite.identity.sqlite-shm']) {
  test(`symbolic ${targetName} refuses without following or altering its target`, t => {
    const f = faultFixture(t), target = path.join(f.directory, targetName), retained = `${target}.retained`;
    if (fs.existsSync(target)) fs.renameSync(target, retained); else fs.writeFileSync(retained, 'untouched');
    fs.symlinkSync(retained, target); const before = fs.readFileSync(retained), key = fs.lstatSync(target).ino;
    f.refuse(/config-admission-file-invalid/);
    assert.ok(fs.readFileSync(retained).equals(before)); assert.equal(fs.lstatSync(target).ino, key); assert.equal(f.probes.length, 0);
  });
}
test('aggregate byte cap rejects sparse oversize tuple before copying or SQLite', t => {
  const f = faultFixture(t), fd = fs.openSync(f.database, 'r+');
  fs.ftruncateSync(fd, MAX_ADMISSION_BYTES + 1); fs.closeSync(fd);
  const before = fs.statSync(f.database);
  f.refuse(/config-admission-capacity/);
  const after = fs.statSync(f.database); assert.equal(after.size, before.size); assert.equal(after.mtimeMs, before.mtimeMs);
  assert.equal(f.probes.length, 0); assert.equal(f.events.length, 0);
});
for (const kind of ['content', 'membership', 'replacement', 'symlink']) {
  test(`source ${kind} drift after copied validation is refused without rollback`, t => {
    const f = faultFixture(t); let injected = false, changed;
    f.refuse(/config-admission-(source-drift|file-invalid)/, event => {
      if (injected || event.kind !== 'open') return; injected = true;
      if (kind === 'content') { const fd = fs.openSync(f.database, 'r+'); fs.writeSync(fd, Buffer.from('X'), 0, 1, 0); fs.closeSync(fd); }
      if (kind === 'membership') fs.writeFileSync(`${f.database}-shm`, 'new external bytes');
      if (kind === 'replacement' || kind === 'symlink') {
        fs.renameSync(f.database, `${f.database}.retained`);
        if (kind === 'replacement') fs.writeFileSync(f.database, f.before['config.sqlite']);
        else fs.symlinkSync(`${f.database}.retained`, f.database);
      }
      changed = f.capture();
    });
    compare(changed, f.capture()); assert.ok(f.probes.every(directory => !fs.existsSync(directory)));
  });
}
test('same-byte file replacement between lstat and open is refused by descriptor identity', t => {
  const f = faultFixture(t); let replaced = false;
  f.io.openSync = (target, ...args) => {
    if (!replaced && target === f.database) {
      replaced = true; fs.renameSync(target, `${target}.retained`); fs.writeFileSync(target, f.before['config.sqlite']);
    }
    return fs.openSync(target, ...args);
  };
  f.refuse(/config-admission-source-drift/); assert.equal(replaced, true); assert.equal(f.events.length, 0);
  assert.ok(fs.readFileSync(f.database).equals(f.before['config.sqlite']));
});
test('content digest detects drift even if an injected filesystem returns the old stat', t => {
  const f = faultFixture(t), recorded = fs.statSync(f.database, { bigint: true }); let injected = false;
  f.io.lstatSync = (target, ...args) => target === f.database ? recorded : fs.lstatSync(target, ...args);
  f.io.fstatSync = (fd, ...args) => { const current = fs.fstatSync(fd, ...args); return current.ino === recorded.ino ? recorded : current; };
  f.refuse(/config-admission-source-drift/, event => {
    if (injected || event.kind !== 'open') return; injected = true;
    const fd = fs.openSync(f.database, 'r+'); fs.writeSync(fd, Buffer.from('X'), 0, 1, 0); fs.closeSync(fd);
  });
  assert.equal(fs.readFileSync(f.database)[0], 'X'.charCodeAt(0));
});
for (const state of ['fresh', 'initializing-empty', 'initializing-missing', 'initializing-committed']) {
  test(`${state} opens original canonical18 and performs one startup proof`, t => {
    const f = fixture(t);
    if (state.startsWith('initializing')) {
      if (state === 'initializing-committed') {
        seed(f.directory); const identity = new DatabaseSync(f.identity);
        identity.prepare("UPDATE config_identity SET phase='INITIALIZING'").run(); identity.close();
      } else {
        assert.throws(() => f.open({ authorityFactory: tracedFactory([], event => {
          if (event.kind === 'open' && event.filePath === f.database && !event.readOnly) throw new Error('initialization interrupted');
        }) }), /initialization interrupted/);
        if (state === 'initializing-missing') fs.unlinkSync(f.database);
      }
    }
    const events = [], repo = f.open({ authorityFactory: tracedFactory(events) });
    assert.equal(repo.snapshot().schemaVersion, 18); const snapshot = repo.snapshot(), revision = repo.revision(); repo.close();
    const proof = events.filter(event => event.sql?.startsWith('UPDATE config_snapshot SET verification_count='));
    assert.equal(proof.length, 1); assert.equal(proof[0].filePath, f.database);
    const next = f.open(); assert.deepEqual(next.snapshot(), snapshot); assert.equal(next.revision(), revision); next.close();
    assert.equal(fs.existsSync(path.join(f.directory, 'config.json')), false);
  });
}
test('INITIALIZING source-binding conflict rejects on copy without original connections', t => {
  const f = fixture(t);
  assert.throws(() => f.open({ authorityFactory: tracedFactory([], event => {
    if (event.kind === 'open' && event.filePath === f.database && !event.readOnly) throw new Error('interrupted');
  }) }), /interrupted/);
  const identity = new DatabaseSync(f.identity); identity.prepare('UPDATE config_identity SET source_length=1').run(); identity.close();
  const before = f.capture(), events = [];
  assert.throws(() => f.open({ authorityFactory: tracedFactory(events) }), /config-import-source-conflict/);
  compare(before, f.capture()); assert.ok(events.every(event => path.dirname(event.filePath) !== f.directory));
  assert.deepEqual(facts(before), facts(capture(f.directory)));
});

test('initial probe stat failure removes only its newly allocated empty directory', t => {
  const f = faultFixture(t); let failed = false;
  f.io.lstatSync = (target, ...args) => {
    if (!failed && f.probes.includes(target)) { failed = true; throw new Error('initial stat failed'); }
    return fs.lstatSync(target, ...args);
  };
  f.refuse(/initial stat failed/); assert.equal(failed, true);
  assert.ok(f.probes.every(directory => !fs.existsSync(directory))); compare(f.before, f.capture());
});
test('observed replacement during cleanup stops before any subsequent member or original SQLite open', t => {
  const f = faultFixture(t); let replaced = false, retained, replacement;
  f.io.unlinkSync = target => {
    fs.unlinkSync(target);
    if (!replaced) {
      replaced = true; const directory = path.dirname(target); retained = `${directory}-retained`;
      fs.renameSync(directory, retained); f.probes.push(retained); fs.mkdirSync(directory);
      fs.writeFileSync(path.join(directory, path.basename(target)), 'unrelated replacement'); replacement = capture(directory);
    }
  };
  f.refuse(/config-admission-cleanup-failed/);
  compare(replacement, capture(f.probes[0])); compare(f.before, f.capture());
});
