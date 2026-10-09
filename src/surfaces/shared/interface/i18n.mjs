import { EN } from './catalog.mjs';
import { NATIVE_EN } from '../../../content/interface-native-copy.mjs';
import { TASK_EN } from './task-catalog.mjs';

let locale = 'zh-CN';
const listeners = new Set();
function getLocale() { return locale; }
function resolveLocale(preference, languages = []) {
  if (preference === 'zh-CN' || preference === 'en') return preference;
  const first = languages.find(value => typeof value === 'string' && /^(?:zh|en)(?:-|$)/i.test(value)) || 'en';
  return /^zh(?:-|$)/i.test(first) ? 'zh-CN' : 'en';
}
function setLocale(next) {
  const value = next === 'en' ? 'en' : 'zh-CN';
  if (value === locale) return false;
  locale = value;
  for (const listener of [...listeners]) listener(locale);
  return true;
}
function onLocaleChanged(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function t(source, parameters = {}) {
  const message = locale !== 'en' ? source : Object.hasOwn(EN, source) ? EN[source] : Object.hasOwn(TASK_EN, source) ? TASK_EN[source] : Object.hasOwn(NATIVE_EN, source) ? NATIVE_EN[source] : source;
  return String(message).replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (match, key) => (
    Object.hasOwn(parameters, key) ? String(parameters[key]) : match
  ));
}
function localizeDocument(document) {
  document.documentElement.lang = locale;
  // Only explicit product-copy markers are translated. No DOM-wide text
  // replacement: user titles, drafts, provider replies and pet names stay intact.
  for (const node of document.querySelectorAll('[data-i18n]')) {
    node.textContent = t(node.dataset.i18n);
  }
  for (const node of document.querySelectorAll('[data-i18n-text]')) {
    const text = [...node.childNodes].find(child => child.nodeType === 3 && child.textContent.trim());
    if (text) {
      const spacing = /^(\s*)(?:[\s\S]*?)(\s*)$/.exec(text.textContent);
      text.textContent = spacing[1] + t(node.getAttribute('data-i18n-text')) + spacing[2];
    }
  }
  for (const attribute of ['title', 'aria-label', 'placeholder']) {
    for (const node of document.querySelectorAll(`[data-i18n-${attribute}]`)) {
      node.setAttribute(attribute, t(node.getAttribute(`data-i18n-${attribute}`)));
    }
  }
}
export { getLocale, setLocale, resolveLocale, onLocaleChanged, t, localizeDocument };
