'use strict';

// A model may interpret the person's clock phrase, but cannot invent an event
// time from the capture timestamp or a duration. No new context is sent remotely.
function captureEventTime(impulse, suggestion, now) {
  if (!impulse || !suggestion || typeof suggestion.evidence !== 'string'
      || !suggestion.evidence.trim() || !impulse.text.includes(suggestion.evidence)
      || !/(?:\d{1,2}[:：]\d{2}|(?:\d{1,2}|[一二三四五六七八九十两]{1,3})\s*点|\d{1,2}\s*(?:am|pm|a\.m\.|p\.m\.))/i.test(suggestion.evidence)
      || ![-1, 0].includes(suggestion.dayOffset)
      || typeof suggestion.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(suggestion.time)) return null;
  const date = new Date(impulse.createdAt);
  date.setDate(date.getDate() + suggestion.dayOffset);
  const day = date.getDate(), [hour, minute] = suggestion.time.split(':').map(Number);
  date.setHours(hour, minute, 0, 0);
  // Local clock gaps are not silently moved to a different hour.
  if (date.getDate() !== day || date.getHours() !== hour || date.getMinutes() !== minute) return null;
  const at = date.getTime();
  return Number.isSafeInteger(at) && at >= 0 && at <= now ? at : null;
}
module.exports = { captureEventTime };
