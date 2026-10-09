'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { buildPlan, run } = require('../scripts/build-app');

for (const [platform, flag] of [['win32', 'win'], ['darwin', 'mac'], ['linux', 'linux']]) {
  for (const arch of ['x64', 'arm64']) {
    test(`${platform}/${arch} defaults to its own platform and architecture`, () => {
      const plan = buildPlan({ platform, arch });
      assert.deepEqual(plan.builderArgs, [`--${flag}`, `--${arch}`, '--publish', 'never']);
      assert.deepEqual(plan.prepare, [['scripts/make-icon.js'], ...(platform === 'darwin'
        ? [['scripts/build-activity-probe.js', `--arch=${arch}`]] : [])]);
    });
  }
}
test('explicit targets, unpacked output and matching native architecture', () => {
  const plan = buildPlan({ platform: 'darwin', arch: 'x64', argv: ['--platform=mac', '--dir', '--arm64'] });
  assert.deepEqual(plan.builderArgs, ['--mac', '--arm64', '--dir', '--publish', 'never']);
  assert.equal(plan.prepare[1][1], '--arch=arm64');
  assert.equal(buildPlan({ platform: 'darwin', arch: 'arm64', argv: ['--platform=win', '--x64'] }).target, 'win');
  assert.equal(buildPlan({ platform: 'win32', arch: 'x64', argv: ['--platform=linux'] }).target, 'linux');
});
test('unsupported inputs and non-mac mac builds fail before any effect', () => {
  for (const platform of ['win32', 'linux']) {
    let effects = 0;
    assert.equal(run({ platform, arch: 'x64', argv: ['--platform=mac'],
      spawn: () => { effects++; }, resolveBuilder: () => { effects++; }, report() {} }), 1);
    assert.equal(effects, 0);
  }
  for (const argv of [['--publish', 'always'], ['--mac'], ['--platform=win', '--platform=mac'], ['--x64', '--arm64'], ['--dir', '--dir']]) {
    assert.throws(() => buildPlan({ platform: 'linux', arch: 'x64', argv }));
  }
  assert.throws(() => buildPlan({ platform: 'freebsd', arch: 'x64' }));
  assert.throws(() => buildPlan({ platform: 'win32', arch: 'ia32' }));
});
test('Node invocation is shell-free and preserves spaced paths, order and exit codes', () => {
  const calls = [];
  const options = { platform: 'win32', arch: 'x64', argv: ['--dir'], root: '/test/project with spaces',
    execPath: '/test/node executable', resolveBuilder: () => '/test/builder cli.js', report() {},
    spawn: (...args) => { calls.push(args); return { status: 0 }; } };
  assert.equal(run(options), 0);
  assert.deepEqual(calls.map(c => c[1]), [
    [path.join(options.root, 'scripts/make-icon.js')],
    ['/test/builder cli.js', '--win', '--x64', '--dir', '--publish', 'never']]);
  assert.ok(calls.every(c => c[0] === options.execPath && c[2].shell === false && c[2].cwd === options.root));
  let count = 0;
  assert.equal(run({ ...options, spawn: () => { count++; return { status: 7 }; } }), 7);
  assert.equal(count, 1);
  assert.equal(run({ ...options, spawn: () => ({ status: null, signal: 'SIGTERM' }) }), 1);
  assert.equal(run({ ...options, spawn: () => ({ error: new Error('ENOENT') }) }), 1);
});
test('missing builder fails before icon or native generation', () => {
  let called = false;
  assert.equal(run({ platform: 'linux', arch: 'x64', argv: [], resolveBuilder() { throw new Error('missing'); },
    spawn() { called = true; }, report() {} }), 1);
  assert.equal(called, false);
});
test('native helper compiles selected arch and refuses invalid arch before writes', () => {
  const { run: probeRun } = require('../scripts/build-activity-probe');
  for (const [arg, triple] of [['arm64', 'arm64'], ['x64', 'x86_64']]) {
    const calls = [];
    probeRun({ platform: 'darwin', arch: 'x64', argv: [`--arch=${arg}`], root: '/test/project',
      mkdir: (...args) => calls.push(['mkdir', ...args]), exec: (...args) => calls.push(args), log() {} });
    assert.equal(calls[1][0], 'xcrun');
    assert.equal(calls[1][1][3], `${triple}-apple-macos14.2`);
  }
  let effects = 0;
  const ports = { mkdir() { effects++; }, exec() { effects++; }, log() {} };
  assert.throws(() => probeRun({ platform: 'darwin', arch: 'x64', argv: ['--arch=universal'], ...ports }));
  probeRun({ platform: 'win32', arch: 'x64', argv: [], ...ports });
  assert.equal(effects, 0);
});
