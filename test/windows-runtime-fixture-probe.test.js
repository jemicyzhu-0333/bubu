'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { shape, manifest } = require('../scripts/probe-windows-runtime-fixture');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bubu-runtime-probe-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'Local State'), JSON.stringify({ os_crypt: { encrypted_key: 'PRIVATE_SYNTHETIC_VALUE', audit_enabled: true } }));
  return root;
}

test('native probe report retains shape, never preference values or cache bytes', t => {
  const root = fixture(t); fs.mkdirSync(path.join(root, 'ShaderCache'));
  fs.writeFileSync(path.join(root, 'ShaderCache', 'index'), 'PRIVATE_SYNTHETIC_CACHE');
  const report = manifest(root), encoded = JSON.stringify(report);
  assert.doesNotMatch(encoded, /PRIVATE_SYNTHETIC/);
  assert.equal(report.localStateShape.os_crypt.encrypted_key.type, 'string');
  assert.equal(report.localStateShape.os_crypt.audit_enabled, 'boolean');
  assert.deepEqual(report.members.map(value => value.path), ['Local State', 'ShaderCache', 'ShaderCache/index']);
  assert.equal(report.members.at(-1).bytes, 23);
});

test('shape replaces all scalar values and rejects excessive depth', () => {
  assert.deepEqual(shape({ a: [42, true, 'hidden', null] }), { a: { type: 'array', length: 4, items: ['number', 'boolean', { type: 'string', length: 6 }, 'null'] } });
  let deep = {}; for (let i = 0; i < 14; i++) deep = { child: deep };
  assert.throws(() => shape(deep), /too deep/);
});

test('probe refuses oversized preferences', t => {
  const root = fixture(t); fs.writeFileSync(path.join(root, 'Local State'), ' '.repeat(65536));
  assert.throws(() => manifest(root), /evidence bound/);
});

test('probe refuses linked members without following them', { skip: process.platform === 'win32' }, t => {
  const root = fixture(t); fs.symlinkSync('/outside/not-read', path.join(root, 'linked'));
  assert.throws(() => manifest(root), /member type/);
});
