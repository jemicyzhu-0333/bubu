'use strict';
const { prepareConfigPreferencesUpgrade } = require('../platform/persistence/sqlite/sqlite-database');
const { createPreferencesUpgradeHost } = require('../platform/electron/preferences-upgrade-host');
function beginPreferencesUpgrade({ error, userDataPath, appHost, argv,
  prepareUpgrade = prepareConfigPreferencesUpgrade, createDialogHost = createPreferencesUpgradeHost }) {
  if (error?.message !== 'config-payload-current-schema-required') throw error;
  // Generic rejection is not permission to display an upgrade offer. A second
  // copied inspection must establish the exact branded, canonical source first.
  const upgrade = prepareUpgrade({ userDataPath });
  if (upgrade?.status !== 'verified-upgrade-required') throw error;
  const host = createDialogHost({ appHost, sourcePath: upgrade.sourcePath, argv });
  const finished = (async () => {
    try {
      if (!await host.confirm(upgrade)) return { status: 'cancelled' };
      const result = upgrade.execute(upgrade.confirmation);
      await host.report(result); host.restart(); return result;
    } catch (caught) {
      try { await host.report({ backupPath: upgrade.backupPath }, caught); } catch (_) { /* Always release the source lock by quitting. */ }
      return { status: 'blocked', reason: caught.code || caught.message };
    } finally { appHost.quit(); }
  })();
  return Object.freeze({ status: 'upgrade-pending', finished });
}
module.exports = { beginPreferencesUpgrade };
