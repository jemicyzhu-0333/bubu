'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { gzipSync, gunzipSync } = require('node:zlib');
const { randomBytes } = require('node:crypto');
const { createCaptureReport, summarizePhase, classifyGraphics, finalizeReport, CAPTURE_LIMITS,
  canonicalCaptureJSON } = require('../tools/pet-realtime-capture/report.mjs');
const { encodeCapturePackage, decodeCapturePackage } = require('../tools/pet-realtime-capture/package.mjs');
const frame = (sequence, value = sequence) => ({ sequence, atMs: sequence * 16.7,
  frameIntervalMs: value, updateMs: value / 10, renderSubmissionMs: value / 2 });
const phase = (startSequence = 1, endSequence = 100) => ({ id: 'idle', startSequence, endSequence,
  status: 'completed', inputSource: 'synthetic-test-only' });
const draft = () => createCaptureReport({ runId: 'test-run', source: { sourceId: 'test', runtime: 'not-electron' },
  environment: { graphics: { renderer: 'SwiftShader test' } }, options: { durationMs: 1 } });
const screenshot = name => ({ name, mimeType: 'image/png',
  base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/jXcAAAAASUVORK5CYII=' });

test('capture phase computes exact raw nearest-rank metrics and strict threshold counts', () => {
  const result = summarizePhase(Array.from({ length: 100 }, (_, i) => frame(i + 1)), phase());
  assert.equal(result.quantilesValid, true);
  assert.deepEqual(result.metrics.frameIntervalMs, { count: 100, p50: 50, p95: 95, p99: 99, max: 100,
    over16_7ms: 84, over33_3ms: 67, over50ms: 50, over100ms: 0 });
  assert.equal(result.metrics.updateMs.p95, 9.5);
  assert.equal(result.metrics.renderSubmissionMs.p99, 49.5);
  const threshold = summarizePhase([frame(1, 16.7), frame(2, 33.3), frame(3, 50), frame(4, 100)], phase(1, 4));
  assert.deepEqual([threshold.metrics.frameIntervalMs.over16_7ms, threshold.metrics.frameIntervalMs.over33_3ms,
    threshold.metrics.frameIntervalMs.over50ms, threshold.metrics.frameIntervalMs.over100ms], [3,2,1,0]);
});

test('capture phase never sorts away gaps, duplicates, reordering, lost polls or incomplete status', () => {
  for (const [frames, descriptor, options, reason] of [
    [[frame(1),frame(3)],phase(1,3),{},'lost-samples'],
    [[frame(1),frame(1)],phase(1,1),{},'duplicate-sequence'],
    [[frame(2),frame(1)],phase(1,2),{},'nonmonotonic-samples'],
    [[frame(1),{...frame(2),atMs:0}],phase(1,2),{},'nonmonotonic-samples'],
    [[frame(1)],phase(1,1),{lostSamples:1},'lost-samples'],
    [[frame(1)],{...phase(1,1),status:'unsupported'}, {},'phase-not-completed'],
    [[],{...phase(),startSequence:null,endSequence:null,status:'not-run'}, {},'no-samples']
  ]) {
    const result = summarizePhase(frames, descriptor, options);
    assert.equal(result.quantilesValid,false);
    assert.equal(result.metrics,null);
    assert.ok(result.invalidReasons.includes(reason));
  }
});

test('capture phase rejects missing, nonfinite and negative raw fields instead of zero filling', () => {
  for (const key of ['sequence','atMs','frameIntervalMs','updateMs','renderSubmissionMs']) {
    const missing = frame(1); delete missing[key];
    assert.throws(() => summarizePhase([missing],phase(1,1)));
    for (const value of [NaN, Infinity, -1, '1', null]) {
      assert.throws(() => summarizePhase([{...frame(1),[key]:value}],phase(1,1)));
    }
  }
  assert.throws(() => summarizePhase([],phase(2,1)));
  assert.throws(() => summarizePhase([],phase(1,1),{lostSamples:-1}));
});

test('capture finalization preserves phase tables and raw data, never averages quantiles or accepts native gates', () => {
  const report = draft(); report.frames = [frame(1,1),frame(2,100)];
  report.phases = [phase(1,1),{...phase(2,2),id:'drag',inputSource:'os-input-claimed-by-caller'}];
  report.gates = { nativeGPU:'pass' }; report.productionAccepted = true;
  const result = finalizeReport(report);
  assert.equal(result.phaseSummaries[0].metrics.frameIntervalMs.p95,1);
  assert.equal(result.phaseSummaries[1].metrics.frameIntervalMs.p95,100);
  assert.equal(result.metrics,undefined);
  assert.deepEqual(result.frames,report.frames);
  assert.notEqual(result.frames,report.frames);
  assert.deepEqual(result.gates,{nativeGPU:'not-accepted',osInput:'not-accepted',manualVisual:'not-accepted'});
  assert.equal(result.productionAccepted,false);
  assert.equal(result.graphicsClassification,'software');
  assert.equal(report.productionAccepted,true);
  assert.match(result.measurementSources.renderSubmissionMs,/not GPU/);
});

test('capture renderer classification is software, unknown or hardware candidate, never hardware acceptance', () => {
  for (const renderer of ['SwiftShader','llvmpipe (LLVM)','softpipe','Software Rasterizer','lavapipe','swrast']) {
    assert.equal(classifyGraphics({renderer}),'software');
  }
  assert.equal(classifyGraphics({renderer:'Apple M3'}),'hardware-candidate');
  assert.equal(classifyGraphics('NVIDIA GeForce'),'hardware-candidate');
  for (const graphics of [null,undefined,{}, {renderer:''}, {vendor:'Intel'}, {renderer:'unavailable'},
    {renderer:'unknown'}, {renderer:'notavailable'}, {renderer:'not supported'}, {renderer:'N/A'}]) assert.equal(classifyGraphics(graphics),'unknown');
  const report=draft(); report.environment.graphics={renderer:'Apple M3'};
  assert.equal(finalizeReport(report).gates.nativeGPU,'not-accepted');
});

test('capture validation enforces bounded events, errors, phases, frames and unique phase identities', () => {
  for (const key of ['events','errors','phases','frames','screenshots']) {
    const report=draft(); report[key]=Array(CAPTURE_LIMITS[key]+1).fill(null);
    assert.throws(()=>finalizeReport(report),new RegExp(key));
  }
  const report=draft();report.phases=[phase(),phase()];
  assert.throws(()=>finalizeReport(report),/Duplicate/);
  report.phases=[];report.schemaVersion=2;assert.throws(()=>finalizeReport(report),/schema/);
});

test('capture screenshots accept at most six named PNGs and reject unsafe names, types, encodings and oversized bytes', () => {
  const report=draft();report.screenshots=Array.from({length:6},(_,i)=>screenshot(`view-${i}.png`));
  assert.equal(finalizeReport(report).screenshots.length,6);
  report.screenshots.push(screenshot('seventh.png'));assert.throws(()=>finalizeReport(report),/screenshots/);
  for (const candidate of [screenshot('../a.png'),screenshot('/a.png'),screenshot('a.jpg'),
    {...screenshot('a.png'),mimeType:'image/jpeg'}, {...screenshot('a.png'),base64:'garbage'},
    {...screenshot('a.png'),path:'secret'}, {...screenshot('a.png'),base64:Buffer.alloc(1024*1024+1).toString('base64')}]) {
    report.screenshots=[candidate];assert.throws(()=>finalizeReport(report));
  }
  report.screenshots=[screenshot('same.png'),screenshot('same.png')];assert.throws(()=>finalizeReport(report),/Duplicate/);
});

test('capture canonical JSON is deterministic and rejects lossy or executable-shaped values', () => {
  assert.equal(canonicalCaptureJSON({b:1,a:{z:2,y:3}}),canonicalCaptureJSON({a:{y:3,z:2},b:1}));
  for (const value of [undefined,NaN,Infinity,()=>{},new Date(),{get x(){throw Error('invoked');}}, JSON.parse('{"__proto__":1}')]) {
    assert.throws(()=>canonicalCaptureJSON(value));
  }
  const cyclic={};cyclic.x=cyclic;assert.throws(()=>canonicalCaptureJSON(cyclic),/cyclic/);
  const array=[]; Object.defineProperty(array,0,{get(){throw Error('invoked');}});
  assert.throws(()=>canonicalCaptureJSON(array),/getters/);
  assert.throws(()=>canonicalCaptureJSON(Array(1)),/holes/);
  assert.throws(()=>canonicalCaptureJSON(Array(17).fill('x'.repeat(1024*1024))),/decoded/);
  assert.throws(()=>canonicalCaptureJSON({a:'x'.repeat(2*1024*1024+1)}));
});

test('capture package roundtrips a deterministic hashed envelope without executing or extracting files', () => {
  const payload=finalizeReport(draft());
  const bytes=encodeCapturePackage(payload);
  assert.deepEqual(decodeCapturePackage(bytes),payload);
  const envelope=JSON.parse(gunzipSync(bytes));
  assert.equal(envelope.packageVersion,1);
  assert.match(envelope.payloadSha256,/^[a-f0-9]{64}$/);
  const reordered={...payload,source:{...payload.source}};
  assert.deepEqual(encodeCapturePackage(reordered),bytes);
});

test('capture package rejects hash mismatch, corruption, unknown versions and malformed envelopes', () => {
  const bytes=encodeCapturePackage(draft());
  const envelope=JSON.parse(gunzipSync(bytes));envelope.payload.runId='tampered';
  assert.throws(()=>decodeCapturePackage(gzipSync(JSON.stringify(envelope))),/hash/);
  for (const mutation of [value=>{value.packageVersion=2;},value=>{value.path='../secret';},value=>{delete value.payloadSha256;}]) {
    const next=JSON.parse(gunzipSync(bytes));mutation(next);
    assert.throws(()=>decodeCapturePackage(gzipSync(JSON.stringify(next))),/envelope/);
  }
  assert.throws(()=>decodeCapturePackage(Buffer.from('not gzip')));
  assert.throws(()=>decodeCapturePackage(bytes.subarray(0,bytes.length-1)));
  const corrupt=Buffer.from(bytes);corrupt[20]^=255;assert.throws(()=>decodeCapturePackage(corrupt));
  assert.throws(()=>decodeCapturePackage('not bytes'),/bytes/);
});

test('capture package rejects compressed caps, gzip bombs and invalid screenshot payloads before returning data', () => {
  assert.throws(()=>decodeCapturePackage(Buffer.alloc(CAPTURE_LIMITS.compressedBytes+1)),/compressed/);
  const bomb=gzipSync(Buffer.alloc(CAPTURE_LIMITS.decodedBytes+1,32));
  assert.ok(bomb.length<CAPTURE_LIMITS.compressedBytes);
  assert.throws(()=>decodeCapturePackage(bomb));
  const payload=draft();payload.screenshots=[screenshot('../escape.png')];
  assert.throws(()=>encodeCapturePackage(payload),/filename/);
});

test('capture encoder applies compressed limit even for valid bounded high-entropy reports', () => {
  const payload=draft();
  payload.errors=Array.from({length:9},()=>randomBytes(1024*1024).toString('base64'));
  assert.throws(()=>encodeCapturePackage(payload),/compressed/);
});

test('capture screenshots reject fake signatures, huge dimensions and malformed chunk framing', () => {
  const report=draft();
  const original=Buffer.from(screenshot('a.png').base64,'base64');
  const hugeWidth=Buffer.from(original);hugeWidth.writeUInt32BE(4097,16);
  const zeroHeight=Buffer.from(original);zeroHeight.writeUInt32BE(0,20);
  const badChunk=Buffer.from(original);badChunk.writeUInt32BE(0xffffffff,33);
  const badDepth=Buffer.from(original);badDepth[24]=0;
  for(const bytes of [original.subarray(0,8),original.subarray(0,33),hugeWidth,zeroHeight,badChunk,badDepth,
    Buffer.concat([original,Buffer.from([0])])]) {
    report.screenshots=[{...screenshot('a.png'),base64:bytes.toString('base64')}];
    assert.throws(()=>finalizeReport(report),/PNG/);
  }
});
