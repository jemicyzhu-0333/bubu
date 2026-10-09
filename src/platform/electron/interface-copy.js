'use strict';
const { NATIVE_EN } = require('../../content/interface-native-copy.mjs');
// Ephemeral acknowledged presentation only. Canonical preferences remain the sole writer.
let locale = 'zh-CN';
const listeners = new Set();
function setNativeLocale(next) {
  const value = next === 'en' ? 'en' : 'zh-CN';
  if (locale === value) return;
  locale = value;
  for (const listener of [...listeners]) { try { listener(locale); } catch (_) {} }
}
function onNativeLocaleChanged(listener) { listeners.add(listener); return () => listeners.delete(listener); }
function nativeCopy(source, parameters = {}) {
  const message = locale === 'en' && Object.hasOwn(NATIVE_EN, source) ? NATIVE_EN[source] : source;
  return String(message).replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (match, key) => Object.hasOwn(parameters, key) ? String(parameters[key]) : match);
}
module.exports = { nativeCopy, setNativeLocale, onNativeLocaleChanged };
