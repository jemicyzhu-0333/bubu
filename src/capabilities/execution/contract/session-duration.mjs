'use strict';

const sessionDurationApi = (function createSessionDuration() {
  'use strict';

  // This dual-mode contract is the one definition consumed by the main and
  // renderer processes. Keeping it at the execution boundary prevents the
  // persisted, IPC, settings and UI ranges from drifting apart.
  const MIN_FOCUS_MINUTES = 5;
  const MAX_FOCUS_MINUTES = 120;
  const DEFAULT_FOCUS_MINUTES = 60;
  const FOCUS_MINUTE_STEP = 5;
  const FOCUS_MINUTE_PRESETS = Object.freeze([15, 25, 45, 60, 90, 120]);

  // The two-minute rescue has distinct reward semantics and is deliberately
  // outside the selectable full-focus range.
  const QUICK_START_MINUTES = 2;
  const MS_PER_MINUTE = 60 * 1000;

  function clampFocusMinutes(value) {
    const minutes = Math.round(Number(value));
    if (!Number.isFinite(minutes)) return null;
    return Math.max(MIN_FOCUS_MINUTES, Math.min(MAX_FOCUS_MINUTES, minutes));
  }

  function normalizeFocusMinutes(...candidates) {
    for (const candidate of candidates) {
      const minutes = Math.round(Number(candidate));
      if (Number.isFinite(minutes) && minutes > 0) return clampFocusMinutes(minutes);
    }
    return DEFAULT_FOCUS_MINUTES;
  }

  function isFocusMinutes(value) {
    return Number.isInteger(value) && value >= MIN_FOCUS_MINUTES && value <= MAX_FOCUS_MINUTES;
  }

  function stepFocusMinutes(current, direction) {
    const base = normalizeFocusMinutes(current);
    const delta = Number(direction) < 0 ? -FOCUS_MINUTE_STEP : FOCUS_MINUTE_STEP;
    return clampFocusMinutes(base + delta);
  }

  function focusMinutesToMs(minutes) {
    return normalizeFocusMinutes(minutes) * MS_PER_MINUTE;
  }

  function minimumAdjustableMinutes(elapsedMs) {
    const elapsed = Number(elapsedMs);
    if (!Number.isFinite(elapsed) || elapsed <= 0) return MIN_FOCUS_MINUTES;
    return Math.max(MIN_FOCUS_MINUTES, Math.min(MAX_FOCUS_MINUTES, Math.ceil(elapsed / MS_PER_MINUTE)));
  }

  return Object.freeze({
    MIN_FOCUS_MINUTES,
    MAX_FOCUS_MINUTES,
    DEFAULT_FOCUS_MINUTES,
    FOCUS_MINUTE_STEP,
    FOCUS_MINUTE_PRESETS,
    QUICK_START_MINUTES,
    MS_PER_MINUTE,
    clampFocusMinutes,
    normalizeFocusMinutes,
    isFocusMinutes,
    stepFocusMinutes,
    focusMinutesToMs,
    minimumAdjustableMinutes
  });
})();

export default sessionDurationApi;
export const MIN_FOCUS_MINUTES = sessionDurationApi.MIN_FOCUS_MINUTES;
export const MAX_FOCUS_MINUTES = sessionDurationApi.MAX_FOCUS_MINUTES;
export const DEFAULT_FOCUS_MINUTES = sessionDurationApi.DEFAULT_FOCUS_MINUTES;
export const FOCUS_MINUTE_STEP = sessionDurationApi.FOCUS_MINUTE_STEP;
export const FOCUS_MINUTE_PRESETS = sessionDurationApi.FOCUS_MINUTE_PRESETS;
export const QUICK_START_MINUTES = sessionDurationApi.QUICK_START_MINUTES;
export const MS_PER_MINUTE = sessionDurationApi.MS_PER_MINUTE;
export const clampFocusMinutes = sessionDurationApi.clampFocusMinutes;
export const normalizeFocusMinutes = sessionDurationApi.normalizeFocusMinutes;
export const isFocusMinutes = sessionDurationApi.isFocusMinutes;
export const stepFocusMinutes = sessionDurationApi.stepFocusMinutes;
export const focusMinutesToMs = sessionDurationApi.focusMinutesToMs;
export const minimumAdjustableMinutes = sessionDurationApi.minimumAdjustableMinutes;
