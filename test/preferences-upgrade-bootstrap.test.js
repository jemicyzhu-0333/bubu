'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { beginPreferencesUpgrade } = require('../src/bootstrap/preferences-upgrade');
const { createPreferencesUpgradeHost, profileRelaunchArguments } = require('../src/platform/electron/preferences-upgrade-host');
const { createApplication } = require('../src/bootstrap/create-application');
const error = () => Error('config-payload-current-schema-required');
function harness() {
  const calls = []; let location = '/profiles/bubu';
  const appHost = { isReady: () => false, whenReady: async () => { calls.push('ready'); },
    setDataDirectory(value) { calls.push(['data', value]); location = value; }, userDataPath: () => location,
    quit: () => calls.push('quit'), acquireSingleInstanceLock: () => { calls.push(['lock', location]); return true; },
    hasExplicitUserDataPath: () => true, isPackaged: () => false, hideDock() {}, openAtLogin() {}, setOpenAtLogin() {}, subscribeLifecycle() {} };
  return { calls, appHost };
}
for (const decision of [false, true]) test(`explicit consent ${decision} completes exactly once and quits`, async () => {
  const h = harness(), token = 'fixed-confirmation';
  const upgrade = { status: 'verified-upgrade-required', confirmation: token, sourcePath: '/profiles/bubu', backupPath: '/profiles/backup',
    execute(confirmation) { assert.equal(confirmation, token); h.calls.push('execute'); return { status: 'upgraded', backupPath: '/profiles/backup' }; } };
  const pending = beginPreferencesUpgrade({ error: error(), userDataPath: '/profiles/bubu', appHost: h.appHost,
    prepareUpgrade: () => upgrade, createDialogHost: () => ({ confirm: async input => { assert.equal(input, upgrade); return decision; },
      report: async () => h.calls.push('report'), restart: () => h.calls.push('restart') }) });
  assert.equal(pending.status, 'upgrade-pending');
  const result = await pending.finished;
  assert.equal(result.status, decision ? 'upgraded' : 'cancelled');
  assert.deepEqual(h.calls, decision ? ['execute', 'report', 'restart', 'quit'] : ['quit']);
});
test('foreign, malformed or generic failure never creates a consent host', () => {
  const h = harness(); let prompts = 0;
  const config = { userDataPath: '/profiles/bubu', appHost: h.appHost, createDialogHost() { prompts++; },
    prepareUpgrade() { throw Error('foreign-profile'); } };
  assert.throws(() => beginPreferencesUpgrade({ ...config, error: Error('other') }), /other/);
  assert.throws(() => beginPreferencesUpgrade({ ...config, error: error() }), /foreign-profile/); assert.equal(prompts, 0);
});
test('dialog isolation happens before readiness and consent requires both button and checkbox', async () => {
  const h = harness(); let response = { response: 1, checkboxChecked: false }, options;
  const host = createPreferencesUpgradeHost({ appHost: h.appHost, sourcePath: '/profiles/bubu', argv: ['electron', '.', '--dev'],
    io: { mkdtempSync: () => '/tmp/private-dialog' }, electron: { app: { relaunch(options) { h.calls.push(['relaunch', options]); } },
      dialog: { async showMessageBox(input) { options = input; return response; } } } });
  assert.deepEqual(h.calls, [['data', '/tmp/private-dialog']]);
  const upgrade = { sourcePath: '/profiles/bubu', backupPath: '/profiles/backup' };
  assert.equal(await host.confirm(upgrade), false); assert.equal(options.defaultId, 0); assert.equal(options.cancelId, 0);
  response = { response: 0, checkboxChecked: true }; assert.equal(await host.confirm(upgrade), false);
  response = { response: 1, checkboxChecked: true }; assert.equal(await host.confirm(upgrade), true);
  assert.match(options.detail, /\/profiles\/bubu/); host.restart(); assert.deepEqual(h.calls.at(-1), ['relaunch', { args: ['.', '--dev', '--user-data-dir=/profiles/bubu'] }]);
});
test('source path and lock stay bound before dialog; credentials and other stores never open', () => {
  const h = harness();
  const app = createApplication({ argv: [], schemaVersion: 19, normalizePersistedState: value => value, appHost: h.appHost,
    createStateRepository({ userDataPath }) { h.calls.push(['repository', userDataPath]); throw error(); },
    createCredentialStore() { throw Error('must not open credentials'); }, openFactStore() { throw Error('must not open facts'); },
    openCollaborationStorage() { throw Error('must not open collaboration'); },
    beginUpgrade({ userDataPath, appHost }) { assert.equal(userDataPath, '/profiles/bubu'); appHost.setDataDirectory('/tmp/dialog'); return { status: 'upgrade-pending' }; } });
  assert.equal(app.status, 'upgrade-pending'); assert.equal(app.userDataPath, '/profiles/bubu');
  assert.deepEqual(h.calls, [['lock', '/profiles/bubu'], ['repository', '/profiles/bubu'], ['data', '/tmp/dialog']]);
});
test('unknown result reports blocker and quits without relaunch', async () => {
  const h = harness();
  const pending = beginPreferencesUpgrade({ error: error(), userDataPath: '/profiles/bubu', appHost: h.appHost,
    prepareUpgrade: () => ({ status: 'verified-upgrade-required', confirmation: 'token', execute() { throw Error('config-commit-outcome-unknown'); } }),
    createDialogHost: () => ({ confirm: async () => true, report: async (_, error) => h.calls.push(error.message), restart() { throw Error('must not relaunch'); } }) });
  assert.equal((await pending.finished).status, 'blocked'); assert.deepEqual(h.calls, ['config-commit-outcome-unknown', 'quit']);
});

test('relaunch explicitly retains source profile and other launch arguments, never dialog path', () => {
  for (const args of [['electron', '.', '--dev'], ['bubu', '--user-data-dir=/profiles/old', '--flag'],
    ['bubu', '--user-data-dir', '/profiles/old', '--dev']]) {
    const result = profileRelaunchArguments(args, '/profiles/bubu original');
    assert.equal(result.at(-1), '--user-data-dir=/profiles/bubu original');
    assert.equal(result.filter(value => value.startsWith('--user-data-dir')).length, 1);
    assert.ok(!result.includes('/profiles/old'));
  }
});
