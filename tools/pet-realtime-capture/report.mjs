import { ERROR_OPERATIONS } from '../../src/surfaces/pet/realtime/error-journal.mjs';
// VALIDATION「实时桌宠分批验收」: diagnostics never grant native or visual acceptance.
export const CAPTURE_LIMITS = Object.freeze({
  frames: 18000, phases: 64, events: 512, errors: 64, screenshots: 6,
  screenshotBytes: 1024 * 1024, screenshotDimension: 4096, screenshotPixels: 16 * 1024 * 1024, decodedBytes: 16 * 1024 * 1024,
  compressedBytes: 8 * 1024 * 1024
});
const COLUMNS = ['frameIntervalMs', 'updateMs', 'renderSubmissionMs'];
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const plain = value => value !== null && typeof value === 'object'
  && Object.getPrototypeOf(value) === Object.prototype;
const text = (value, name, limit = 1024) => {
  if (typeof value !== 'string' || !value.length || value.length > limit) throw new TypeError(`Invalid ${name}`);
};
const integer = (value, name) => {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`Invalid ${name}`);
};

/** Stable JSON bytes are also the package integrity identity; no getters or lossy JSON values. */
export function canonicalCaptureJSON(value) {
  const ancestors = new Set();
  let bytes = 0;
  function token(value) {
    bytes += Buffer.byteLength(value);
    if (bytes > CAPTURE_LIMITS.decodedBytes) throw new RangeError('Capture decoded size exceeds limit');
    return value;
  }
  function visit(item, depth) {
    if (depth > 24) throw new RangeError('Capture JSON nesting exceeds limit');
    if (item === null || typeof item === 'boolean') return token(JSON.stringify(item));
    if (typeof item === 'number' && Number.isFinite(item)) return token(JSON.stringify(item));
    if (typeof item === 'string' && item.length <= 2 * 1024 * 1024) return token(JSON.stringify(item));
    if (!Array.isArray(item) && !plain(item)) throw new TypeError('Capture must contain plain JSON values');
    if (ancestors.has(item)) throw new TypeError('Capture JSON is cyclic');
    if (Object.getOwnPropertySymbols(item).length) throw new TypeError('Capture JSON symbols are unsupported');
    ancestors.add(item);
    let encoded;
    if (Array.isArray(item)) {
      if (item.length > CAPTURE_LIMITS.frames) throw new RangeError('Capture array exceeds limit');
      token('[' + ','.repeat(Math.max(0, item.length - 1)) + ']');
      encoded = `[${Array.from({ length: item.length }, (_, index) => {
        const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
        if (!descriptor || !('value' in descriptor)) throw new TypeError('Capture array getters or holes are unsupported');
        return visit(descriptor.value, depth + 1);
      }).join(',')}]`;
    } else {
      const keys = Object.keys(item).sort();
      if (keys.length > 1024) throw new RangeError('Capture object exceeds limit');
      token('{' + ','.repeat(Math.max(0, keys.length - 1)) + '}');
      encoded = `{${keys.map(key => {
        if (key.length > 128 || ['__proto__', 'constructor', 'prototype'].includes(key)) throw new TypeError('Unsafe capture key');
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (!('value' in descriptor)) throw new TypeError('Capture getters are unsupported');
        return `${token(JSON.stringify(key) + ':')}${visit(descriptor.value, depth + 1)}`;
      }).join(',')}}`;
    }
    ancestors.delete(item);
    return encoded;
  }
  const json = visit(value, 0);
  if (Buffer.byteLength(json) > CAPTURE_LIMITS.decodedBytes) throw new RangeError('Capture decoded size exceeds limit');
  return json;
}

export function classifyGraphics(graphics) {
  const renderer = typeof graphics === 'string' ? graphics : graphics?.renderer;
  if (typeof renderer !== 'string' || !renderer.trim()
    || /^(?:unknown|unavailable|not[ -]?(?:available|supported)|n\/?a|null|none)$/i.test(renderer.trim())) return 'unknown';
  return /swiftshader|llvmpipe|softpipe|software|lavapipe|swrast|microsoft basic render/i.test(renderer)
    ? 'software' : 'hardware-candidate';
}

