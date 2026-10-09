'use strict';
const { createApplicationUpdates } = require('./desktop-updates');
function registerAppMaintenance({ registerIpc, getState, stateRepository, appHost, lifecycle, requestScope, sessions, updateAdmission, dismissNotice, hide, makeUpdates = createApplicationUpdates }) {
  const updates = makeUpdates({ stateRepository, appHost, requestScope, sessions, updateAdmission, lifecycle });
  lifecycle.register('app:desktop-updates', () => updates.close());
  registerIpc('state:get', getState);
  registerIpc('notices:dismiss', (_event, { id }) => dismissNotice(id));
  registerIpc('window:hide', hide);
  registerIpc('updates:get', updates.read);
  registerIpc('updates:check', updates.check);
  registerIpc('updates:download', updates.download);
  registerIpc('updates:cancel', updates.cancel);
  registerIpc('updates:install', updates.install);
}
module.exports = { registerAppMaintenance };
