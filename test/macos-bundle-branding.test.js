'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { verifyBundleIdentity } = require('../scripts/verify-macos-app');
const pkg = require('../package.json');
const expected = {
  CFBundleDisplayName: '小步', CFBundleName: '小步',
  CFBundleExecutable: '小步', CFBundleIdentifier: 'com.bubu.app'
};

test('macOS package verification checks actual display, executable and stable bundle identities', () => {
  const seen = [];
  const app = path.resolve('synthetic 小步.app');
  const result = verifyBundleIdentity(app, pkg, (plist, key) => {
    seen.push([plist, key]); return expected[key];
  });
  assert.deepEqual(result, expected);
  assert.deepEqual(seen, Object.keys(expected).map(key => [path.join(app, 'Contents', 'Info.plist'), key]));
});

for (const key of Object.keys(expected)) test(`macOS package verification rejects a mismatched ${key}`, () => {
  assert.throws(() => verifyBundleIdentity('synthetic 小步.app', pkg, (_plist, requested) => (
    requested === key ? 'wrong' : expected[requested]
  )), new RegExp(key));
});