function validateFrame(frame) {
  if (!plain(frame)) throw new TypeError('Invalid capture frame');
  integer(frame.sequence, 'frame sequence');
  for (const key of ['atMs', ...COLUMNS]) {
    if (!Number.isFinite(frame[key]) || frame[key] < 0) throw new TypeError(`Invalid frame ${key}`);
  }
}
function validatePhase(phase) {
  if (!plain(phase)) throw new TypeError('Invalid capture phase');
  text(phase.id, 'phase id', 128);
  text(phase.status, 'phase status', 64);
  text(phase.inputSource, 'phase inputSource', 128);
  if (phase.lostSamples !== undefined) integer(phase.lostSamples, 'phase lostSamples');
  if (phase.startSequence === null && phase.endSequence === null) return;
  integer(phase.startSequence, 'phase startSequence');
  integer(phase.endSequence, 'phase endSequence');
  if (phase.endSequence < phase.startSequence) throw new RangeError('Phase sequence range is reversed');
}
function metric(values) {
  values.sort((a, b) => a - b);
  const count = values.length;
  const rank = fraction => count ? values[Math.ceil(count * fraction) - 1] : null;
  return { count, p50: rank(.5), p95: rank(.95), p99: rank(.99), max: values.at(-1) ?? null,
    over16_7ms: values.filter(value => value > 16.7).length,
    over33_3ms: values.filter(value => value > 33.3).length,
    over50ms: values.filter(value => value > 50).length,
    over100ms: values.filter(value => value > 100).length };
}

/** Inclusive sequence range. Missing/duplicate/reordered samples invalidate, rather than bias, quantiles. */
export function summarizePhase(frames, phase, { lostSamples = 0 } = {}) {
  validatePhase(phase);
  integer(lostSamples, 'lostSamples');
  if (!Array.isArray(frames) || frames.length > CAPTURE_LIMITS.frames) throw new RangeError('Invalid frames');
  frames.forEach(validateFrame);
  const selected = phase.startSequence === null ? [] : frames.filter(frame =>
    frame.sequence >= phase.startSequence && frame.sequence <= phase.endSequence);
  const expectedSampleCount = phase.startSequence === null ? 0 : phase.endSequence - phase.startSequence + 1;
  if (!Number.isSafeInteger(expectedSampleCount)) throw new RangeError('Phase sequence range exceeds safe integers');
  const unique = new Set(selected.map(frame => frame.sequence));
  const sequenceGaps = expectedSampleCount - unique.size;
  const invalidReasons = [];
  if (phase.status !== 'completed') invalidReasons.push('phase-not-completed');
  if (!selected.length) invalidReasons.push('no-samples');
  if (lostSamples || sequenceGaps) invalidReasons.push('lost-samples');
  if (unique.size !== selected.length) invalidReasons.push('duplicate-sequence');
  if (selected.some((frame, index) => index && (frame.sequence <= selected[index - 1].sequence
    || frame.atMs < selected[index - 1].atMs))) invalidReasons.push('nonmonotonic-samples');
  const quantilesValid = invalidReasons.length === 0;
  return { id: phase.id, status: phase.status, inputSource: phase.inputSource,
    startSequence: phase.startSequence, endSequence: phase.endSequence,
    sampleCount: selected.length, expectedSampleCount, lostSamples, sequenceGaps,
    quantilesValid, invalidReasons, metrics: quantilesValid
      ? Object.fromEntries(COLUMNS.map(key => [key, metric(selected.map(frame => frame[key]))])) : null };
}

