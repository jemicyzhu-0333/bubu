import { getLocale, t } from '../../shared/interface/i18n.mjs';
import { displaySatiation } from '../../companion/satiation-display.mjs';

// Presentation only: never round or abbreviate the persisted companion facts.
function companionCount(value) {
  return Number.isFinite(value) ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(value))) : 0;
}
function formatCompanionCount(value, locale = getLocale()) {
  const count = companionCount(value);
  return new Intl.NumberFormat(locale, count >= 10000
    ? { notation: 'compact', maximumSignificantDigits: 3, useGrouping: false }
    : { maximumFractionDigits: 0 }).format(count);
}
function renderCompanionOverview($, projection) {
  const days = companionCount(projection.daysTogether);
  const satiation = displaySatiation(projection.satiation ?? 65);
  const feeds = companionCount(projection.totalFeeds);
  const facts = [
    ['Days', days, days ? t('相识 {days} 天', { days: days.toLocaleString(getLocale()) }) : t('今天刚认识')],
    ['Satiation', satiation, t('饱食 {value}/100', { value: satiation })],
    ['Meals', feeds, t('一起吃过 {count} 次', { count: feeds.toLocaleString(getLocale()) })]
  ];
  for (const [key, value, label] of facts) {
    const trigger = $(`#companion${key}Stat`);
    trigger?.setAttribute('aria-label', label);
    const number = $(`#companion${key}Value`);
    if (number) number.textContent = formatCompanionCount(value);
    const detail = $(`#companion${key}Detail`);
    if (detail) detail.textContent = label;
  }
}
export { companionCount, formatCompanionCount, renderCompanionOverview };
