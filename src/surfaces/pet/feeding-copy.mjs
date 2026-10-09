import { t, onLocaleChanged } from '../shared/interface/i18n.mjs';

// Copy ownership is separate from the controller's transient bar visibility.
// A language change never replays a meal, changes geometry or restarts a timer.
function createSatiationLabel({ label } = {}) {
  let displayed = null, disposed = false;
  function paint() {
    if (!disposed && label && displayed !== null) label.textContent = t('饱食 {value}', { value: displayed });
  }
  const stopLocale = onLocaleChanged(paint);
  return Object.freeze({
    update(value) { if (!disposed) { displayed = value; paint(); } },
    dispose() { disposed = true; displayed = null; stopLocale(); }
  });
}
function receivedFoodMessage(name) {
  return t('得到 {name}，点旁边的喂食按钮给我。', { name });
}
export { createSatiationLabel, receivedFoodMessage };
