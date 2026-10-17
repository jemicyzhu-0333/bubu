#!/usr/bin/env node
/** CPU-only runtime measurements, with raw observations and explicitly different metric units. */
import { performance } from 'node:perf_hooks';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir, cpus, totalmem, platform, arch, release, availableParallelism } from 'node:os';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SkinnedMesh, REVISION } from 'three';
import { preparePack } from '../src/pack-loader.mjs';
import { preflightGLB } from '../src/glb-preflight.mjs';
import { createSuite } from '../src/suite.mjs';
import { ResourceCache } from '../src/resource-cache.mjs';
import { ActorPool } from '../src/actor-pool.mjs';
import { localPackReader } from './read-local-pack.mjs';
import { buildWorkloads, WORKLOADS } from './build-workloads.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
export function summarize(samples) {
  if (!samples.length || samples.some(x => !Number.isFinite(x) || x < 0)) throw new Error('Expected finite nonnegative timing samples');
  const sorted = [...samples].sort((a, b) => a - b);
  const quantile = p => sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
  return { count: sorted.length, min: sorted[0], median: quantile(.5), p95: quantile(.95), p99: quantile(.99), max: sorted.at(-1), mean: samples.reduce((a, b) => a + b, 0) / samples.length };
}
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const readOptional = async path => { try { return (await readFile(path, 'utf8')).trim(); } catch { return null; } };
const threeEntry = createRequire(import.meta.url).resolve('three');
async function sourceSnapshot() {
  const names = (await readdir(join(root, 'src'))).filter(x => x.endsWith('.mjs')).sort().map(x => 'src/' + x);
  names.push('tools/build-workloads.mjs', 'tools/benchmark-matrix.mjs', 'tools/read-local-pack.mjs', 'package.json', 'package-lock.json');
  const files = {};
  for (const name of names) files[name] = hash(await readFile(join(root, name)));
  return { sha256: hash(JSON.stringify(files)), files };
}
function resourceState(cache) {
  return { ...cache.stats, retainedReferences: cache.retainedReferences, cacheEntries: cache.entries.size };
}
function assertReleased(cache) {
  const s = resourceState(cache);
  if (s.live !== 0 || s.retainedReferences !== 0 || s.cacheEntries !== 0 || s.loads !== s.disposals) throw new Error(`Lifecycle ownership not released: ${JSON.stringify(s)}`);
  return s;
}
function groupAdvance(suites, t) { for (const s of suites) s.advance(t); }
function startMotion(suites, time, sequence) {
  for (const s of suites) s.enqueue({ time, type: 'play', segment: sequence % 2 ? 'moveB' : 'moveA' });
  groupAdvance(suites, time);
}
function aggregateCounters(suites) {
  const result = { ticks: 0, eventEvaluations: 0, laneSamples: 0, maxQueueDepth: 0 };
  for (const s of suites) {
    for (const key of ['ticks', 'eventEvaluations', 'laneSamples']) result[key] += s.timeline.stats[key];
    result.maxQueueDepth = Math.max(result.maxQueueDepth, s.timeline.stats.queuedPeak);
  }
  return result;
}
function deltaCounters(before, after) {
  return { ticks: after.ticks - before.ticks, eventEvaluations: after.eventEvaluations - before.eventEvaluations, laneSamples: after.laneSamples - before.laneSamples, maxQueueDepth: after.maxQueueDepth };
}
function phaseMeasure(suites, samples, count, work, setup = () => {}) {
  const rawMs = [];
  for (let batch = 0; batch < samples; batch++) {
    setup(batch);
    const start = performance.now(); work(batch); rawMs.push(performance.now() - start);
  }
  return { rawElapsedMs: rawMs, operationsPerBatch: count, millisecondsPerOperationBatchMean: summarize(rawMs.map(ms => ms / count)), actorCount: suites.length };
}

