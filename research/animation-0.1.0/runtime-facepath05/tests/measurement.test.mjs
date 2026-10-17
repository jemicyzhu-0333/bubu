import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { WORKLOADS, makeWorkloadGLB, buildWorkloads } from '../tools/build-workloads.mjs';
import { runMatrix, summarize } from '../tools/benchmark-matrix.mjs';
import { preparePack } from '../src/pack-loader.mjs';
import { localPackReader } from '../tools/read-local-pack.mjs';
import { ResourceCache } from '../src/resource-cache.mjs';
import { createSuite } from '../src/suite.mjs';
import { LIMITS } from '../src/contracts.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');

test('workload axes isolate vertices, joints, nodes and morph targets', () => {
  const baseline = WORKLOADS.find(w => w.id === 'vertices-medium');
  assert.deepEqual(WORKLOADS.filter(w => w.axis === 'vertices').map(w => w.vertices), [1008, 12000, 45000]);
  for (const w of WORKLOADS.filter(w => w.axis !== 'combined')) {
    for (const key of ['vertices', 'joints', 'nodes', 'morphTargets']) if (key !== w.axis) assert.equal(w[key], baseline[key], `${w.id}: ${key} must stay fixed`);
  }
  assert.equal(new Set(WORKLOADS.map(w => w.id)).size, WORKLOADS.length);
});

test('mechanical GLB generator is byte deterministic and rejects unsupported shapes', () => {
  const w = WORKLOADS[0];
  assert.equal(sha(makeWorkloadGLB(w)), sha(makeWorkloadGLB(w)));
  for (const patch of [{ vertices: 1001 }, { joints: 65 }, { nodes: 5 }, { morphTargets: 3 }]) assert.throws(() => makeWorkloadGLB({ ...w, ...patch }), RangeError);
});

test('all generated workloads pass actual preparation and runtime binding within hard limits', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bubu-workload-test-'));
  try {
    const workloads = await buildWorkloads(directory);
    for (const w of workloads) {
      const pack = await preparePack(localPackReader(w.directory));
      assert.equal(pack.budget.vertices, w.vertices);
      assert.equal(pack.budget.nodes, w.expectedRuntimeNodes);
      assert.equal(pack.budget.deformedVertices, w.deformedVertices);
      assert.ok(w.glbBytes < LIMITS.assetBytes);
      assert.ok(pack.audits.get('body').accessorScalars < LIMITS.accessorScalars);
      assert.ok(pack.budget.deformedVertices <= LIMITS.deformedVertices);
      assert.equal(sha(await readFile(join(w.directory, 'mechanical.glb'))), w.glbSha256);
      const cache = new ResourceCache(), suites = [];
      try {
        suites.push(await createSuite(pack, cache), await createSuite(pack, cache));
        const [a, b] = suites, am = a.model.getObjectByName('MechanicalGrid'), bm = b.model.getObjectByName('MechanicalGrid');
        assert.notEqual(am.skeleton, bm.skeleton);
        assert.equal(am.geometry, bm.geometry);
        assert.notEqual(am.morphTargetInfluences, bm.morphTargetInfluences);
        a.enqueue({ time: 0, type: 'play', segment: 'moveA' });
        assert.equal(a.advance(.25), true);
        assert.ok(am.morphTargetInfluences.some(x => x > 0));
        assert.ok(bm.morphTargetInfluences.every(x => x === 0));
        assert.equal(a.lanes.size, w.joints);
        assert.equal(cache.stats.loads, 1);
        assert.equal(cache.stats.hits, 1);
        a.dispose(); assert.equal(cache.stats.live, 1);
      } finally { for (const s of suites) { s.dispose(); s.dispose(); } }
      assert.equal(cache.stats.live, 0);
      assert.equal(cache.retainedReferences, 0);
      assert.equal(cache.stats.disposals, 1);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('timing summaries use nearest-rank quantiles without changing raw observations', () => {
  const raw = [4, 1, 2, 3];
  assert.deepEqual(summarize(raw), { count: 4, min: 1, median: 2, p95: 4, p99: 4, max: 4, mean: 2.5 });
  assert.deepEqual(raw, [4, 1, 2, 3]);
  assert.throws(() => summarize([]));
  assert.throws(() => summarize([NaN]));
});

test('CPU matrix records separate throughput/latency samples, actual events, release and pool evidence', async () => {
  const config = { workloadIds: ['vertices-small'], runs: 2, actors: [1, 3], batches: 2, ticks: 30, warmupTicks: 20, latencySamples: 12, eventsPerBatch: 8 };
  const matrix = await runMatrix(config);
  assert.equal(matrix.environment.threePackageVersion, '0.186.1');
  assert.equal(matrix.normalRuntimeSkinnedVertexPositionCalls, 0);
  assert.equal(matrix.results.length, 1);
  assert.equal(matrix.results[0].runs.length, 4);
  assert.equal(matrix.results[0].preparePack.rawMs.length, 2);
  assert.equal(matrix.results[0].preflightOnly.rawMs.length, 2);
  assert.ok(matrix.source.before.files['src/suite.mjs']);
  assert.ok(matrix.source.before.files['src/actor-pool.mjs']);
  for (const r of matrix.results[0].runs) {
    assert.equal(r.steady.rawElapsedMs.length, config.batches);
    assert.equal(r.individual.rawGroupAdvanceMs.length, config.latencySamples);
    assert.equal(r.steady.millisecondsPerOperationBatchMean.count, config.batches);
    assert.equal(r.individual.millisecondsPerIndividualGroupAdvance.count, config.latencySamples);
    assert.equal(r.queue.counters.eventEvaluations, config.batches * config.eventsPerBatch * r.actorCount);
    assert.equal(r.lifecycle.afterDispose.live, 0);
    assert.equal(r.lifecycle.afterDispose.retainedReferences, 0);
    assert.equal(r.actorPool.immediatelyReserved.pending, r.actorCount);
    assert.equal(r.actorPool.immediatelyReserved.active, 0);
    assert.equal(r.actorPool.active.active, r.actorCount);
    assert.equal(r.actorPool.active.sourceBytes, matrix.results[0].workload.glbBytes);
    assert.equal(r.actorPool.active.cache.loads, 1);
    assert.equal(r.actorPool.rejectionCode, 'GLOBAL_BUDGET');
    assert.equal(r.actorPool.afterRejectedAdmission.actors, r.actorCount);
    assert.equal(r.actorPool.afterDispose.sourceBytes, 0);
    assert.equal(r.actorPool.afterDispose.actors, 0);
  }
});
