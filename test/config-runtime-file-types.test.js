'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { inspectWindowsRuntimeTree, validateRuntimeTree, ATTRIBUTE_PROGRAM } = require('../src/platform/persistence/sqlite/config-runtime-file-types');
const environment = { SystemRoot: 'C:\\Windows', PSModulePath: 'incompatible', keep: 'value' };
const directory = 'C:\\Users\\中文 空格\\bubu';
const root = { relativePath: '', kind: 'directory', attributes: 16 };
const file = { relativePath: 'Local State', kind: 'file', attributes: 32 };

test('runtime attributes enumerate through fixed read-only source with literal stdin path', () => {
  let calls = 0;
  const result = inspectWindowsRuntimeTree(directory, { environment, run(executable, args, options) {
    calls++;
    assert.equal(executable, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    assert.equal(args.at(-1), ATTRIBUTE_PROGRAM); assert.ok(!args.join(' ').includes(directory));
    assert.equal(JSON.parse(options.input), directory);
    assert.equal(options.env.PSModulePath, undefined); assert.equal(options.env.keep, 'value');
    assert.equal(options.timeout, 15000); assert.equal(options.windowsHide, true);
    return { status: 0, stderr: '', stdout: JSON.stringify({ entries: [root, file] }) };
  } });
  assert.equal(calls, 1); assert.deepEqual(result, [root, file]);
  assert.doesNotMatch(ATTRIBUTE_PROGRAM, /Set-Acl|Set-Item|Remove-Item|ExecutionPolicy|-Recurse/);
});

for (const value of [1024, 34, 36, '32', -1, 4294967328, 16]) {
  test(`runtime attribute evidence rejects links, hidden/system and malformed file flags: ${value}`, () => {
    assert.throws(() => validateRuntimeTree({ entries: [root, { ...file, attributes: value }] }), /unavailable/);
  });
}
for (const relativePath of ['../outside', '/absolute', 'C:/escape', 'ShaderCache/../escape', 'ShaderCache//index', 'ShaderCache\\index', 'not-listed-parent/index']) {
  test(`runtime tree rejects unsafe or detached paths: ${relativePath}`, () => {
    assert.throws(() => validateRuntimeTree({ entries: [root, { ...file, relativePath }] }), /unavailable/);
  });
}
test('runtime report is closed, bounded and cannot duplicate paths or omit root', () => {
  for (const report of [{ entries: [root, file, file] }, { entries: [file] }, { entries: [root], extra: true },
    { entries: [root, { ...file, extra: true }] }, { entries: Array(258).fill(root) }]) {
    assert.throws(() => validateRuntimeTree(report), /unavailable/);
  }
});
for (const result of [{ status: 1 }, { error: Error('timeout') }, { status: 0, stderr: 'warning', stdout: '{}' },
  { status: 0, stderr: '', stdout: 'not-json' }]) {
  test(`runtime attributes fail closed without retries on unavailable evidence ${JSON.stringify(result)}`, () => {
    let calls = 0;
    assert.throws(() => inspectWindowsRuntimeTree(directory, { environment, run: () => { calls++; return result; } }), /unavailable/);
    assert.equal(calls, 1);
  });
}