async function sampleRuntime(pack, actorCount, config, repeat) {
  const cache = new ResourceCache(), suites = [], heapBeforeCreate = process.memoryUsage();
  const createIndividualMs = [], createStart = performance.now();
  try {
    for (let i = 0; i < actorCount; i++) {
      const begin = performance.now(); suites.push(await createSuite(pack, cache)); createIndividualMs.push(performance.now() - begin);
    }
    const createGroupMs = performance.now() - createStart;
    const afterCreate = resourceState(cache), heapAfterCreate = process.memoryUsage();
    let time = 0, sequence = 0;
    startMotion(suites, time, sequence++);
    for (let i = 0; i < config.warmupTicks; i++) { time += .5 / (config.warmupTicks + 1); groupAdvance(suites, time); }
    const steadyStartCounters = aggregateCounters(suites);
    const steady = phaseMeasure(suites, config.batches, config.ticks, () => {
      for (let tick = 0; tick < config.ticks; tick++) { time += .5 / (config.ticks + 1); groupAdvance(suites, time); }
    }, () => startMotion(suites, time, sequence++));
    steady.countersIncludingUntimedMotionStarts = deltaCounters(steadyStartCounters, aggregateCounters(suites));
    steady.millisecondsPerActorTickBatchMean = summarize(steady.rawElapsedMs.map(ms => ms / (config.ticks * actorCount)));
    steady.description = 'Timed loop calls suite.advance for every actor at each distinct animation time. Playback enqueue/start is outside each batch timer. Percentiles are over batch means, not individual call latency.';

    startMotion(suites, time, sequence++);
    const individualRawMs = [];
    for (let i = 0; i < config.latencySamples; i++) {
      time += .5 / (config.latencySamples + 1);
      const begin = performance.now(); groupAdvance(suites, time); individualRawMs.push(performance.now() - begin);
    }
    const individual = { rawGroupAdvanceMs: individualRawMs, millisecondsPerIndividualGroupAdvance: summarize(individualRawMs), actorCount, description: 'One timing bracket around one group advance, including its actor loop. Includes timer overhead; not renderer or end-to-end frame latency.' };

    const enqueueRawMs = [], dueEventRawMs = [], enqueueCountersBefore = aggregateCounters(suites);
    for (let batch = 0; batch < config.batches; batch++) {
      const eventTime = time + .01;
      let begin = performance.now();
      for (const s of suites) for (let event = 0; event < config.eventsPerBatch; event++) s.enqueue({ time: eventTime, type: 'play', segment: event % 2 ? 'moveB' : 'moveA' });
      enqueueRawMs.push(performance.now() - begin);
      begin = performance.now(); groupAdvance(suites, eventTime); dueEventRawMs.push(performance.now() - begin);
      time = eventTime;
    }
    const queue = {
      eventsPerActorBatch: config.eventsPerBatch,
      enqueue: { rawBatchMs: enqueueRawMs, millisecondsPerEnqueuedEventBatchMean: summarize(enqueueRawMs.map(ms => ms / (config.eventsPerBatch * actorCount))) },
      processDueEvents: { rawGroupAdvanceMs: dueEventRawMs, millisecondsPerDueEventBatchMean: summarize(dueEventRawMs.map(ms => ms / (config.eventsPerBatch * actorCount))) },
      counters: deltaCounters(enqueueCountersBefore, aggregateCounters(suites)),
      description: 'Enqueue timer includes validation, event allocation and sorting. Processing timer excludes enqueue and includes all due events plus the final sample/matrix update. Event means are throughput, not per-event latency.',
    };
    const mixed = phaseMeasure(suites, config.batches, config.ticks, () => {
      for (let tick = 0; tick < config.ticks; tick++) {
        time += 1 / 240;
        if (tick % 60 === 0) for (const s of suites) s.enqueue({ time, type: 'play', segment: sequence % 2 ? 'moveB' : 'moveA' });
        if (tick % 60 === 0) sequence++;
        groupAdvance(suites, time);
      }
    });
    mixed.description = 'Timed advance loop with play enqueue and event processing every 60 group ticks (synthetic 240 Hz canonical time). Batch-throughput metric.';

    groupAdvance(suites, time + 2); time += 2;
    const idle = phaseMeasure(suites, config.batches, config.ticks, () => {
      for (let tick = 0; tick < config.ticks; tick++) { time += 1 / 240; groupAdvance(suites, time); }
    });
    idle.description = 'Explicit idle advance calls; the demand scheduler would ordinarily avoid these calls. This is not a zero-work idle renderer result.';
    const finalCounters = aggregateCounters(suites), beforeDispose = resourceState(cache), heapBeforeDispose = process.memoryUsage();
    const disposeStart = performance.now();
    for (const s of suites) { s.dispose(); s.dispose(); }
    const disposeGroupMs = performance.now() - disposeStart;
    return {
      repeat, actorCount, create: { decodedCache: 'empty initially; actor 1 decodes, later actors reuse decoded source', rawIndividualActorMs: createIndividualMs, groupMs: createGroupMs, afterCreate },
      steady, individual, queue, mixed, idle, finalCounters,
      lifecycle: { disposeGroupMs, disposalCallsPerActor: 2, beforeDispose, afterDispose: assertReleased(cache) },
      memorySnapshotsBytes: { beforeCreate: heapBeforeCreate, afterCreate: heapAfterCreate, beforeDispose: heapBeforeDispose, afterDispose: process.memoryUsage() },
    };
  } finally {
    for (const s of suites) s.dispose();
  }
}