/** Boundary records include startup/reload and screenshot work, never steady-state phase samples. */
function summarizeCoverage(report) {
  const ranges = report.phases.filter(phase => phase.startSequence !== null);
  const unphased = [];
  let phaseSampleCount = 0, overlappingPhaseSampleCount = 0;
  for (const frame of report.frames) {
    const matches = ranges.filter(phase => frame.sequence >= phase.startSequence && frame.sequence <= phase.endSequence).length;
    if (matches) phaseSampleCount++;
    else unphased.push(frame);
    if (matches > 1) overlappingPhaseSampleCount++;
  }
  const invalidReasons = [];
  const sequences = new Set(report.frames.map(frame => frame.sequence));
  if (sequences.size !== report.frames.length) invalidReasons.push('duplicate-sequence');
  if (report.frames.some((frame, index) => index && frame.sequence <= report.frames[index - 1].sequence))
    invalidReasons.push('nonmonotonic-samples');
  const firstObserved = [], lastTimes = new Map();
  let clockRegressed = false;
  for (const frame of report.frames) {
    const instanceId = typeof frame.instanceId === 'string' ? frame.instanceId : null;
    const epoch = frame.epoch ?? null, key = JSON.stringify([instanceId, epoch]);
    if (!lastTimes.has(key) && firstObserved.length < CAPTURE_LIMITS.phases) firstObserved.push({
      instanceId, epoch, sequence: frame.sequence, atMs: frame.atMs,
      ...Object.fromEntries(COLUMNS.map(column => [column, frame[column]])) });
    if (lastTimes.has(key) && frame.atMs < lastTimes.get(key)) clockRegressed = true;
    lastTimes.set(key, frame.atMs);
  }
  if (clockRegressed && !invalidReasons.includes('nonmonotonic-samples')) invalidReasons.push('nonmonotonic-samples');
  // A gap inside a declared phase belongs to that phase. Any uncovered gap or
  // boundary loss makes the outside-phase quantiles incomplete as well.
  const sorted = [...sequences].sort((a, b) => a - b);
  const merged = [];
  for (const range of [...ranges].sort((a, b) => a.startSequence - b.startSequence)) {
    const previous = merged.at(-1);
    if (previous && range.startSequence <= previous.end + 1) previous.end = Math.max(previous.end, range.endSequence);
    else merged.push({ start: range.startSequence, end: range.endSequence });
  }
  let sequenceGaps = 0;
  for (let index = 1; index < sorted.length; index++) {
    const start = sorted[index - 1] + 1, end = sorted[index] - 1;
    const covered = merged.reduce((sum, range) => sum + Math.max(0, Math.min(end, range.end) - Math.max(start, range.start) + 1), 0);
    sequenceGaps += end - start + 1 - covered;
  }
  const boundaryLossObserved = report.events.some(event => event?.type === 'frame-loss' && event.phase === 'boundary');
  if (sequenceGaps || boundaryLossObserved) invalidReasons.push('lost-samples');
  if (!unphased.length) invalidReasons.push('no-samples');
  const quantilesValid = invalidReasons.length === 0;
  return {
    sampleCoverage: { totalSampleCount: report.frames.length, phaseSampleCount,
      unphasedSampleCount: unphased.length, overlappingPhaseSampleCount },
    firstObservedFrames: { scope: 'first available record per renderer instance/epoch; not proof of complete startup capture',
      rows: firstObserved, truncatedInstances: Math.max(0, lastTimes.size - firstObserved.length) },
    unphasedSummary: { scope: 'observed records outside every phase; may include startup, reload, screenshots and transitions; not steady-state or complete startup timing',
      sampleCount: unphased.length, sequenceGaps, boundaryLossObserved, quantilesValid, invalidReasons,
      metrics: quantilesValid ? Object.fromEntries(COLUMNS.map(key => [key, metric(unphased.map(frame => frame[key]))])) : null }
  };
}

export function createCaptureReport({ runId, source = {}, environment = {}, options = {} }) {
  text(runId, 'runId', 128);
  if (![source, environment, options].every(plain)) throw new TypeError('Capture labels must be objects');
  return JSON.parse(canonicalCaptureJSON({ schemaVersion: 1, runId, source, environment, options,
    frames: [], phases: [], screenshots: [], events: [], errors: [] }));
}

/** Bounded detail retention never erases the number of report observations. */
export function appendCaptureError(report, detail) {
  report.errorAccounting ??= { total: report.errors.length, retained: report.errors.length, truncated: 0 };
  const accounting = report.errorAccounting;
  if (!Number.isSafeInteger(accounting.total) || accounting.total >= Number.MAX_SAFE_INTEGER)
    throw new Error('capture-error-count-exhausted');
  accounting.total++;
  if (report.capture?.status === 'completed') report.capture.status = 'completed-with-observations';
  if (report.status === 'completed') report.status = 'completed-with-observations';
  if (report.errors.length < CAPTURE_LIMITS.errors) {
    report.errors.push(detail); accounting.retained++; return true;
  }
  accounting.truncated++; return false;
}

