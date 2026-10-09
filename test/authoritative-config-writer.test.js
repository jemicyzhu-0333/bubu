'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createAuthoritativeConfigWriter } = require('../src/platform/persistence/authoritative-config-writer');
const directories = [];
function fixture() { const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'authoritative-config-')); directories.push(directory);
 const filePath = path.join(directory, 'config.json'); fs.writeFileSync(filePath, '{"old":true}'); return { directory, filePath }; }
test.after(() => { for (const directory of directories) fs.rmSync(directory, { recursive: true, force: true }); });
test('same-directory authoritative replacement flushes temp, rename and directory without direct overwrite', () => {
 const f = fixture(), events = [];
 const writer = createAuthoritativeConfigWriter({ filePath: f.filePath, io: { ...fs,
  renameSync: (from, to) => { events.push('rename'); assert.equal(path.dirname(from), path.dirname(to)); fs.renameSync(from, to); },
  fsyncSync: fd => { events.push(fs.fstatSync(fd).isDirectory() ? 'directory' : 'file'); fs.fsyncSync(fd); } } });
 assert.deepEqual(writer.write({ next: true }), { committed: true, durable: true, uncertain: false });
 assert.deepEqual(JSON.parse(fs.readFileSync(f.filePath)), { next: true });
 assert.ok(events.indexOf('file') < events.indexOf('rename')); assert.equal(events.at(-1), 'directory');
});
test('EXDEV and temp partial EIO preserve original bytes with no non-atomic fallback', () => {
 for (const kind of ['EXDEV', 'EIO']) { const f = fixture(), original = fs.readFileSync(f.filePath); let directWrites = 0;
  const writer = createAuthoritativeConfigWriter({ filePath: f.filePath, io: { ...fs,
   renameSync: (...args) => { if (kind === 'EXDEV') throw Object.assign(new Error('cross device'), { code: 'EXDEV' }); fs.renameSync(...args); },
   writeFileSync: (fd, bytes) => { if (typeof fd === 'string') directWrites++; if (kind === 'EIO') { fs.writeFileSync(fd, bytes.subarray(0, 2)); throw new Error('partial'); } fs.writeFileSync(fd, bytes); } } });
  assert.throws(() => writer.write({ next: true })); assert.deepEqual(fs.readFileSync(f.filePath), original); assert.equal(directWrites, 0);
  assert.deepEqual(fs.readdirSync(f.directory), ['config.json']);
 }
});
test('post-rename directory failure is landed but unconfirmed, same file flush retry restores proof', () => {
 const f = fixture(); let renamed = false, failing = true;
 const writer = createAuthoritativeConfigWriter({ filePath: f.filePath, io: { ...fs,
  renameSync: (...args) => { fs.renameSync(...args); renamed = true; },
  fsyncSync: fd => { if (renamed && failing && fs.fstatSync(fd).isDirectory()) throw new Error('directory flush'); fs.fsyncSync(fd); } } });
 assert.deepEqual(writer.write({ next: true }), { committed: true, durable: false, uncertain: true });
 assert.deepEqual(JSON.parse(fs.readFileSync(f.filePath)), { next: true }); assert.equal(writer.verify().ok, false);
 failing = false; assert.equal(writer.verify().ok, true); assert.deepEqual(JSON.parse(fs.readFileSync(f.filePath)), { next: true });
});
test('unsupported Windows durability refuses before creating or touching a canonical file', () => {
 const f = fixture(); const original = fs.readFileSync(f.filePath);
 const writer = createAuthoritativeConfigWriter({ filePath: f.filePath, platform: 'win32', io: { ...fs,
  openSync: (name, ...args) => { if (name === f.directory) throw Object.assign(new Error('unsupported'), { code: 'EPERM' }); return fs.openSync(name, ...args); } } });
 assert.equal(writer.status().available, false); assert.throws(() => writer.write({ next: true }), /unavailable/);
 assert.deepEqual(fs.readFileSync(f.filePath), original); assert.deepEqual(fs.readdirSync(f.directory), ['config.json']);
});

test('manual save remains atomic when strong directory proof is unavailable', () => {
 const f = fixture(); const writer = createAuthoritativeConfigWriter({ filePath: f.filePath, platform: 'win32', io: { ...fs,
  openSync: (name, ...args) => { if (name === f.directory) throw Object.assign(new Error('unsupported'), { code: 'EPERM' }); return fs.openSync(name, ...args); } } });
 assert.equal(writer.status().available, false);
 assert.deepEqual(writer.write({ manual: true }, { requireDurable: false }), { committed: true, durable: false, uncertain: true });
 assert.deepEqual(JSON.parse(fs.readFileSync(f.filePath)), { manual: true });
});
