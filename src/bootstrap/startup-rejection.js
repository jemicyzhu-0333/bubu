'use strict';
const { createStartupRejectionHost } = require('../platform/electron/startup-rejection-host');

function startupRejectionCode(error) {
  const code = typeof error?.code === 'string' ? error.code : error?.message;
  return typeof code === 'string' && /^(config-[a-z-]{1,90}|legacy-json-profile-requires-explicit-import)$/.test(code) ? code : null;
}

// A blocked profile never becomes permission to reset, relocate, or import data.
function beginStartupRejection({ error, userDataPath, appHost, createDialogHost = createStartupRejectionHost,
  reportCode = code => console.error('[bubu] ' + code) }) {
  const code = startupRejectionCode(error);
  if (!code) throw error;
  try { reportCode(code); } catch (_) { /* Diagnostic output cannot authorize opening a refused profile. */ }
  let host;
  try { host = createDialogHost({ appHost, sourcePath: userDataPath }); }
  catch (_) {
    appHost.quit();
    return Object.freeze({ status: 'startup-blocked', finished: Promise.resolve({ status: 'blocked', code, reportFailed: true }) });
  }
  const finished = (async () => {
    try { await host.report(code); return { status: 'blocked', code }; }
    catch (_) { return { status: 'blocked', code, reportFailed: true }; }
    finally { appHost.quit(); }
  })();
  return Object.freeze({ status: 'startup-blocked', finished });
}

module.exports = { beginStartupRejection, startupRejectionCode };
