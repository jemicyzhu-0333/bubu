'use strict';

const {
  addDaysToKey,
  nextLocalDayBoundary,
  parseDayKey
} = require('../../../core/calendar');

const DEFAULT_BUCKET_MS = 30 * 60 * 1000;
const SEGMENT_KIND = 'session.segment';

function requireBucketMs(value) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError('bucketMs must be a positive safe integer');
  }
  return value;
}

function localDayStart(dayKey) {
  const { year, month, day } = parseDayKey(dayKey);
  return new Date(year, month - 1, day, 0, 0, 0, 0).getTime();
}

function dayRange(dayKey) {
  const startMs = localDayStart(dayKey);
  const endMs = nextLocalDayBoundary(startMs);
  if (endMs <= startMs || localDayStart(addDaysToKey(dayKey, 1)) !== endMs) {
    throw new RangeError(`Could not resolve local day range: ${dayKey}`);
  }
  return { startMs, endMs };
}

function finiteTimestamp(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function eventStartMs(event) {
  if (!event || typeof event !== 'object') return null;
  return finiteTimestamp(event.occurred_at) ?? finiteTimestamp(event.occurredAt);
}

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

function segmentDurationMs(event) {
  const payload = payloadFor(event);
  const candidate = event.duration_ms ?? event.durationMs ?? payload.durationMs ?? payload.duration_ms;
  return Number.isFinite(candidate) && candidate > 0 ? candidate : 0;
}

function eventId(event) {
  return event && (typeof event.id === 'string' || typeof event.id === 'number')
    ? String(event.id)
    : '';
}

function compareEvents(left, right) {
  const timeDifference = left.startMs - right.startMs;
  if (timeDifference) return timeDifference;
  const kindDifference = left.kind.localeCompare(right.kind);
  if (kindDifference) return kindDifference;
  if (left.id !== right.id) return left.id.localeCompare(right.id);
  return left.inputIndex - right.inputIndex;
}

function normalizeEvents(events, rangeStart, rangeEnd) {
  if (!Array.isArray(events)) throw new TypeError('events must be an array');
  const normalized = [];
  for (let inputIndex = 0; inputIndex < events.length; inputIndex += 1) {
    const event = events[inputIndex];
    const startMs = eventStartMs(event);
    if (startMs === null) continue;
    const kind = typeof event.kind === 'string' ? event.kind : '';
    const durationMs = kind === SEGMENT_KIND ? segmentDurationMs(event) : 0;
    const endMs = durationMs > 0 ? startMs + durationMs : startMs;
    const intersects = durationMs > 0
      ? startMs < rangeEnd && endMs > rangeStart
      : startMs >= rangeStart && startMs < rangeEnd;
    if (!intersects) continue;
    normalized.push({ event, startMs, endMs, kind, id: eventId(event), inputIndex });
  }
  return normalized.sort(compareEvents);
}

function makeBuckets(dayKey, startMs, endMs, bucketMs) {
  const buckets = [];
  for (let bucketStart = startMs; bucketStart < endMs; bucketStart += bucketMs) {
    buckets.push({
      dayKey,
      startMs: bucketStart,
      endMs: Math.min(bucketStart + bucketMs, endMs),
      events: [],
      coverageMs: 0,
      gap: true
    });
  }
  return buckets;
}

function addEventToBuckets(buckets, normalized, dayStart, bucketMs) {
  const { event, startMs, endMs, kind } = normalized;
  if (kind !== SEGMENT_KIND || endMs <= startMs) {
    const index = Math.floor((startMs - dayStart) / bucketMs);
    if (buckets[index]) buckets[index].events.push(event);
    return;
  }

  const firstIndex = Math.max(0, Math.floor((startMs - dayStart) / bucketMs));
  const lastIndex = Math.min(
    buckets.length - 1,
    Math.floor((Math.min(endMs, buckets[buckets.length - 1].endMs) - 1 - dayStart) / bucketMs)
  );
  for (let index = firstIndex; index <= lastIndex; index += 1) {
    const bucket = buckets[index];
    const overlapMs = Math.max(0, Math.min(endMs, bucket.endMs) - Math.max(startMs, bucket.startMs));
    if (overlapMs <= 0) continue;
    bucket.events.push(event);
    bucket.coverageMs += overlapMs;
  }
}

function mergeGapIntervals(buckets) {
  const intervals = [];
  for (const bucket of buckets) {
    bucket.gap = bucket.events.length === 0 && bucket.coverageMs === 0;
    const previous = intervals[intervals.length - 1];
    if (bucket.gap && previous && previous.gap) {
      previous.endMs = bucket.endMs;
      continue;
    }
    intervals.push(bucket);
  }
  return intervals;
}

function deriveIntervals(events, { dayKey, bucketMs = DEFAULT_BUCKET_MS } = {}) {
  parseDayKey(dayKey);
  const sizeMs = requireBucketMs(bucketMs);
  const { startMs, endMs } = dayRange(dayKey);
  const buckets = makeBuckets(dayKey, startMs, endMs, sizeMs);
  const normalizedEvents = normalizeEvents(events, startMs, endMs);
  for (const normalized of normalizedEvents) {
    addEventToBuckets(buckets, normalized, startMs, sizeMs);
  }
  return mergeGapIntervals(buckets);
}

module.exports = {
  DEFAULT_BUCKET_MS,
  deriveIntervals
};
