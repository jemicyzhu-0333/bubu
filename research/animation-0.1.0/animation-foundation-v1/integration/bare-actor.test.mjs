import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as T from 'three';
import { FoundationPool } from './foundation-host.mjs';
import { createFoundationRuntime } from './foundation-runtime.mjs';
import { createBody, createHybridSource, loadGLB, revised } from './asset-fixtures.mjs';
import { createD2BindingProvider } from './asset-bindings.mjs';
import { loadResearchContactEvidence } from '../contact/research-evidence.mjs';
import { FIXTURES } from '../configuration/fixtures/index.mjs';

function renderedIdentity(actor) {
  const hash = createHash('sha256');
  actor.scene.updateMatrixWorld(true);
  actor.scene.traverse(mesh => {
    if (!mesh.isMesh) return;
    hash.update(JSON.stringify({ name: mesh.name, visible: mesh.visible, matrix: mesh.matrixWorld.elements,
      material: (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map(material => ({
        type: material.type, color: material.color?.getHex(), opacity: material.opacity,
        transparent: material.transparent, side: material.side
      })) }));
    for (const [name, attribute] of Object.entries(mesh.geometry.attributes)) {
      hash.update(name);
      hash.update(Buffer.from(attribute.array.buffer, attribute.array.byteOffset, attribute.array.byteLength));
    }
    if (mesh.skeleton) hash.update(Buffer.from(mesh.skeleton.boneMatrices.buffer));
  });
  return hash.digest('hex');
}
function target(actor) {
  const p = actor.f.h.body.skin.localToWorld(new T.Vector3(-.2, 1.4, 0)).project(actor.f.camera);
  return { clientX: (p.x + 1) * 192, clientY: (1 - p.y) * 192 };
}
function assertReleased(pool) {
  assert.equal(pool.diagnostics().budget.claimedBytes, 0);
  assert.equal(pool.diagnostics().actors, 0);
  assert.equal(pool.diagnostics().pending, 0);
  assert.equal(pool.diagnostics().parts.references, 0);
}

test('bare actor skips binding preparation, rejects wardrobe I/O and preserves visible anatomy and gestures', async () => {
  let preparations = 0, tailLoads = 0;
  const runtime = createFoundationRuntime({ createBody, createHybridSource, revised, loadResearchContactEvidence,
    loadGLB: async path => { tailLoads++; return loadGLB(path); },
    createD2BindingProvider: async (...args) => { preparations++; return createD2BindingProvider(...args); }
  });
  const pool = new runtime.FoundationPool();
  try {
    const prepared = await pool.create(), bare = await pool.create({ equipmentMode: 'bare' });
    assert.equal(preparations, 1);
    assert.equal(tailLoads, 2, 'the approved anatomical tail is retained for both actors');
    assert.equal(bare.bindings, null);
    assert.equal(prepared.equipmentMode, 'prepared');
    assert.equal(bare.equipmentMode, 'bare');
    const before = pool.diagnostics().budget.claimedBytes;
    let reads = 0, loads = 0;
    const request = { get actor() { reads++; throw new Error('must not read rejected wardrobe input'); } };
    await assert.rejects(bare.equip(request, { load: () => { loads++; } }), /Bare actor/);
    assert.equal(reads, 0);
    assert.equal(loads, 0);
    assert.equal(pool.diagnostics().budget.claimedBytes, before);
    assert.equal(bare.pendingEquips, 0);
    const compare = () => {
      assert.deepEqual(bare.f.h.state, prepared.f.h.state);
      assert.equal(renderedIdentity(bare), renderedIdentity(prepared));
    };
    const step = (time, policy) => { prepared.step(time, policy); bare.step(time, policy); compare(); };
    const emit = (type, time, point) => {
      prepared.f.emit(type, time, point ?? target(prepared));
      bare.f.emit(type, time, point ?? target(bare));
    };
    compare(); step(.1);
    emit('pointerdown', .15); step(.15); step(.8);
    assert.equal(bare.f.h.state.mode, 'petting');
    const p = target(bare); p.clientX += 90; p.clientY -= 50;
    emit('pointermove', .85, p); step(.85);
    assert.equal(bare.f.h.state.mode, 'drag');
    emit('pointerup', .9, p); step(.9); step(2);
    emit('pointerdown', 2.1); step(2.1);
    emit('pointercancel', 2.2); step(2.2);
    emit('pointerdown', 2.3); step(2.3);
    emit('lostpointercapture', 2.4); step(2.4);
    step(2.5, { hidden: true }); step(2.6, { reducedMotion: true }); step(3);
    prepared.reset(); bare.reset(); compare();
    await prepared.equip(FIXTURES[4]);
    assert.equal(prepared.mounts.size, 1, 'default research wardrobe behavior is preserved');
  } finally { pool.dispose(); }
  assertReleased(pool);
});

test('bare actors retain exactly fewer accounted template bytes and reject invalid modes before body I/O', async () => {
  const pool = new FoundationPool({ maxActors: 1 });
  const prepared = await pool.create();
  const templateBytes = prepared.bindings.residentBytes;
  const preparedBytes = pool.diagnostics().budget.claimedBytes;
  prepared.dispose(); assertReleased(pool);
  const bare = await pool.create({ equipmentMode: 'bare' });
  assert.equal(preparedBytes - pool.diagnostics().budget.claimedBytes, templateBytes);
  bare.dispose(); assertReleased(pool);
  await assert.rejects(pool.create({ equipmentMode: 'lazy' }), /Equipment mode/);
  assertReleased(pool); pool.dispose();
});

test('bare actor tail load failure releases body, surface and cache claims', async () => {
  let bindingCalls = 0;
  const runtime = createFoundationRuntime({ createBody, createHybridSource, revised, loadResearchContactEvidence,
    loadGLB: async () => { throw new Error('tail failed'); },
    createD2BindingProvider: async () => { bindingCalls++; throw new Error('unused bindings'); }
  });
  const pool = new runtime.FoundationPool();
  await assert.rejects(pool.create({ equipmentMode: 'bare' }), /tail failed/);
  assert.equal(bindingCalls, 0); assertReleased(pool); pool.dispose();
});

test('pool disposal while a bare tail loads rejects the late actor and releases its resources', async () => {
  let resolveTail, enterTail;
  const entered = new Promise(resolve => { enterTail = resolve; });
  const runtime = createFoundationRuntime({ createBody, createHybridSource, revised, loadResearchContactEvidence,
    loadGLB: path => new Promise(resolve => { resolveTail = () => resolve(loadGLB(path)); enterTail(); }),
    createD2BindingProvider: async () => { throw new Error('unused bindings'); }
  });
  const pool = new runtime.FoundationPool();
  const pending = pool.create({ equipmentMode: 'bare' });
  const rejected = assert.rejects(pending, /Reservation no longer live|Pool disposed/);
  await entered; pool.dispose(); resolveTail(); await rejected; assertReleased(pool);
});

test('bare foundation forwards event-matched DIP motion to its sole body owner without changing ray placement', async () => {
  let motion = { x: -1000, y: 400 }, calls = 0;
  const pool = new FoundationPool({ maxActors: 1 });
  try {
    const actor = await pool.create({ equipmentMode: 'bare', readMotionPoint: () => { calls++; return motion; } });
    const p = target(actor);
    actor.f.emit('pointerdown', .01, p); actor.step(.01);
    motion = { x: -980, y: 390 };
    actor.f.emit('pointermove', .08, p); actor.step(.08);
    assert.equal(actor.f.h.state.mode, 'drag');
    actor.step(.18); assert.equal(calls, 2, 'the single frame owner never resamples pointer motion');
    actor.step(.2, { hidden: true });
    assert.equal(actor.f.h.state.pointerId, null); assert.equal(actor.f.target.captured.size, 0);
    assert.equal(pool.diagnostics().actors, 1);
  } finally { pool.dispose(); }
  assertReleased(pool);
});