function validateErrorEvidence(report) {
  if (report.errorAccounting !== undefined) {
    const value = report.errorAccounting;
    if (!plain(value) || Object.keys(value).some(key => !['total', 'retained', 'truncated'].includes(key)))
      throw new TypeError('Invalid error accounting');
    for (const key of ['total', 'retained', 'truncated']) integer(value[key], `error accounting ${key}`);
    if (value.retained !== report.errors.length || value.total !== value.retained + value.truncated)
      throw new TypeError('Inconsistent error accounting');
  }
  if (report.rendererDiagnostics === undefined) {
    if (report.errors.some(error => error?.code === 'renderer-diagnostic-legacy-observation'
      || error?.code === 'renderer-diagnostic-detail-loss'
      || error?.code === 'renderer-diagnostic-error' && 'sequence' in error))
      throw new TypeError('Missing renderer diagnostic summary');
    return;
  }
  if (!Array.isArray(report.rendererDiagnostics) || report.rendererDiagnostics.length > 8)
    throw new TypeError('Invalid renderer diagnostics');
  const ids = new Set(), retained = new Map(), sequences = new Set();
  for (const item of report.rendererDiagnostics) {
    if (!plain(item) || Object.keys(item).some(key => !['instanceId', 'evidence', 'totalOccurrences', 'observedRows',
      'missingDetails', 'retainedDetails', 'droppedDetails', 'lastSequence', 'lastPendingOperations'].includes(key))) throw new TypeError('Invalid renderer diagnostic fields');
    text(item.instanceId, 'diagnostic instance', 128);
    if (ids.has(item.instanceId)) throw new TypeError('Duplicate diagnostic instance');
    ids.add(item.instanceId);
    if (item.lastPendingOperations !== null) integer(item.lastPendingOperations, 'last pending operations');
    for (const key of ['observedRows', 'missingDetails', 'retainedDetails', 'droppedDetails']) integer(item[key], key);
    if (item.observedRows !== item.retainedDetails + item.droppedDetails) throw new TypeError('Inconsistent diagnostic detail count');
    if (item.evidence === 'sequence-journal') {
      integer(item.totalOccurrences, 'diagnostic occurrences'); integer(item.lastSequence, 'diagnostic last sequence');
      if (item.totalOccurrences !== item.lastSequence || item.totalOccurrences !== item.observedRows + item.missingDetails)
        throw new TypeError('Inconsistent diagnostic occurrences');
    } else if (item.evidence !== 'legacy-occurrence-count-unknown' || item.totalOccurrences !== null
      || item.lastSequence !== null || item.missingDetails !== 0) throw new TypeError('Invalid legacy diagnostic evidence');
  }
  for (const error of report.errors) {
    if (!['renderer-diagnostic-error', 'renderer-diagnostic-legacy-observation', 'renderer-diagnostic-detail-loss'].includes(error?.code)) continue;
    if (!plain(error) || !ids.has(error.instanceId)) throw new TypeError('Invalid renderer error identity');
    const summary = report.rendererDiagnostics.find(item => item.instanceId === error.instanceId);
    text(error.phase, 'renderer error phase', 128);
    const allowed = ['code', 'phase', 'instanceId'];
    if (error.code === 'renderer-diagnostic-detail-loss') {
      allowed.push('count'); integer(error.count, 'renderer missing details');
      if (!error.count) throw new TypeError('Empty renderer detail loss');
    } else {
      retained.set(error.instanceId, (retained.get(error.instanceId) ?? 0) + 1);
      allowed.push('message');
      if (typeof error.message !== 'string' || error.message.length > 512) throw new TypeError('Invalid renderer error message');
      if (error.code === 'renderer-diagnostic-error') {
        allowed.push('sequence', 'atMs', 'operation'); integer(error.sequence, 'renderer error sequence');
        const identity = JSON.stringify([error.instanceId, error.sequence]);
        if (sequences.has(identity) || summary.evidence !== 'sequence-journal' || error.sequence > summary.lastSequence)
          throw new TypeError('Inconsistent renderer error sequence');
        sequences.add(identity);
        if (!error.sequence || !ERROR_OPERATIONS.includes(error.operation)
          || !(error.atMs === null || Number.isFinite(error.atMs) && error.atMs >= 0)) throw new TypeError('Invalid renderer error detail');
      } else {
        allowed.push('occurrenceCount'); if (summary.evidence !== 'legacy-occurrence-count-unknown' || error.occurrenceCount !== null) throw new TypeError('Legacy occurrences must be unknown');
      }
    }
    if (Object.keys(error).some(key => !allowed.includes(key))) throw new TypeError('Unexpected renderer error field');
  }
  for (const item of report.rendererDiagnostics) if ((retained.get(item.instanceId) ?? 0) !== item.retainedDetails)
    throw new TypeError('Inconsistent retained renderer errors');
}

