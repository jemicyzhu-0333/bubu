'use strict';

// Callers own defaults; this calculation preserves raw input coercion.
function classifyWorkPeriod(hour, workStart, workEnd, Math = globalThis.Math) {
  const start = Math.max(0, Math.min(22, Math.round(workStart)));
  const end = Math.max(start + 1, Math.min(24, Math.round(workEnd)));
  const lunch = start + Math.max(1, Math.round((end - start) * 0.3)); // 10-21 → 13 点午休
  if (hour < 5) return 'lateNight';
  if (hour < start) return 'morning';
  if (hour < lunch) return 'forenoon';
  if (hour < lunch + 1) return 'noon';
  if (hour < Math.max(lunch + 2, end - 3)) return 'afternoon';
  if (hour < end + 1) return 'evening';
  return 'night';
}

export { classifyWorkPeriod };