async function samplePool(pack, actorCount) {
  const sourceBytes = pack.manifest.assets.filter(a => a.kind === 'glb').reduce((sum, a) => sum + a.bytes, 0);
  const limits = { actors: actorCount, vertices: pack.budget.vertices * actorCount, nodes: pack.budget.nodes * actorCount, deformedVertices: pack.budget.deformedVertices * actorCount, sourceBytes };
  const pool = new ActorPool({ limits });
  try {
    const begin = performance.now();
    const pending = Array.from({ length: actorCount }, () => pool.create(pack));
    const immediatelyReserved = pool.stats;
    const suites = await Promise.all(pending), concurrentCreateGroupMs = performance.now() - begin;
    const active = pool.stats;
    let rejectionCode = null;
    const rejectStart = performance.now();
    try { const extra = await pool.create(pack); extra.dispose(); }
    catch (e) { rejectionCode = e.code ?? e.name; }
    const rejectedAdmissionMs = performance.now() - rejectStart;
    if (rejectionCode !== 'GLOBAL_BUDGET') throw new Error('Expected global actor admission rejection');
    const afterRejectedAdmission = pool.stats;
    const disposeStart = performance.now();
    for (const suite of suites) suite.dispose();
    const disposeGroupMs = performance.now() - disposeStart;
    pool.dispose(); pool.dispose();
    const afterDispose = pool.stats;
    for (const key of ['actors', 'active', 'pending', 'vertices', 'nodes', 'deformedVertices', 'sourceBytes']) if (afterDispose[key] !== 0) throw new Error(`Pool accounting not released: ${key}`);
    if (afterDispose.cache.live !== 0 || afterDispose.cache.retainedReferences !== 0 || afterDispose.cache.loads !== afterDispose.cache.disposals) throw new Error('Pool resource ownership not released');
    if (active.sourceBytes !== sourceBytes || active.cache.loads !== 1 || active.cache.hits !== actorCount - 1) throw new Error('Shared GLB source was not deduplicated');
    return { actorCount, limits, immediatelyReserved, concurrentCreateGroupMs, active, rejectedAdmissionMs, rejectionCode, afterRejectedAdmission, disposeGroupMs, afterDispose,
      description: 'Concurrent ActorPool.create invokes actual createSuite/GLTFLoader. Limits are explicitly sized to this actor group, which can exceed default limits. Source bytes reserve one unique encoded GLB, not decoded heap, GPU memory, or caller-owned prepared bytes.' };
  } finally { pool.dispose(); }
}