// Structural bounds only, not a PNG decoder or proof of the screenshot's visual contents.
function validatePNG(bytes) {
  if (bytes.length < 57 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)
    || bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR') return false;
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  const depths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
  if (!depths[bytes[25]]?.includes(bytes[24])) return false;
  if (!width || !height || width > CAPTURE_LIMITS.screenshotDimension || height > CAPTURE_LIMITS.screenshotDimension
    || width * height > CAPTURE_LIMITS.screenshotPixels || bytes[26] !== 0 || bytes[27] !== 0 || bytes[28] > 1) return false;
  let cursor = 8, sawData = false;
  while (cursor + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(cursor), type = bytes.toString('ascii', cursor + 4, cursor + 8);
    const end = cursor + 12 + length;
    if (end > bytes.length || !/^[A-Za-z]{4}$/.test(type) || cursor > 8 && type === 'IHDR') return false;
    if (type === 'IDAT') sawData = true;
    if (type === 'IEND') return length === 0 && sawData && end === bytes.length;
    cursor = end;
  }
  return false;
}

export function validateCapturePayload(report) {
  if (!plain(report) || report.schemaVersion !== 1) throw new TypeError('Unsupported capture report schema');
  text(report.runId, 'runId', 128);
  if (![report.source, report.environment, report.options].every(plain)) throw new TypeError('Missing capture labels');
  for (const key of ['frames', 'phases', 'events', 'errors', 'screenshots']) {
    if (!Array.isArray(report[key]) || report[key].length > CAPTURE_LIMITS[key]) throw new RangeError(`Capture ${key} exceeds limit`);
  }
  validateErrorEvidence(report);
  report.frames.forEach(validateFrame);
  report.phases.forEach(validatePhase);
  if (new Set(report.phases.map(phase => phase.id)).size !== report.phases.length) throw new TypeError('Duplicate capture phase id');
  for (const shot of report.screenshots) {
    if (!plain(shot) || Object.keys(shot).some(key => !['name', 'mimeType', 'base64'].includes(key))) throw new TypeError('Invalid screenshot fields');
    text(shot.name, 'screenshot name', 128);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*\.png$/.test(shot.name)) throw new TypeError('Unsafe screenshot filename');
    if (shot.mimeType !== 'image/png' || typeof shot.base64 !== 'string'
      || shot.base64.length > Math.ceil(CAPTURE_LIMITS.screenshotBytes / 3) * 4
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(shot.base64)) throw new TypeError('Invalid PNG base64');
    const bytes = Buffer.from(shot.base64, 'base64');
    if (bytes.length > CAPTURE_LIMITS.screenshotBytes || !validatePNG(bytes)
      || bytes.toString('base64') !== shot.base64) throw new TypeError('Invalid PNG screenshot');
  }
  if (new Set(report.screenshots.map(shot => shot.name)).size !== report.screenshots.length) throw new TypeError('Duplicate screenshot filename');
  canonicalCaptureJSON(report);
  return report;
}

export function finalizeReport(report) {
  validateCapturePayload(report);
  const copy = JSON.parse(canonicalCaptureJSON(report));
  copy.phaseSummaries = copy.phases.map(phase => summarizePhase(copy.frames, phase, { lostSamples: phase.lostSamples ?? 0 }));
  Object.assign(copy, summarizeCoverage(copy));
  copy.graphicsClassification = classifyGraphics(copy.environment.graphics);
  copy.gates = { nativeGPU: 'not-accepted', osInput: 'not-accepted', manualVisual: 'not-accepted' };
  copy.productionAccepted = false;
  copy.quantileMethod = 'nearest-rank; per phase from raw records only; never averaged across phases';
  copy.unphasedQuantileMethod = 'nearest-rank from raw records outside the union of all phase ranges; never combined with phase quantiles';
  copy.measurementSources = { frameIntervalMs: 'presentation callback interval; not displayed-frame or GPU duration',
    updateMs: 'CPU update duration', renderSubmissionMs: 'CPU render submission duration; not GPU execution' };
  canonicalCaptureJSON(copy);
  return copy;
}
