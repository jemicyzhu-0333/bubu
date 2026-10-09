'use strict';

// ARCHITECTURE「事实流与长期记忆」: the immutable day projection behind timeline:getDay. Pure — it turns
// a day's stored events into { dayKey, rangeStart, rangeEnd, lanes, markers,
// intervals, totals } for the gantt/timeline to render. The interval mood is
// derived here, never stored (ARCHITECTURE「事实流与长期记忆」): a stored mood would drift from the events
// the moment one is pruned or back-filled.

const { deriveIntervals, DEFAULT_BUCKET_MS } = require('./timeline-intervals');
const { projectProvenance, groupChangeMarkers } = require('./timeline-change-projection');
const { intervalMood } = require('./interval-mood');

const HOUR_MS = 60 * 60 * 1000;
const LANE_CAP = 6;      // ARCHITECTURE「事实流与长期记忆」: at most 6 task lanes; the rest fold into "other".
const MARKER_CAP = 500;  // A day of point events is bounded; guard against a runaway payload.

function eventPayload(event) {
  if (event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)) return event.payload;
  if (typeof event.payload !== 'string') return {};
  try {
    const parsed = JSON.parse(event.payload);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function sessionKind(event) {
  const kind = eventPayload(event).sessionKind;
  return kind === 'focus' || kind === 'quick-start' || kind === 'break' ? kind : null;
}

function eventIdentity(event) {
  const identity = {};
  for (const key of ['eventId', 'sessionId', 'causationId', 'commandId']) {
    const value = key === 'eventId' ? event.id : event[key];
    identity[key] = typeof value === 'string' && value.trim() ? value : null;
  }
  return identity;
}

function projectMarker(event) {
  const payload = eventPayload(event);
  const isRoutine = event.kind.startsWith('routine.');
  return Object.freeze({
    ...eventIdentity(event),
    ...projectProvenance(event, payload),
    occurredAt: event.occurredAt,
    kind: event.kind,
    taskId: event.taskId || null,
    sessionKind: event.kind.startsWith('session.') ? sessionKind(event) : null,
    routineId: isRoutine && typeof payload.routineId === 'string' ? payload.routineId
      : isRoutine && Array.isArray(payload.entityRefs) ? payload.entityRefs.find(ref => ref.kind === 'routine')?.id || null : null,
    routineKind: isRoutine && typeof payload.kind === 'string' ? payload.kind : null,
    status: event.kind === 'routine.logged' && ['done', 'skipped'].includes(payload.status)
      ? payload.status : null
  });
}

function segmentEnd(segment) {
  const duration = Number.isFinite(segment.durationMs) && segment.durationMs > 0 ? segment.durationMs : 0;
  return segment.occurredAt + duration;
}

function buildLanes(segments) {
  const byTask = new Map();
  for (const segment of segments) {
    const key = segment.taskId || '__none__';
    if (!byTask.has(key)) byTask.set(key, { taskId: segment.taskId || null, focusMs: 0, segments: [] });
    const lane = byTask.get(key);
    const durationMs = Number.isFinite(segment.durationMs) && segment.durationMs > 0 ? segment.durationMs : 0;
    lane.focusMs += durationMs;
    lane.segments.push({
      ...eventIdentity(segment),
      startMs: segment.occurredAt, endMs: segment.occurredAt + durationMs, durationMs,
      sessionKind: sessionKind(segment), taskId: segment.taskId || null
    });
  }
  const ordered = [...byTask.values()].sort((a, b) => b.focusMs - a.focusMs);
  const kept = ordered.slice(0, LANE_CAP);
  const overflow = ordered.slice(LANE_CAP);
  if (overflow.length) {
    const other = { taskId: null, taskIds: [], other: true, focusMs: 0, segments: [] };
    for (const lane of overflow) {
      other.focusMs += lane.focusMs;
      if (lane.taskId) other.taskIds.push(lane.taskId);
      other.segments.push(...lane.segments);
    }
    other.taskIds.sort();
    other.segments.sort((a, b) => a.startMs - b.startMs);
    kept.push(other);
  }
  return kept.map(lane => Object.freeze({
    ...lane,
    ...(Array.isArray(lane.taskIds) ? { taskIds: Object.freeze([...lane.taskIds]) } : {}),
    segments: Object.freeze(lane.segments.map(Object.freeze))
  }));
}

function buildTimelineDay(events, { dayKey, bucketMs = DEFAULT_BUCKET_MS } = {}) {
  const list = Array.isArray(events) ? events : [];
  const rawIntervals = deriveIntervals(list, { dayKey, bucketMs });
  const dayStart = rawIntervals.length ? rawIntervals[0].startMs : null;
  const dayEnd = rawIntervals.length ? rawIntervals[rawIntervals.length - 1].endMs : null;

  const intervals = rawIntervals.map(interval => {
    const mood = intervalMood(interval);
    return Object.freeze({
      startMs: interval.startMs,
      endMs: interval.endMs,
      gap: interval.gap === true,
      coverageMs: Number.isFinite(interval.coverageMs) ? interval.coverageMs : 0,
      eventCount: Array.isArray(interval.events) ? interval.events.length : 0,
      expressionId: mood.expressionId,
      reasonKey: mood.reasonKey
    });
  });

  const segments = list.filter(event => event.kind === 'session.segment' && Number.isFinite(event.occurredAt));
  const markers = groupChangeMarkers(list
    .filter(event => event.kind !== 'session.segment' && Number.isFinite(event.occurredAt))
    .map(projectMarker)).slice(0, MARKER_CAP);

  // Default the visible window to the data envelope ±1 hour, clamped to the day
  // (ARCHITECTURE「事实流与长期记忆」): painting a full 24h squashes a couple of focus hours into a sliver.
  let minStart = Infinity;
  let maxEnd = -Infinity;
  for (const event of list) {
    if (!Number.isFinite(event.occurredAt)) continue;
    minStart = Math.min(minStart, event.occurredAt);
    maxEnd = Math.max(maxEnd, event.kind === 'session.segment' ? segmentEnd(event) : event.occurredAt);
  }
  const hasData = minStart !== Infinity && dayStart !== null;
  const rangeStart = hasData ? Math.max(Math.min(dayStart, minStart), minStart - HOUR_MS) : null;
  const rangeEnd = hasData ? Math.min(Math.max(dayEnd, maxEnd + 1), maxEnd + HOUR_MS) : null;

  const focusMs = segments.reduce(
    (sum, segment) => sum + (Number.isFinite(segment.durationMs) && segment.durationMs > 0 ? segment.durationMs : 0),
    0
  );

  return Object.freeze({
    dayKey,
    dayStart,
    dayEnd,
    rangeStart,
    rangeEnd,
    lanes: Object.freeze(buildLanes(segments)),
    markers: Object.freeze(markers),
    intervals: Object.freeze(intervals),
    totals: Object.freeze({
      focusMs,
      segmentCount: segments.length,
      sessionCount: new Set(list.filter(event => event.kind === 'session.completed').map(event => event.sessionId)).size,
      completedTaskCount: list.filter(event => event.kind === 'task.completed').length,
      markerCount: markers.length,
      recordedCoverageMs: rawIntervals.reduce((sum, interval) => sum + (interval.coverageMs || 0), 0)
    })
  });
}

module.exports = { buildTimelineDay };
