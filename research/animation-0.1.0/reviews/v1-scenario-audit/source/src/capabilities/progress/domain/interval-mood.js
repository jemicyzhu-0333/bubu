'use strict';

function mood(expressionId, reasonKey) {
  return Object.freeze({ expressionId, reasonKey });
}

const INTERVAL_MOODS = Object.freeze({
  ABANDONED: mood('react.relieved', 'abandoned'),
  COMPLETED: mood('react.celebrate', 'completed'),
  STUCK: mood('react.encouraging', 'stuck'),
  REPEATED_INTERRUPTION: mood('work.pause', 'repeated-interruptions'),
  DEEP_FOCUS: mood('work.deep-focus', 'deep-focus'),
  FRAGMENTED_PROGRESS: mood('work.focus', 'fragmented-progress'),
  BREAK: mood('work.rest', 'break'),
  LOW_ENERGY: mood('life.drowsy', 'low-energy'),
  CAPTURE_ONLY: mood('life.space', 'capture-only'),
  ACTIVITY: mood('life.attentive', 'activity'),
  GAP: mood('life.idle', 'gap')
});

function payloadFor(event) {
  if (!event || typeof event !== 'object') return {};
  if (event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)) {
    return event.payload;
  }
  if (typeof event.payload !== 'string') return {};
  try {
    const parsed = JSON.parse(event.payload);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function eventValue(event, camelKey, snakeKey) {
  const payload = payloadFor(event);
  return event[camelKey] ?? event[snakeKey] ?? payload[camelKey] ?? payload[snakeKey];
}

function sessionKind(event) {
  return eventValue(event, 'sessionKind', 'session_kind');
}

function energyState(event) {
  return eventValue(event, 'state', 'state');
}

function kindOf(event) {
  return event && typeof event.kind === 'string' ? event.kind : '';
}

function intervalMood(interval) {
  const events = interval && Array.isArray(interval.events) ? interval.events : [];
  const kinds = events.map(kindOf);

  if (kinds.includes('session.abandoned')) return INTERVAL_MOODS.ABANDONED;
  if (kinds.includes('task.completed')) return INTERVAL_MOODS.COMPLETED;
  if (kinds.includes('friction.stuck-opened') || kinds.includes('friction.strategy-shown')) {
    return INTERVAL_MOODS.STUCK;
  }

  const segments = events.filter(event => kindOf(event) === 'session.segment');
  const workSegments = segments.filter(event => sessionKind(event) !== 'break');
  const breakSegments = segments.filter(event => sessionKind(event) === 'break');

  if (workSegments.length > 0 && kinds.filter(kind => kind === 'session.paused').length >= 2) {
    return INTERVAL_MOODS.REPEATED_INTERRUPTION;
  }
  const intervalDuration = interval && Number.isFinite(interval.endMs) && Number.isFinite(interval.startMs)
    ? Math.max(0, interval.endMs - interval.startMs)
    : 0;
  const coverageMs = interval && Number.isFinite(interval.coverageMs)
    ? Math.max(0, interval.coverageMs)
    : 0;
  if (workSegments.length > 0 && intervalDuration > 0 && coverageMs >= intervalDuration * 0.8) {
    return INTERVAL_MOODS.DEEP_FOCUS;
  }
  if (workSegments.length > 0) return INTERVAL_MOODS.FRAGMENTED_PROGRESS;
  if (breakSegments.length > 0) return INTERVAL_MOODS.BREAK;

  if (events.some(event => kindOf(event) === 'friction.energy-checked-in'
      && energyState(event) === 'low')) {
    return INTERVAL_MOODS.LOW_ENERGY;
  }
  if (events.length > 0 && events.every(event => kindOf(event).startsWith('capture.'))) {
    return INTERVAL_MOODS.CAPTURE_ONLY;
  }
  if (events.length > 0) return INTERVAL_MOODS.ACTIVITY;
  return INTERVAL_MOODS.GAP;
}

module.exports = {
  INTERVAL_MOODS,
  intervalMood
};
