'use strict';
const { interfacePreferences } = require('../capabilities/preferences');
const { createInterfacePresentationHost } = require('../platform/electron/interface-presentation');

function createInterfacePreferencesRuntime({ getSettings, host = createInterfacePresentationHost() }) {
  let revision = 0, current = null, deliveryPending = false;
  function project() {
    const preferences = interfacePreferences.projectInterfacePreferences(getSettings());
    return { ...preferences, resolvedLocale: interfacePreferences.resolveLocale(preferences.locale, host.languages()) };
  }
  function apply(next) {
    current = { ...next, revision: ++revision };
    deliveryPending = true;
    try { host.apply(current); deliveryPending = false; } catch (_) { /* A read retries presentation only, never the saved command. */ }
    return { ...current };
  }
  function read() {
    const next = project();
    // A system language change is a presentation change, not a preference write.
    // Publish one new narrow revision so tray and other open windows stay aligned.
    if (!current || deliveryPending || ['locale', 'theme', 'resolvedLocale'].some(key => current[key] !== next[key])) return apply(next);
    return { ...current };
  }
  function publish() {
    try { return apply(project()); }
    catch (_) { deliveryPending = true; return current ? { ...current } : null; }
  }
  publish();
  return Object.freeze({ read, publish });
}
module.exports = { createInterfacePreferencesRuntime };
