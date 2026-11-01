// VALIDATION「交付结论的四个层级」: CPU submission is not GPU execution.
const SOURCES = Object.freeze({
  frameIntervalMs: 'observed presentation callback interval; not displayed-frame or GPU timing',
  updateMs: 'CPU application update duration',
  renderSubmissionMs: 'CPU renderer submission duration; not GPU execution duration'
});

function runtimeLabels(value) {
  if (value === null) return null;
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).length > 16) {
    throw new TypeError('runtime labels must be a flat object of at most 16 caller-provided labels');
  }
  const entries = Object.entries(value);
  for (const [key, label] of entries) {
    if (key.length > 64 || !(typeof label === 'string' && label.length <= 1024
      || typeof label === 'number' && Number.isFinite(label) || typeof label === 'boolean' || label === null)) {
      throw new TypeError('runtime labels must contain bounded strings or finite scalar values');
    }
  }
  return Object.freeze(Object.fromEntries(entries));
}

function summarize(buffer, count, target) {
  const values = Array.from(buffer.subarray(0, count)).sort((a, b) => a - b);
  // Exact nearest-rank quantiles of the retained window; no histogram rounding.
  const quantile = fraction => count ? values[Math.ceil(count * fraction) - 1] : null;
  return Object.freeze({
    count, p50: quantile(.5), p95: quantile(.95), p99: quantile(.99),
    max: count ? values[count - 1] : null,
    overTargetCount: values.filter(value => value > target).length
  });
}

/** A surface-local, fixed-allocation sample window. No clock, platform inference or acceptance decision. */
export function createFrameMetrics({ capacity = 600, frameTargetMs = 16.7, runtime = null } = {}) {
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 3600) {
    throw new RangeError('frame sample capacity must be an integer in 1..3600');
  }
  if (!Number.isFinite(frameTargetMs) || frameTargetMs <= 0) {
    throw new RangeError('frame target must be finite and positive');
  }
  const labels = runtimeLabels(runtime);
  const columns = Object.fromEntries(Object.keys(SOURCES).map(key => [key, new Float64Array(capacity)]));
  const timestamps = new Float64Array(capacity);
  let cursor = 0, count = 0, totalRecorded = 0, lastSequence = 0, epoch = 0;
  const firstRetainedSequence = () => count ? lastSequence - count + 1 : null;
  function readSince(options = {}) {
    if (!options || Object.getPrototypeOf(options) !== Object.prototype
      || Reflect.ownKeys(options).some(key => !['afterSequence', 'limit'].includes(key))) {
      throw new TypeError('sample cursor accepts only afterSequence and limit');
    }
    const { afterSequence = 0, limit = 600 } = options;
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0 || afterSequence > lastSequence) {
      throw new RangeError('sample cursor must be a nonnegative safe integer no later than lastSequence');
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 3600) {
      throw new RangeError('sample page limit must be an integer in 1..3600');
    }
    const first = firstRetainedSequence();
    const start = count ? Math.max(0, afterSequence - first + 1) : 0;
    const length = Math.min(limit, count - start);
    const oldest = (cursor - count + capacity) % capacity;
    const rows = [];
    for (let offset = start; offset < start + length; offset++) {
      const index = (oldest + offset) % capacity;
      rows.push(Object.freeze({ sequence: first + offset,
        atMs: Number.isNaN(timestamps[index]) ? null : timestamps[index],
        frameIntervalMs: columns.frameIntervalMs[index], updateMs: columns.updateMs[index],
        renderSubmissionMs: columns.renderSubmissionMs[index] }));
    }
    return Object.freeze({ schemaVersion: 1, rows: Object.freeze(rows), epoch, totalRecorded,
      firstRetainedSequence: first, lastSequence,
      // Counts all missing recorded rows after the cursor, including reset-cleared
      // rows. Reading never advances a cursor or removes samples. Empty resets
      // have no missing rows but remain observable through the changed epoch.
      overwrittenSinceCursor: Math.max(0, (first === null ? lastSequence : first - 1) - afterSequence),
      remaining: count - start - length, windowCapacity: capacity });
  }
  return Object.freeze({
    record(frameIntervalMs, updateMs, renderSubmissionMs, atMs = null) {
      const values = [frameIntervalMs, updateMs, renderSubmissionMs];
      if (values.some(value => !Number.isFinite(value) || value < 0)) {
        throw new TypeError('frame durations must be finite and nonnegative');
      }
      if (atMs !== null && (!Number.isFinite(atMs) || atMs < 0)) {
        throw new TypeError('sample timestamp must be null or finite and nonnegative');
      }
      if (lastSequence === Number.MAX_SAFE_INTEGER) throw new RangeError('sample sequence exhausted');
      Object.keys(columns).forEach((key, index) => { columns[key][cursor] = values[index]; });
      timestamps[cursor] = atMs === null ? NaN : atMs;
      cursor = (cursor + 1) % capacity;
      count = Math.min(capacity, count + 1);
      totalRecorded++; lastSequence++;
    },
    readSince,
    snapshot() {
      return Object.freeze({
        capacity, samples: count, totalRecorded, epoch, lastSequence,
        firstRetainedSequence: firstRetainedSequence(), frameTargetMs, runtime: labels,
        window: 'most recent samples; counts and quantiles exclude overwritten samples',
        quantileMethod: 'nearest-rank', units: 'milliseconds', sources: SOURCES,
        ...Object.fromEntries(Object.entries(columns).map(([key, buffer]) => [key, summarize(buffer, count, frameTargetMs)]))
      });
    },
    reset() {
      if (epoch === Number.MAX_SAFE_INTEGER) throw new RangeError('sample epoch exhausted');
      cursor = 0; count = 0; totalRecorded = 0; epoch++;
    }
  });
}