export async function runMatrix(options = {}) {
  const config = {
    runs: options.runs ?? 3, batches: options.batches ?? 8, ticks: options.ticks ?? 600,
    warmupTicks: options.warmupTicks ?? 600, latencySamples: options.latencySamples ?? 256, eventsPerBatch: options.eventsPerBatch ?? 64,
    actors: options.actors ?? [1, 4], workloadIds: options.workloadIds ?? WORKLOADS.map(w => w.id),
  };
  for (const key of ['runs', 'batches', 'ticks', 'warmupTicks', 'latencySamples', 'eventsPerBatch']) if (!Number.isInteger(config[key]) || config[key] < 1) throw new Error(`Positive integer required for ${key}`);
  if (config.eventsPerBatch > 128 || !config.actors.length || config.actors.some(x => !Number.isInteger(x) || x < 1 || x > 16)) throw new Error('Unsupported actor/event count');
  const sourceBefore = await sourceSnapshot(), temporary = await mkdtemp(join(tmpdir(), 'bubu-cpu-matrix-'));
  const originalGetVertex = SkinnedMesh.prototype.getVertexPosition;
  let skinnedVertexReads = 0;
  try {
    const workloads = await buildWorkloads(temporary, config.workloadIds), results = [];
    const timerRawMs = [];
    for (let i = 0; i < 1000; i++) { const start = performance.now(); timerRawMs.push(performance.now() - start); }
    SkinnedMesh.prototype.getVertexPosition = function (...args) { skinnedVertexReads++; return originalGetVertex.apply(this, args); };
    const startedAt = new Date().toISOString();
    for (const workload of workloads) {
      const reader = localPackReader(workload.directory), prepareRawMs = [], preflightRawMs = [], runs = [];
      const glb = new Uint8Array(await readFile(join(workload.directory, 'mechanical.glb')));
      let pack;
      for (let repeat = 0; repeat < config.runs; repeat++) {
        let begin = performance.now(); pack = await preparePack(reader); prepareRawMs.push(performance.now() - begin);
        begin = performance.now(); preflightGLB(glb, pack.manifest.budgets); preflightRawMs.push(performance.now() - begin);
        // Alternate actor order on repeated runs to reduce a simple 1-before-4 order bias.
        const actorOrder = repeat % 2 ? [...config.actors].reverse() : config.actors;
        for (const actorCount of actorOrder) {
          const runtime = await sampleRuntime(pack, actorCount, config, repeat);
          runtime.actorPool = await samplePool(pack, actorCount);
          runs.push(runtime);
        }
      }
      const { directory, ...dimensions } = workload;
      results.push({ workload: dimensions, actualBudget: pack.budget, accessorScalars: pack.audits.get('body').accessorScalars,
        preparePack: { rawMs: prepareRawMs, millisecondsPerOperation: summarize(prepareRawMs), description: 'Filesystem reader + JSON validation + SHA-256 integrity + numeric GLB preflight. Files were just generated; this is not cold-disk I/O.' },
        preflightOnly: { rawMs: preflightRawMs, millisecondsPerOperation: summarize(preflightRawMs), description: 'preflightGLB on already resident bytes; includes bounded float/index/skin scans.' }, runs });
      options.onWorkload?.(dimensions.id);
    }
    const sourceAfter = await sourceSnapshot();
    return {
      format: 'bubu-cpu-runtime-matrix-v1', startedAt, completedAt: new Date().toISOString(), config,
      scope: 'Node CPU mechanics only: actual preparePack, GLTFLoader/createSuite, quaternion and morph writes, Object3D matrix updates, canonical events, and CPU resource ownership. No WebGLRenderer or browser run.',
      exclusions: ['No GPU draw, skinning shader, GPU memory, browser input, frame rate, or hardware device claim.', 'Morph/skin vertex counts govern preflight/loading and hypothetical GPU deformation; advance writes channels and matrices, not all vertices.', 'Heap snapshots are process-wide observations with uncontrolled GC; they prove neither leak freedom nor zero allocation.', 'Shared cloud CPU scheduling, JIT and GC are uncontrolled; repeated within-process runs are observations, not independent machine trials.'],
      environment: { node: process.version, v8: process.versions.v8, threeRevision: REVISION, threePackageVersion: JSON.parse(await readFile(join(dirname(threeEntry), '..', 'package.json'), 'utf8')).version, threeDeclaredVersion: JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).dependencies.three, threeEntrySha256: hash(await readFile(threeEntry)), platform: platform(), arch: arch(), release: release(), logicalCPUs: cpus().length, availableParallelism: availableParallelism(), cgroupCpuMax: await readOptional('/sys/fs/cgroup/cpu.max'), cgroupMemoryMax: await readOptional('/sys/fs/cgroup/memory.max'), cpuModel: cpus()[0]?.model ?? null, systemMemoryBytes: totalmem(), execArgv: process.execArgv },
      source: { before: sourceBefore, after: sourceAfter, unchangedDuringMeasurement: sourceBefore.sha256 === sourceAfter.sha256 },
      timerOverhead: { rawMs: timerRawMs, millisecondsPerEmptyTimingBracket: summarize(timerRawMs), subtractedFromMeasurements: false },
      normalRuntimeSkinnedVertexPositionCalls: skinnedVertexReads,
      results,
    };
  } finally {
    SkinnedMesh.prototype.getVertexPosition = originalGetVertex;
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), options = {};
  let output = join(root, 'evidence', 'cpu-matrix.json');
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--quick') Object.assign(options, { runs: 1, batches: 2, ticks: 80, warmupTicks: 80, latencySamples: 32 });
    else {
      const value = args[++i]; if (value === undefined) throw new Error(`Missing value for ${flag}`);
      if (flag === '--out') output = resolve(value);
      else if (flag === '--workloads') options.workloadIds = value.split(',');
      else if (flag === '--actors') options.actors = value.split(',').map(Number);
      else if (['--runs', '--batches', '--ticks', '--warmupTicks', '--latencySamples', '--eventsPerBatch'].includes(flag)) options[flag.slice(2)] = Number(value);
      else throw new Error(`Unknown option: ${flag}`);
    }
  }
  options.onWorkload = id => console.error(`Measured ${id}`);
  const result = await runMatrix(options);
  await mkdir(dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ output: relative(root, output), workloads: result.results.length, runs: result.config.runs, actors: result.config.actors, sourceUnchanged: result.source.unchangedDuringMeasurement, skinnedVertexPositionCalls: result.normalRuntimeSkinnedVertexPositionCalls }, null, 2));
  if (!result.source.unchangedDuringMeasurement) process.exitCode = 2;
}
