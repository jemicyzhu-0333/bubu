'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { admitsWindowsRuntimeCache, validRuntimeState } = require('../src/platform/persistence/sqlite/config-runtime-cache-admission');
const { admitConfigCopy } = require('../src/platform/persistence/sqlite/config-admission-copy');
const state = () => ({ os_crypt: { audit_enabled: true, encrypted_key: Buffer.alloc(64, 123).toString('base64') }, uninstall_metrics: { installation_date2: '1234567890' } });
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bubu-runtime-unit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, '中文 空格'); fs.mkdirSync(directory);
  const gpu = 'GPUPersistentCache/DawnGraphiteCache/JDILZQMYHSFMNNX7CM2QEGAFD2VTODWT';
  fs.mkdirSync(path.join(directory, gpu), { recursive: true });
  for (const name of ['cache.db', 'cache.db-wal', 'cache.journal']) fs.writeFileSync(path.join(directory, gpu, name), 'synthetic cache');
  for (const dir of ['GrShaderCache', 'ShaderCache']) {
    fs.mkdirSync(path.join(directory, dir));
    for (const name of ['index', 'data_0', 'data_1', 'data_2', 'data_3']) fs.writeFileSync(path.join(directory, dir, name), 'synthetic cache');
  }
  fs.writeFileSync(path.join(directory, 'Local State'), JSON.stringify(state()));
  fs.writeFileSync(path.join(directory, 'lockfile'), '');
  return directory;
}
// This is a synthetic metadata port, not native Windows reparse evidence.
function inspect(directory) {
  const entries = [];
  function walk(relativePath) {
    const stat = fs.lstatSync(path.join(directory, relativePath));
    const kind = stat.isDirectory() ? 'directory' : 'file';
    entries.push({ relativePath, kind, attributes: kind === 'directory' ? 16 : 32 });
    if (stat.isDirectory()) for (const name of fs.readdirSync(path.join(directory, relativePath))) walk(relativePath ? `${relativePath}/${name}` : name);
  }
  walk(''); return entries;
}
const options = { platform: 'win32', inspectRuntimeTree: inspect };
function snapshot(directory) { return inspect(directory).map(entry => ({ ...entry, stat: fs.lstatSync(path.join(directory, entry.relativePath), { bigint: true }), bytes: entry.kind === 'file' ? fs.readFileSync(path.join(directory, entry.relativePath)) : null })); }
function unchanged(before, directory) {
  for (const entry of before) {
    const target = path.join(directory, entry.relativePath), after = fs.lstatSync(target, { bigint: true });
    for (const field of ['ino', 'size', 'mtimeNs', 'ctimeNs']) assert.equal(after[field], entry.stat[field]);
    if (entry.bytes) assert.deepEqual(fs.readFileSync(target), entry.bytes);
  }
}
test('exact native minimal topology plus singleton lock admits in Chinese/space path without reading cache or changing original bytes', t => {
  const directory = fixture(t), before = snapshot(directory); let opens = 0;
  const io = { ...fs, openSync(target, ...args) { assert.equal(path.basename(target), 'Local State'); opens++; return fs.openSync(target, ...args); } };
  assert.equal(admitsWindowsRuntimeCache(directory, { ...options, io }), true);
  assert.equal(opens, 1); unchanged(before, directory);
  assert.equal(admitsWindowsRuntimeCache(directory, options), true); unchanged(before, directory);
});
test('fresh admission integrates runtime exception without creating or interpreting business authority', t => {
  const directory = fixture(t), before = snapshot(directory);
  assert.equal(admitConfigCopy({ filePath: path.join(directory, 'config.sqlite'), identityPath: path.join(directory, 'config.sqlite.identity.sqlite') }, options), null);
  unchanged(before, directory); assert.equal(fs.existsSync(path.join(directory, 'config.sqlite')), false);
});
for (const member of ['ai-credential.bin', 'unknown.sqlite', 'config.sqlite-WAL', 'CONFIG.SQLITE', '.hidden', 'Network', 'ShaderCache/config.sqlite', 'GrShaderCache/data_4', 'ShaderCache/Index', 'GPUPersistentCache/cache.db']) {
  test(`unknown or business-shaped member remains refused: ${member}`, t => {
    const directory = fixture(t); fs.writeFileSync(path.join(directory, member), 'preserve me');
    const before = snapshot(directory); assert.equal(admitsWindowsRuntimeCache(directory, options), false); unchanged(before, directory);
  });
}
for (const modify of [s => { s.extra = true; }, s => { s.os_crypt.extra = true; }, s => { s.os_crypt.encrypted_key = 'not base64!'; }, s => { s.os_crypt.audit_enabled = 1; }, s => { s.uninstall_metrics.installation_date2 = 123; }]) {
  test('Local State closed structure refuses unobserved fields/types/encoding', t => {
    const directory = fixture(t), value = state(); modify(value);
    fs.writeFileSync(path.join(directory, 'Local State'), JSON.stringify(value));
    assert.equal(admitsWindowsRuntimeCache(directory, options), false);
  });
}
for (const bytes of [Buffer.alloc(65537, 32), Buffer.from([255, 254]), Buffer.from('{"x":1e999}'), Buffer.from('{"os_crypt":{},"os_crypt":{}}')]) {
  test(`malformed or oversized Local State fails closed (${bytes.length} bytes)`, t => {
    const directory = fixture(t); fs.writeFileSync(path.join(directory, 'Local State'), bytes);
    assert.equal(admitsWindowsRuntimeCache(directory, options), false);
  });
}
test('oversized Local State is rejected before open or allocation', t => {
  const directory = fixture(t); fs.writeFileSync(path.join(directory, 'Local State'), Buffer.alloc(65537));
  assert.equal(admitsWindowsRuntimeCache(directory, { ...options, io: { ...fs, openSync() { throw Error('must not open'); } } }), false);
});
test('missing screenshot member, nonempty lock, and non-Windows profile do not take exception', t => {
  const directory = fixture(t); assert.equal(admitsWindowsRuntimeCache(directory, { ...options, platform: 'linux' }), false);
  fs.writeFileSync(path.join(directory, 'lockfile'), 'unknown'); assert.equal(admitsWindowsRuntimeCache(directory, options), false);
  fs.unlinkSync(path.join(directory, 'lockfile')); fs.rmSync(path.join(directory, 'ShaderCache'), { recursive: true });
  assert.equal(admitsWindowsRuntimeCache(directory, options), false);
});
test('symlink and hardlink Local State cannot become recognized runtime', t => {
  const directory = fixture(t), target = path.join(directory, 'Local State'), other = path.join(path.dirname(directory), 'outside');
  fs.renameSync(target, other); fs.symlinkSync(other, target); assert.equal(admitsWindowsRuntimeCache(directory, options), false);
  fs.unlinkSync(target); fs.linkSync(other, target); assert.equal(admitsWindowsRuntimeCache(directory, options), false);
});
test('native hidden/reparse evidence and unavailable inspection refuse before Local State reads', t => {
  const directory = fixture(t);
  for (const attributes of [34, 1056]) assert.throws(() => admitsWindowsRuntimeCache(directory, { ...options, inspectRuntimeTree(root) { const entries = inspect(root); entries.find(e => e.relativePath === 'Local State').attributes = attributes; return entries; } }), /config-runtime-attributes-unavailable/);
});
test('directory membership drift is detected before reading runtime state', t => {
  const directory = fixture(t); let reads = 0;
  const io = { ...fs, readdirSync(target) { const names = fs.readdirSync(target); return target === directory ? [...names, 'new-business.sqlite'] : names; }, openSync() { reads++; throw Error('must not read'); } };
  assert.equal(admitsWindowsRuntimeCache(directory, { ...options, io }), false); assert.equal(reads, 0);
});
test('Local State descriptor identity drift is detected', t => {
  const directory = fixture(t); const io = { ...fs, fstatSync(fd, opts) { const stat = fs.fstatSync(fd, opts); stat.ino += 1n; return stat; } };
  assert.equal(admitsWindowsRuntimeCache(directory, { ...options, io }), false);
});
test('opaque synthetic key is only shape evidence, never a brand or DPAPI authenticity claim', () => {
  assert.equal(validRuntimeState(state()), true);
  const value = state(); value.os_crypt.encrypted_key = Buffer.alloc(128, 42).toString('base64'); assert.equal(validRuntimeState(value), true);
});
test('unknown top-level data rejects on repeated launch without native enumeration or writes', t => {
  const directory = fixture(t); fs.writeFileSync(path.join(directory, 'ai-credential.bin'), 'synthetic credential');
  const before = snapshot(directory); let inspections = 0;
  for (let attempt = 0; attempt < 2; attempt++) assert.throws(() => admitConfigCopy({ filePath: path.join(directory, 'config.sqlite'), identityPath: path.join(directory, 'config.sqlite.identity.sqlite') }, { ...options, inspectRuntimeTree() { inspections++; throw Error('must not inspect unknown tree'); } }), /config-profile-brand-required/);
  assert.equal(inspections, 0); unchanged(before, directory);
});
