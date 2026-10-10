'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { beginStartupRejection, startupRejectionCode } = require('../src/bootstrap/startup-rejection');
const { createStartupRejectionHost } = require('../src/platform/electron/startup-rejection-host');
const { createApplication } = require('../src/bootstrap/create-application');

function harness() {
  const calls = [], source = path.resolve('/profiles/中文 空格/bubu'); let directory = source;
  const appHost = { userDataPath: () => directory, hasExplicitUserDataPath: () => false,
    setDataDirectory(value) { calls.push(['data', value]); directory = value; },
    acquireSingleInstanceLock: () => { calls.push('lock'); return true; },
    isReady: () => false, whenReady: async () => { calls.push('ready'); },
    isPackaged: () => true, hideDock() {}, openAtLogin() {}, setOpenAtLogin() {}, subscribeLifecycle() {},
    quit: () => calls.push('quit') };
  return { calls, source, appHost };
}
const failure = code => Object.assign(Error(code + ': private error details must not be shown'), { code });

test('startup diagnostic accepts only bounded application codes, never raw exception text', () => {
  assert.equal(startupRejectionCode(failure('config-profile-brand-required')), 'config-profile-brand-required');
  assert.equal(startupRejectionCode(Error('legacy-json-profile-requires-explicit-import')), 'legacy-json-profile-requires-explicit-import');
  for (const error of [Error('secret'), Error('config-private /path'), failure('config-' + 'x'.repeat(100))]) assert.equal(startupRejectionCode(error), null);
});

test('startup rejection isolates dialog runtime before readiness and reports original path only', async () => {
  const h = harness(); let options;
  const directory = path.resolve('/temporary/owned-dialog');
  const host = createStartupRejectionHost({ appHost: h.appHost, sourcePath: h.source,
    io: { mkdtempSync: () => directory }, electron: { dialog: { async showMessageBox(value) { options = value; } } } });
  assert.deepEqual(h.calls, [['data', directory]]);
  await host.report('config-profile-brand-required');
  assert.deepEqual(h.calls, [['data', directory], 'ready']);
  assert.ok(options.detail.includes(h.source)); assert.ok(!options.detail.includes(directory));
  assert.deepEqual(options.buttons, ['退出 / Quit']);
  assert.equal(options.defaultId, 0); assert.equal(options.cancelId, 0);
});

for (const broken of ['none', 'construct', 'report']) test(`blocked startup quits once even if dialog ${broken} fails`, async () => {
  const h = harness();
  const blocked = beginStartupRejection({ error: failure('config-profile-brand-required'), userDataPath: h.source, appHost: h.appHost,
    createDialogHost() { if (broken === 'construct') throw Error('host unavailable'); return { async report(code) {
      assert.equal(code, 'config-profile-brand-required'); if (broken === 'report') throw Error('dialog unavailable');
    } }; } });
  assert.equal(blocked.status, 'startup-blocked'); assert.equal((await blocked.finished).status, 'blocked');
  assert.deepEqual(h.calls, ['quit']);
});

for (const stage of ['lock', 'repository']) test(`composition handles ${stage} refusal without opening other stores or changing source`, () => {
  const h = harness();
  if (stage === 'lock') h.appHost.acquireSingleInstanceLock = () => { throw failure('config-profile-brand-required'); };
  const blocked = createApplication({ argv: [], schemaVersion: 19, normalizePersistedState: value => value, appHost: h.appHost,
    createStateRepository() { assert.equal(stage, 'repository'); throw failure('config-profile-brand-required'); },
    createCredentialStore: () => assert.fail('credentials must stay closed'),
    openCollaborationStorage: () => assert.fail('collaboration must stay closed'),
    openFactStore: () => assert.fail('facts must stay closed'),
    beginRejection({ userDataPath, error }) { assert.equal(userDataPath, h.source); assert.equal(error.code, 'config-profile-brand-required'); return { status: 'startup-blocked' }; }
  });
  assert.equal(blocked.status, 'startup-blocked'); assert.equal(blocked.userDataPath, h.source);
  assert.equal(h.appHost.userDataPath(), h.source);
});

test('unexpected programming failures still surface instead of masquerading as profile rejection', () => {
  const h = harness();
  assert.throws(() => beginStartupRejection({ error: Error('bug'), userDataPath: h.source, appHost: h.appHost }), /bug/);
  assert.deepEqual(h.calls, []);
});

for (const code of ['config-payload-current-schema-required', 'config-payload-future-schema', 'config-profile-brand-mismatch']) {
  test(`an ineligible upgrade inspection becomes a readable refusal: ${code}`, () => {
    const h = harness(); let rejected = 0;
    const blocked = createApplication({ argv: [], schemaVersion: 19, normalizePersistedState: value => value, appHost: h.appHost,
      createStateRepository() { throw Error('config-payload-current-schema-required'); },
      beginUpgrade() { h.appHost.setDataDirectory(path.resolve('/temporary/upgrade-dialog')); throw failure(code); },
      createCredentialStore: () => assert.fail('no credentials'), openFactStore: () => assert.fail('no facts'),
      openCollaborationStorage: () => assert.fail('no collaboration'),
      beginRejection({ error, userDataPath }) {
        rejected++; assert.equal(error.code, code); assert.equal(userDataPath, h.source); return { status: 'startup-blocked' };
      }
    });
    assert.equal(blocked.status, 'startup-blocked'); assert.equal(rejected, 1);
  });
}
