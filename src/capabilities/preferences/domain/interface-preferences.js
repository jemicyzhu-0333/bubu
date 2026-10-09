'use strict';

const LOCALES = Object.freeze(['system', 'zh-CN', 'en']);
const THEMES = Object.freeze(['system', 'light', 'dark']);
function projectInterfacePreferences(settings = {}) {
  return Object.freeze({
    locale: LOCALES.includes(settings.locale) ? settings.locale : 'system',
    theme: THEMES.includes(settings.theme) ? settings.theme : 'system'
  });
}
function resolveLocale(preference, systemLanguages = []) {
  if (preference === 'zh-CN' || preference === 'en') return preference;
  const language = systemLanguages.find(value => typeof value === 'string' && /^(?:zh|en)(?:-|$)/i.test(value)) || 'en';
  return /^zh(?:-|$)/i.test(language) ? 'zh-CN' : 'en';
}
function upgradeSchema18Settings(settings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)
      || Object.hasOwn(settings, 'locale') || Object.hasOwn(settings, 'theme')) {
    throw new Error('config-preferences-upgrade-settings-invalid');
  }
  return { ...settings, locale: 'system', theme: 'system' };
}
module.exports = { LOCALES, THEMES, projectInterfacePreferences, resolveLocale, upgradeSchema18Settings };
