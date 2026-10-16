#!/usr/bin/env node
/** Actual preparePack -> ActorPool CPU measurements. No renderer or device claims. */
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir, cpus, totalmem, platform, arch, release, availableParallelism } from 'node:os';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REVISION, SkinnedMesh } from 'three';
import { preparePack, preparedAdmission } from '../src/pack-loader.mjs';
import { ActorPool } from '../src/actor-pool.mjs';
import { LIMITS } from '../src/contracts.mjs';
import { localPackReader } from './read-local-pack.mjs';
import { buildWorkload } from './build-workloads.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = value => Buffer.from(JSON.stringify(value) + '\n');
const optional = async name => { try { return (await readFile(name, 'utf8')).trim(); } catch { return null; } };
const jsonFile = async path => JSON.parse(await readFile(path, 'utf8'));
export function summarize(raw) {
  assert(raw.length && raw.every(x => Number.isFinite(x) && x >= 0));
  const sorted = [...raw].sort((a, b) => a - b);
  const q = p => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)];
  return { count: raw.length, min: sorted[0], median: q(.5), p95: q(.95), p99: q(.99), max: sorted.at(-1), mean: raw.reduce((a, b) => a + b, 0) / raw.length };
}
async function sourceSnapshot() {
  const names = (await readdir(join(root, 'src'))).filter(x => x.endsWith('.mjs')).sort().map(x => 'src/' + x);
  names.push('tools/benchmark-authored-clips.mjs', 'tools/build-workloads.mjs', 'tools/read-local-pack.mjs', 'package.json', 'package-lock.json');
  const manifest = await jsonFile(join(root, 'fixtures/authored/manifest.json'));
  names.push('fixtures/authored/manifest.json', ...manifest.assets.map(a => 'fixtures/authored/' + a.path));
  const files = {};
  for (const name of [...new Set(names)].sort()) files[name] = hash(await readFile(join(root, name)));
  const dependencyFiles = {};
  for (const name of ['build/three.module.js', 'build/three.core.js', 'examples/jsm/loaders/GLTFLoader.js', 'examples/jsm/utils/SkeletonUtils.js', 'examples/jsm/utils/BufferGeometryUtils.js', 'package.json']) dependencyFiles['three/' + name] = hash(await readFile(join(root, 'node_modules/three', name)));
  return { sha256: hash(JSON.stringify({ files, dependencyFiles })), files, dependencyFiles };
}
function libraryDimensions(library, bytes) {
  const tracks = library.clips.flatMap(c => c.tracks), keys = tracks.reduce((n, t) => n + t.keys.length, 0);
  return { clips: library.clips.length, tracks: tracks.length, jointTracks: tracks.filter(t => t.target.startsWith('joint:')).length, accessoryTracks: tracks.filter(t => t.target.startsWith('accessory:')).length, keys, keyScalars: keys * 5, bytes, byteLimit: LIMITS.clipBytes, keyLimit: LIMITS.clipKeys, scalarLimit: LIMITS.clipKeyScalars, interpolationTracks: Object.fromEntries(['STEP', 'LINEAR'].map(mode => [mode, tracks.filter(t => t.interpolation === mode).length])) };
}
function ceilingLibrary() {
  // 15 distinct joints + one accessory, 128 independently phased keys each.
  // Six-place phases and seven-place quaternion components keep compact JSON
  // below 128 KiB without loosening any runtime quaternion validation.
  const tracks = Array.from({ length: 16 }, (_, track) => ({
    target: track === 15 ? 'accessory:testCap' : `joint:joint.${track}`,
    interpolation: track % 2 ? 'STEP' : 'LINEAR',
    keys: Array.from({ length: 128 }, (_, key) => {
      const jitter = key === 0 || key === 127 ? 0 : (((track * 11 + key * 3) % 7) - 3) * .03;
      const angle = [-.16, -.08, .04, .14][(Math.floor(key / 3) + track) % 4] * (track === 15 ? 2 : 1);
      const rotation = [0, 0, 0, Number(Math.cos(angle / 2).toFixed(7))];
      rotation[track % 3] = Number(Math.sin(angle / 2).toFixed(7));
      return { at: Number(((key + jitter) / 127).toFixed(6)), rotation };
    }),
  }));
  return { format: 'bubu-clips', version: '0.1.0', id: 'mechanical.authored-cpu-ceiling', clips: [{ id: 'ceiling', durationSec: 1, endBehavior: 'hold', tracks }] };
}
async function buildCases(temporary) {
  const fixture = join(root, 'fixtures/authored'), fixtureManifest = await jsonFile(join(fixture, 'manifest.json'));
  const equipment = fixtureManifest.equipment, accessoryAsset = fixtureManifest.assets.find(a => a.id === equipment[0].asset);
  const accessoryBytes = await readFile(join(fixture, accessoryAsset.path));
  const bases = [{ id: 'small-authored', directory: fixture, authoredFixture: true }];
  for (const dimensions of [
    { id: 'medium-ceiling', vertices: 12000, joints: 24, nodes: 64, morphTargets: 4 },
    { id: 'large-ceiling', vertices: 45000, joints: 48, nodes: 112, morphTargets: 8 },
  ]) {
    const directory = join(temporary, dimensions.id + '-base');
    await buildWorkload(directory, dimensions);
    const manifest = await jsonFile(join(directory, 'manifest.json'));
    const profileAsset = manifest.assets.find(a => a.kind === 'profile'), profile = await jsonFile(join(directory, profileAsset.path));
    profile.sockets = [{ id: 'head.accessory', node: `PassiveNode${dimensions.joints + 2}` }];
    profile.capabilities.push('rigid-socket');
    const profileBytes = encode(profile);
    Object.assign(profileAsset, { bytes: profileBytes.length, sha256: hash(profileBytes) });
    manifest.assets.push({ ...accessoryAsset });
    manifest.equipment = structuredClone(equipment);
    manifest.requiredCapabilities.push('rigid-socket', 'accessory-local-rotation');
    manifest.budgets.vertices += 100;
    manifest.budgets.nodes = LIMITS.nodes;
    await writeFile(join(directory, profileAsset.path), profileBytes);
    await writeFile(join(directory, accessoryAsset.path), accessoryBytes);
    await writeFile(join(directory, 'manifest.json'), encode(manifest));
    bases.push({ id: dimensions.id, directory, dimensions, authoredFixture: false });
  }
  const cases = [];
  for (const base of bases) {
    const original = await jsonFile(join(base.directory, 'manifest.json'));
    const libraryBase = base.authoredFixture ? await jsonFile(join(base.directory, original.assets.find(a => a.id === original.clips).path)) : ceilingLibrary();
    for (const interpolation of ['mixed', 'STEP', 'LINEAR']) {
      const id = base.id + '-' + interpolation.toLowerCase(), directory = join(temporary, id), manifest = structuredClone(original), library = structuredClone(libraryBase);
      if (interpolation !== 'mixed') for (const clip of library.clips) for (const track of clip.tracks) track.interpolation = interpolation;
      await mkdir(directory, { recursive: true });
      for (const asset of original.assets) await writeFile(join(directory, asset.path), await readFile(join(base.directory, asset.path)));
      let clipAsset = manifest.assets.find(a => a.id === manifest.clips);
      const preserveExactFixture = base.authoredFixture && interpolation === 'mixed';
      const clipBytes = preserveExactFixture ? await readFile(join(base.directory, clipAsset.path)) : encode(library);
      if (!clipAsset) { clipAsset = { id: 'clips', path: 'authored-clips.json', kind: 'clips' }; manifest.assets.push(clipAsset); }
      Object.assign(clipAsset, { bytes: clipBytes.length, sha256: hash(clipBytes) });
      manifest.clips = clipAsset.id;
      if (!manifest.requiredCapabilities.includes('authored-quaternion-clips')) manifest.requiredCapabilities.push('authored-quaternion-clips');
      if (!preserveExactFixture) manifest.budgets.totalBytes = manifest.assets.reduce((n, a) => n + a.bytes, 0);
      await writeFile(join(directory, clipAsset.path), clipBytes);
      const manifestBytes = preserveExactFixture ? await readFile(join(base.directory, 'manifest.json')) : encode(manifest);
      await writeFile(join(directory, 'manifest.json'), manifestBytes);
      const clip = libraryDimensions(library, clipBytes.length);
      assert(clip.bytes <= LIMITS.clipBytes);
      assert.equal(clip.keys, base.authoredFixture ? 14 : 2048);
      assert.equal(clip.keyScalars, base.authoredFixture ? 70 : 10240);
      cases.push({ id, directory, base: base.id, interpolation, exactAuthoredFixture: preserveExactFixture, meshWorkload: base.dimensions ?? null, clip, clipSha256: hash(clipBytes), manifestSha256: hash(manifestBytes), assets: manifest.assets.map(({ id, kind, bytes, sha256 }) => ({ id, kind, bytes, sha256 })) });
    }
  }
  return cases;
}
const advanceGroup = (actors, time) => { let changed = 0; for (const actor of actors) if (actor.advance(time)) changed++; return changed; };
function counters(actors) {
  return actors.reduce((a, actor) => { for (const key of ['ticks', 'eventEvaluations', 'laneSamples']) a[key] += actor.timeline.stats[key]; return a; }, { ticks: 0, eventEvaluations: 0, laneSamples: 0 });
}
const counterDelta = (a, b) => Object.fromEntries(Object.keys(a).map(key => [key, b[key] - a[key]]));
function assertReleased(pool, actors) {
  const stats = pool.stats;
  for (const key of ['actors', 'active', 'pending', 'vertices', 'nodes', 'deformedVertices', 'sourceBytes', 'clipKeyScalars']) assert.equal(stats[key], 0, `Pool ${key} not released`);
  assert.equal(stats.cache.live, 0); assert.equal(stats.cache.retainedReferences, 0); assert.equal(stats.cache.loads, stats.cache.disposals);
  for (const actor of actors) { assert(actor.disposed); assert.equal(actor.root.children.length, 0); }
  return stats;
}
function checkActive(actors, clip) {
  for (const actor of actors) for (const track of clip.tracks) assert.equal(actor.lanes.get(track.target).clipTrack, track);
}
function checkEnded(actors, clip) {
  for (const actor of actors) {
    assert.equal(actor.isAnimating(), false);
    for (const track of clip.tracks) {
      const lane = actor.lanes.get(track.target), q = track.keys.at(-1).rotation;
      const scale = (q[3] < 0 ? -1 : 1) / Math.hypot(...q);
      assert.equal(lane.clipTrack, null);
      for (let i = 0; i < 4; i++) assert(Math.abs(lane.value[i] - q[i] * scale) < 1e-12);
    }
  }
}
function individuallyTimedGroups(raw, actorCount, description) {
  return { rawIndividualGroupMs: raw, millisecondsPerIndividualGroupOperation: summarize(raw), actorCount, description };
}
async function runActors(pack, actorCount, config, repeat, lifecycleWarmup = false) {
  const cost = preparedAdmission(pack), sourceBytes = cost.sources.reduce((n, s) => n + s.bytes, 0), capacity = actorCount + 1;
  const limits = { actors: capacity, vertices: cost.vertices * capacity, nodes: cost.nodes * capacity, deformedVertices: cost.deformedVertices * capacity, clipKeyScalars: Math.max(1, cost.clipKeyScalars * capacity), sourceBytes };
  const pool = new ActorPool({ limits }), actors = [], allActors = [];
  try {
    let begin = performance.now();
    const seed = await pool.create(pack);
    const coldSourceDecodeAndSeedActorMs = performance.now() - begin;
    allActors.push(seed);
    const afterSeed = pool.stats, cachedCloneIndividualMs = [];
    begin = performance.now();
    for (let i = 0; i < actorCount; i++) {
      const start = performance.now(), actor = await pool.create(pack);
      cachedCloneIndividualMs.push(performance.now() - start); actors.push(actor); allActors.push(actor);
    }
    const cachedCloneGroupMs = performance.now() - begin, withSeedAndClones = pool.stats;
    seed.dispose(); seed.dispose();
    const active = pool.stats;
    assert.equal(active.actors, actorCount);
    assert.equal(active.clipKeyScalars, pack.budget.clipKeyScalars * actorCount);
    assert.equal(active.sourceBytes, sourceBytes);
    assert.equal(active.cache.loads, pack.manifest.assets.filter(a => a.kind === 'glb').length);
    assert.equal(active.cache.hits, active.cache.loads * actorCount);
    const clip = pack.clips.clips[0], duration = clip.durationSec, entrySec = .1;
    let time = 0;
    const enqueue = at => { for (const actor of actors) actor.enqueue({ time: at, type: 'playClip', clip: clip.id, entrySec }); };
    const start = () => { time += .025; enqueue(time); advanceGroup(actors, time); return time; };
    const warmStart = start();
    for (let i = 1; i <= config.warmupTicks; i++) advanceGroup(actors, warmStart + entrySec + duration * .95 * i / (config.warmupTicks + 1));
    time = warmStart + entrySec + duration * .96;
    const sampleBatches = phase => {
      const rawBatchMs = [], rawChangedActorTicks = [], timedCounters = { ticks: 0, eventEvaluations: 0, laneSamples: 0 }; 
      for (let batch = -config.warmupBatches; batch < config.batches; batch++) {
        const eventTime = start(), intervalStart = phase === 'entryBridge' ? eventTime : eventTime + entrySec;
        const span = phase === 'entryBridge' ? entrySec : duration;
        if (phase !== 'entryBridge') advanceGroup(actors, intervalStart);
        checkActive(actors, clip);
        const before = counters(actors);
        let changedActorTicks = 0;
        const startMs = performance.now();
        for (let tick = 1; tick <= config.ticks; tick++) changedActorTicks += advanceGroup(actors, intervalStart + span * .95 * tick / (config.ticks + 1));
        const elapsed = performance.now() - startMs, after = counters(actors);
        time = intervalStart + span * .96;
        checkActive(actors, clip);
        if (batch >= 0) {
          rawBatchMs.push(elapsed); rawChangedActorTicks.push(changedActorTicks);
          const delta = counterDelta(before, after);
          for (const key of Object.keys(timedCounters)) timedCounters[key] += delta[key];
        }
      }
      assert.equal(timedCounters.eventEvaluations, 0);
      assert.equal(timedCounters.ticks, config.batches * config.ticks * actorCount);
      return { rawBatchMs, rawChangedActorTicks, changedActorTicks: rawChangedActorTicks.reduce((a, b) => a + b, 0), changedActorTickRatio: rawChangedActorTicks.reduce((a, b) => a + b, 0) / (config.batches * config.ticks * actorCount), groupTicksPerBatch: config.ticks, actorCount, millisecondsPerGroupTickBatchMean: summarize(rawBatchMs.map(ms => ms / config.ticks)), millisecondsPerActorTickBatchMean: summarize(rawBatchMs.map(ms => ms / (config.ticks * actorCount))), timedCounters, description: 'One timing bracket per batch of group ticks. Each group tick advances every actor. Percentiles describe batch means, not individual ticks or frames. Restart, event processing, assertions and timeline-counter snapshots are outside the timed bracket. Counting changed actor advances is inside the timed loop for every interpolation mode.' };
    };
    const entryBridge = sampleBatches('entryBridge'), activeSampling = sampleBatches('activeClip');
    const individualGroupRaw = [];
    let eventTime = start(); time = eventTime + entrySec;
    advanceGroup(actors, time);
    for (let i = 1; i <= config.individualSamples; i++) {
      const at = eventTime + entrySec + duration * .95 * i / (config.individualSamples + 1), startMs = performance.now();
      advanceGroup(actors, at); individualGroupRaw.push(performance.now() - startMs); time = at;
    }
    checkActive(actors, clip);
    const enqueueRaw = [], eventEntryRaw = [], exactEndRaw = [], largeJumpRaw = [];
    const eventCounters = { ticks: 0, eventEvaluations: 0, laneSamples: 0 };
    for (let sample = -config.warmupEventSamples; sample < config.eventSamples; sample++) {
      time += .025;
      let startMs = performance.now(); enqueue(time); const enqueueMs = performance.now() - startMs;
      const before = counters(actors);
      startMs = performance.now(); advanceGroup(actors, time); const eventEntryMs = performance.now() - startMs;
      if (sample >= 0) {
        enqueueRaw.push(enqueueMs); eventEntryRaw.push(eventEntryMs);
        const delta = counterDelta(before, counters(actors));
        for (const key of Object.keys(eventCounters)) eventCounters[key] += delta[key];
      }
      checkActive(actors, clip);
      advanceGroup(actors, time + entrySec + duration * .5);
      const endTime = time + entrySec + duration;
      startMs = performance.now(); advanceGroup(actors, endTime); const exactEndMs = performance.now() - startMs;
      checkEnded(actors, clip); time = endTime;
      const queuedAt = time + .125;
      enqueue(queuedAt);
      const jumpTime = queuedAt + entrySec + duration + 1000;
      startMs = performance.now(); advanceGroup(actors, jumpTime); const jumpMs = performance.now() - startMs;
      checkEnded(actors, clip); time = jumpTime;
      if (sample >= 0) { exactEndRaw.push(exactEndMs); largeJumpRaw.push(jumpMs); }
    }
    assert.equal(eventCounters.eventEvaluations, config.eventSamples * actorCount);
    const beforeDispose = pool.stats;
    const actorDisposeIndividualMs = [];
    begin = performance.now();
    for (const actor of actors) { const s = performance.now(); actor.dispose(); actorDisposeIndividualMs.push(performance.now() - s); }
    const actorDisposeGroupMs = performance.now() - begin, afterFirstDispose = assertReleased(pool, allActors);
    begin = performance.now(); for (const actor of actors) { actor.dispose(); actor.dispose(); }
    const repeatedActorDisposeGroupMs = performance.now() - begin;
    begin = performance.now(); pool.dispose(); const poolDisposeMs = performance.now() - begin;
    begin = performance.now(); pool.dispose(); const repeatedPoolDisposeMs = performance.now() - begin;
    return {
      repeat, actorCount, lifecycleWarmup, explicitPoolLimits: limits,
      creation: { coldSourceDecodeAndSeedActorMs, cachedCloneIndividualMs, cachedCloneGroupMs, afterSeed, withSeedAndClones, activeAfterSeedRemoved: active, description: 'Actual ActorPool.create throughout. Cold seed includes GLTFLoader decode plus its clone. Subsequent sequential create calls hit decoded sources and include admission, skeleton clone, bindings and initial matrices; these are not pure SkeletonUtils timings. The untimed seed removal leaves exactly the stated actor count for runtime measurements.' },
      entryBridge, activeSampling,
      individualActive: individuallyTimedGroups(individualGroupRaw, actorCount, 'One timing bracket around one group advance during the active clip, excluding entry. Unlike batch means, these percentiles describe individual group-call latency. Includes timer and actor-loop overhead.'),
      enqueue: individuallyTimedGroups(enqueueRaw, actorCount, 'One playClip event per actor with an empty queue. Includes validation, allocation and sorting; excludes event processing. Not a queue-saturation benchmark.'),
      playClipEventEntry: { ...individuallyTimedGroups(eventEntryRaw, actorCount, 'One due playClip per actor: samples previous state at canonical event time, installs entry bridge, samples current time and conditionally updates matrices. The bridge interpolation is measured separately.'), timedCounters: eventCounters },
      exactEnd: individuallyTimedGroups(exactEndRaw, actorCount, 'One group advance from mid-clip to the exact terminal time. Endpoint hold, clip-track release and inactive status are asserted outside the timer.'),
      largeJump: individuallyTimedGroups(largeJumpRaw, actorCount, 'One queued playClip per actor followed by a single advance to 1,000 seconds after its end. Includes canonical event processing and terminal sampling; no catch-up frame loop. Endpoints and inactivity are asserted outside the timer.'),
      lifecycle: { beforeDispose, actorDisposeIndividualMs, actorDisposeGroupMs, afterFirstDispose, repeatedActorDisposeCallsPerActor: 2, repeatedActorDisposeGroupMs, poolDisposeMs, repeatedPoolDisposeMs, afterRepeatedDispose: assertReleased(pool, allActors), allOwnedCountersZero: true },
      finalTimelineCounters: counters(actors),
    };
  } finally { for (const actor of allActors) actor.dispose(); pool.dispose(); }
}
function rollup(runs, actorCount) {
  const selected = runs.filter(r => r.actorCount === actorCount), all = path => selected.flatMap(r => path(r));
  return { actorCount, measuredLifecycleRuns: selected.length,
    coldDecodeAndSeedActorMs: summarize(all(r => [r.creation.coldSourceDecodeAndSeedActorMs])),
    cachedCloneGroupMs: summarize(all(r => [r.creation.cachedCloneGroupMs])),
    cachedCloneIndividualMs: summarize(all(r => r.creation.cachedCloneIndividualMs)),
    activeGroupTickBatchMeanMs: summarize(all(r => r.activeSampling.rawBatchMs.map(ms => ms / r.activeSampling.groupTicksPerBatch))),
    activeChangedActorTicks: all(r => [r.activeSampling.changedActorTicks]).reduce((a, b) => a + b, 0),
    activeTotalActorTicks: all(r => [r.activeSampling.timedCounters.ticks]).reduce((a, b) => a + b, 0),
    activeChangedActorTickRatio: all(r => [r.activeSampling.changedActorTicks]).reduce((a, b) => a + b, 0) / all(r => [r.activeSampling.timedCounters.ticks]).reduce((a, b) => a + b, 0),
    entryBridgeGroupTickBatchMeanMs: summarize(all(r => r.entryBridge.rawBatchMs.map(ms => ms / r.entryBridge.groupTicksPerBatch))),
    individualActiveGroupMs: summarize(all(r => r.individualActive.rawIndividualGroupMs)),
    enqueueGroupMs: summarize(all(r => r.enqueue.rawIndividualGroupMs)),
    eventEntryGroupMs: summarize(all(r => r.playClipEventEntry.rawIndividualGroupMs)),
    exactEndGroupMs: summarize(all(r => r.exactEnd.rawIndividualGroupMs)),
    largeJumpGroupMs: summarize(all(r => r.largeJump.rawIndividualGroupMs)),
    actorDisposeGroupMs: summarize(all(r => [r.lifecycle.actorDisposeGroupMs])),
    allOwnedCountersZero: selected.every(r => r.lifecycle.allOwnedCountersZero),
  };
}
export async function runAuthoredClipBenchmark(options = {}) {
  const config = { runs: options.runs ?? 3, preparationWarmups: 1, lifecycleWarmupsPerCaseAndActor: 1, batches: options.batches ?? 8, ticks: options.ticks ?? 256, warmupTicks: options.warmupTicks ?? 256, warmupBatches: 2, eventSamples: options.eventSamples ?? 64, warmupEventSamples: 8, individualSamples: options.individualSamples ?? 128, actors: options.actors ?? [1, 4] };
  for (const [key, value] of Object.entries(config)) if (key !== 'actors') assert(Number.isInteger(value) && value > 0, key);
  assert(config.actors.length && config.actors.every(n => Number.isInteger(n) && n >= 1 && n <= 4));
  const sourceBefore = await sourceSnapshot(), temporary = await mkdtemp(join(tmpdir(), 'bubu-authored-cpu-'));
  const startedAt = new Date().toISOString(), originalVertexPosition = SkinnedMesh.prototype.getVertexPosition;
  let skinnedVertexReads = 0;
  try {
    const cases = await buildCases(temporary), results = [];
    const timerRawMs = [];
    for (let i = 0; i < 1000; i++) { const t = performance.now(); timerRawMs.push(performance.now() - t); }
    SkinnedMesh.prototype.getVertexPosition = function (...args) { skinnedVertexReads++; return originalVertexPosition.apply(this, args); };
    for (const workload of cases) {
      const reader = localPackReader(workload.directory), prepareWarmupRawMs = [], prepareRawMs = [], runs = [], lifecycleWarmups = [];
      let pack;
      for (let i = -config.preparationWarmups; i < config.runs; i++) {
        const start = performance.now(); pack = await preparePack(reader); const elapsed = performance.now() - start;
        (i < 0 ? prepareWarmupRawMs : prepareRawMs).push(elapsed);
      }
      assert.equal(pack.budget.clipKeyScalars, workload.clip.keyScalars);
      for (const actorCount of config.actors) lifecycleWarmups.push(await runActors(pack, actorCount, { ...config, batches: 1, ticks: Math.min(64, config.ticks), eventSamples: 4, individualSamples: 8 }, -1, true));
      for (let repeat = 0; repeat < config.runs; repeat++) {
        const order = repeat % 2 ? [...config.actors].reverse() : config.actors;
        for (const actorCount of order) runs.push(await runActors(pack, actorCount, config, repeat));
      }
      const { directory, ...dimensions } = workload;
      results.push({ workload: dimensions, actualBudget: pack.budget, preparePack: { warmupRawMs: prepareWarmupRawMs, rawIndividualMs: prepareRawMs, millisecondsPerIndividualPreparation: summarize(prepareRawMs), description: 'Actual local filesystem reader, bounded JSON checks, SHA-256 integrity, numeric GLB preflight, clip validation and immutable preparation. Files were recently read or generated; no cold-storage claim. Actor creation is excluded.' }, lifecycleWarmups, runs, summary: config.actors.map(n => rollup(runs, n)) });
      options.onCase?.(workload.id);
    }
    const sourceAfter = await sourceSnapshot();
    return { format: 'bubu-authored-clip-cpu-v1', startedAt, completedAt: new Date().toISOString(), config,
      reproductionCommand: `node tools/benchmark-authored-clips.mjs --runs ${config.runs} --batches ${config.batches} --ticks ${config.ticks} --warmupTicks ${config.warmupTicks} --eventSamples ${config.eventSamples} --individualSamples ${config.individualSamples} --actors ${config.actors.join(',')} --out evidence/authored-clip-cpu.json`,
      scope: 'Node CPU-only actual preparePack -> ActorPool -> createSuite/GLTFLoader -> canonical playClip sampling and owned-resource disposal, using mechanical fixtures.',
      exclusions: ['No browser, WebGLRenderer, GPU draw, GPU skinning, GPU memory, input latency, FPS or target-device performance claim.', 'Sample times include JavaScript timer and changed-advance counting overhead; timer overhead is recorded but not subtracted. Shared CPU scheduling, JIT and garbage collection are uncontrolled.', 'STEP holds often produce unchanged ticks and skip Object3D matrix propagation, while LINEAR commonly changes quaternion state and propagates matrices. Changed actor-tick ratios are reported; interpolation modes do not imply equal matrix-write workloads.', 'Percentiles over active/entry batches are percentiles of batch means, not individual calls. Separately bracketed group calls have their own distributions. A 4-actor group is four sequential actor advances, not four independent timing samples.', 'Repeats are within one Node process and machine session, not independent machine trials. Source case order is fixed; actor order alternates between measured repeats.', 'Zero owned admission and cache balances prove tested lifecycle bookkeeping, not zero heap retention, zero allocations, or general leak freedom. Historical cache load/disposal counters are expected to remain nonzero.', 'Generated medium/large mechanical packs are not approved character art. Geometry dimensions influence load/clone/matrix costs; active animation does not evaluate every skinned vertex on the CPU.'],
      environment: { node: process.version, v8: process.versions.v8, threeRevision: REVISION, threePackageVersion: (await jsonFile(join(root, 'node_modules/three/package.json'))).version, declaredThreeVersion: (await jsonFile(join(root, 'package.json'))).dependencies.three, importedThreeEntry: 'three/' + import.meta.resolve('three').split('/three/').at(-1), platform: platform(), arch: arch(), release: release(), cpuModel: cpus()[0]?.model ?? null, logicalCPUs: cpus().length, availableParallelism: availableParallelism(), cgroupCpuMax: await optional('/sys/fs/cgroup/cpu.max'), cgroupMemoryMax: await optional('/sys/fs/cgroup/memory.max'), systemMemoryBytes: totalmem(), execArgv: process.execArgv },
      source: { before: sourceBefore, after: sourceAfter, unchangedDuringMeasurement: sourceBefore.sha256 === sourceAfter.sha256 },
      timerOverhead: { rawIndividualMs: timerRawMs, millisecondsPerEmptyTimingBracket: summarize(timerRawMs), subtracted: false },
      normalRuntimeSkinnedVertexPositionCalls: skinnedVertexReads,
      allOwnedCountersZero: results.every(r => [...r.lifecycleWarmups, ...r.runs].every(x => x.lifecycle.allOwnedCountersZero)), results,
    };
  } finally { SkinnedMesh.prototype.getVertexPosition = originalVertexPosition; await rm(temporary, { recursive: true, force: true }); }
}
export function markdownReport(result) {
  const f = n => n.toFixed(6), rows = [];
  for (const item of result.results) for (const s of item.summary) rows.push(`| ${item.workload.id} | ${s.actorCount} | ${(100 * s.activeChangedActorTickRatio).toFixed(2)}% | ${f(s.cachedCloneGroupMs.median)} | ${f(s.activeGroupTickBatchMeanMs.median)} | ${f(s.activeGroupTickBatchMeanMs.p95)} | ${f(s.individualActiveGroupMs.p95)} | ${f(s.eventEntryGroupMs.median)} | ${f(s.largeJumpGroupMs.median)} |`);
  return `# Authored clip CPU evidence\n\nMeasured ${result.startedAt} to ${result.completedAt}.\n\n${result.scope}\n\n## Reproduction and source integrity\n\n- Run: \`${result.reproductionCommand}\`\n- Full configuration and every raw observation are in the accompanying JSON. Measured runs: ${result.config.runs}; actors: ${result.config.actors.join(', ')}; active/entry batches per run: ${result.config.batches} × ${result.config.ticks} group ticks.\n- One preparation and one complete shortened lifecycle warmup per case/actor are excluded from reported distributions but retained in JSON. Each measured lifecycle also uses ${result.config.warmupTicks} warmup ticks, ${result.config.warmupBatches} warmup batches per sampling phase, and ${result.config.warmupEventSamples} warmup event/end/jump samples.\n- Fingerprint before: \`${result.source.before.sha256}\`\n- Fingerprint after: \`${result.source.after.sha256}\`\n- Unchanged during measurement: **${result.source.unchangedDuringMeasurement}**. Per-file runtime, harness, fixture and selected Three dependency hashes are recorded.\n- Node ${result.environment.node}; Three ${result.environment.threePackageVersion}; ${result.environment.cpuModel}; CPU quota ${result.environment.cgroupCpuMax ?? 'unavailable'}.\n\n## Workloads and preparation\n\n| Case | Active tracks | Keys | Key scalars | Clip bytes | Runtime vertices | Runtime nodes | Prepare median ms |\n|---|---:|---:|---:|---:|---:|---:|---:|\n${result.results.map(r => `| ${r.workload.id} | ${r.workload.clip.tracks} | ${r.workload.clip.keys} | ${r.workload.clip.keyScalars} | ${r.workload.clip.bytes} | ${r.actualBudget.vertices} | ${r.actualBudget.nodes} | ${f(r.preparePack.millisecondsPerIndividualPreparation.median)} |`).join('\n')}\n\nThe mixed small case is an exact byte-for-byte copy of fixtures/authored. STEP-only and LINEAR-only cases use the same targets, phases and rotations, with interpolation changed and compact JSON encoding. Each ceiling library uses 15 distinct joints plus one accessory, 128 independently phased keys per track: exactly 2,048 keys and 10,240 key scalars, with compact JSON below the 131,072-byte admission limit. Medium geometry: 12,000 vertices, 24 joints, 64 source nodes and four morph targets; large: 45,000 vertices, 48 joints, 112 source nodes and eight morph targets, each plus the small accessory. These are mechanical load fixtures.\n\n## Runtime distributions (milliseconds)\n\n| Case | Actors | Changed actor ticks | Cached clone group median | Active batch-mean group tick median | Active batch-mean group tick p95 | Individual group tick p95 | Event entry group median | Large jump group median |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|\n${rows.join('\n')}\n\n“Group” means all stated actors. Cached clone measures actual sequential ActorPool.create calls with decoded GLBs held by an untimed seed actor; it includes admission, clone, bindings and initial matrices. Cold decode-plus-seed and individual cached creation timings are separately retained. The seed is removed before sampling, so 1/4 means exactly 1/4 runtime actors. Custom pool ceilings admit the large group and transient seed explicitly.\n\nSTEP holds can leave the quaternion unchanged and skip matrix propagation. The changed actor-tick ratio reports actual suite.advance return values during timed active batches, including the original small fixture’s holds. STEP and LINEAR therefore have different write loads; these measurements must not be described as pure interpolation instruction costs. The small counter overhead is included equally for all modes.\n\nActive/entry batch means are throughput measurements: each batch timer covers ${result.config.ticks} group ticks; p95 is over batch means. Individual active, enqueue, event-entry, exact-end and large-jump timers each bracket one group operation and retain their separate raw samples. The event-entry timer processes one due playClip per actor; the 0.1-second entry bridge is sampled separately. Enqueue excludes processing and measures an empty queue. Large-jump includes the queued event and terminal evaluation after a 1,000-second skipped interval. Endpoints, active-track ownership, event counts and inactivity are asserted outside timed brackets.\n\n## Disposal and limits\n\n- Every measured and warmup lifecycle returned actor/active/pending, vertices/nodes/deformed vertices, source bytes, key scalar reservations, live decoded resources and retained cache references to zero: **${result.allOwnedCountersZero}**. Every decoded load had exactly one matching disposal.\n- Actors are disposed once with individual/group timings, then twice more for idempotence; pool disposal is timed and repeated. Actor root children are asserted empty. JSON includes before/after counters for every run.\n- Calls to SkinnedMesh.getVertexPosition during measured preparation/runtime: **${result.normalRuntimeSkinnedVertexPositionCalls}**.\n- Empty timer-bracket median: ${f(result.timerOverhead.millisecondsPerEmptyTimingBracket.median)} ms; not subtracted.\n\n${result.exclusions.map(x => '- ' + x).join('\n')}\n`;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), options = {};
  let output = join(root, 'evidence/authored-clip-cpu.json');
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--quick') Object.assign(options, { runs: 1, batches: 2, ticks: 32, warmupTicks: 32, eventSamples: 8, individualSamples: 16 });
    else {
      const value = args[++i]; assert(value !== undefined, 'Missing value for ' + flag);
      if (flag === '--out') output = resolve(value);
      else if (flag === '--actors') options.actors = value.split(',').map(Number);
      else if (['runs', 'batches', 'ticks', 'warmupTicks', 'eventSamples', 'individualSamples'].includes(flag.slice(2))) options[flag.slice(2)] = Number(value);
      else throw new Error('Unknown option: ' + flag);
    }
  }
  options.onCase = id => console.error('Measured ' + id);
  const result = await runAuthoredClipBenchmark(options);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(result, null, 2) + '\n');
  const report = output.replace(/\.json$/, '') + '-summary.md'; await writeFile(report, markdownReport(result));
  console.log(JSON.stringify({ output: relative(root, output), report: relative(root, report), cases: result.results.length, actors: result.config.actors, sourceUnchanged: result.source.unchangedDuringMeasurement, allOwnedCountersZero: result.allOwnedCountersZero, skinnedVertexPositionCalls: result.normalRuntimeSkinnedVertexPositionCalls }, null, 2));
  if (!result.source.unchangedDuringMeasurement || !result.allOwnedCountersZero) process.exitCode = 2;
}
