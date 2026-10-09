'use strict';

const { progress } = require('../../capabilities');
const { validDayKey } = require('../../core/field-normalizers');

// A successful empty history and a history that could not be read are distinct.
// Legacy readDay() intentionally returns [] on failure, so this query requires
// the explicit availability port and never infers availability from that array.
function createTimelineDayQuery({ timeline, energyCurveForDay = () => null } = {}) {
  if (typeof energyCurveForDay !== 'function') throw new TypeError('timeline day query requires an energy projection port');
  function execute({ dayKey } = {}) {
    if (typeof dayKey !== 'string' || validDayKey(dayKey) !== dayKey) return { ok: false, reason: 'timeline-day-invalid' };
    if (!timeline || typeof timeline.queryRange !== 'function') return { ok: false, reason: 'timeline-unavailable' };
    let history;
    try { history = timeline.queryRange({ fromDayKey: dayKey, toDayKey: dayKey }); }
    catch (_) { return { ok: false, reason: 'timeline-unavailable' }; }
    if (!history?.ok || history.availability !== 'available' || !Array.isArray(history.items)) {
      return { ok: false, reason: 'timeline-unavailable' };
    }
    let day;
    try { day = progress.timelineDay.buildTimelineDay(history.items, { dayKey }); }
    catch (_) { return { ok: false, reason: 'timeline-projection-unavailable' }; }
    let energyCurve = null;
    try { energyCurve = energyCurveForDay(dayKey); } catch (_) { /* History remains readable without a curve. */ }
    return { ok: true, day, energyCurve };
  }
  return Object.freeze({ execute });
}
module.exports = { createTimelineDayQuery };
