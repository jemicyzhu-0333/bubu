import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as T from 'three';
import R from '@dimforge/rapier3d-compat';
import { resolveCapeAttachment } from './attachment-profile.mjs';
import { createPipingCollisionVolume } from './piping-collision-volume.mjs';
import { createSharedSurfaceCloth, SHARED_SURFACE_UNITS_PER_MODEL_UNIT as units } from './shared-surface-cloth.mjs';

const run = promisify(execFile);
const read = name => JSON.parse(fs.readFileSync(new URL(name, import.meta.url)));

test('common native skin preserves actual source surfaces and small material-point response', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'bubu-common-skin-'));
  const parts = [];
  let world, candidate;
  try {
    const output = path.join(temporary, 'cage.json');
    await run('python3', [fileURLToPath(new URL('./author-shared-surface-cage.py', import.meta.url)), '--output', output], {
      timeout: 30000, env: {...process.env, OPENBLAS_NUM_THREADS: '1', OMP_NUM_THREADS: '1', PYTHONDONTWRITEBYTECODE: '1'},
    });
    const data = JSON.parse(fs.readFileSync(output));
    const coarseBytes = fs.readFileSync(new URL('./cape-coarse.json', import.meta.url));
    const coarse = JSON.parse(coarseBytes), pins = [...resolveCapeAttachment(coarseBytes).pins];
    const frozen = read('../../integration/diagnostics/contact-contract-20261019/frozen-cape.json');
    for (const part of frozen.parts) {
      const geometry = new T.BufferGeometry().setAttribute('position', new T.Float32BufferAttribute(part.positions, 3));
      geometry.setIndex(part.indices);
      parts.push({name: part.name, geometry});
    }
    assert.equal(data.positions.length / 3, 1983);
    assert.equal(data.cells.length / 4, 3760);
    assert.equal(data.pins.length, 51);
    assert.equal(data.weights, undefined, 'No stale pre-refinement binding');
    assert.equal(data.cellSelections, undefined);
    const defaultOutput=path.join(temporary,'default-cadence');
    await run(process.execPath,[fileURLToPath(new URL('./endpoint-probe.mjs',import.meta.url)),
      '--trajectory','--convex-hands','--shared-surface-cage',output,
      '--local-body-proxy',fileURLToPath(new URL('./fixtures/wire-local-body-proxy-v2.json',import.meta.url)),
      '--constraint-pgs','12','--frames','1','--output',defaultOutput],{timeout:60000});
    const cadence=JSON.parse(fs.readFileSync(path.join(defaultOutput,'endpoint-cloth.json')));
    assert.equal(cadence.sampleHz,120);
    assert.equal(cadence.collisionSkin.particleCentroids,false,'The rejected attachment comparison stays off');
    assert.equal(cadence.collisionSkin.coupledContactStiffness,false,'A locally improved contact is not full-path admission');
    assert.equal(cadence.collisionSkin.contactStiffening,4);
    assert.equal(cadence.accepted,false);assert.equal(cadence.reachedActionEndpoint,false);
    const before = parts.map(part => Array.from(part.geometry.attributes.position.array));
    await R.init();
    world = new R.World({x: 0, y: 0, z: 0});
    assert.throws(() => createSharedSurfaceCloth(R, world, data, parts, coarse, pins), /units must match/);
    world.integrationParameters.lengthUnit = units;
    world.timestep = 1 / 240;
    const invalid = structuredClone(data);
    invalid.sourceParts.pop();
    assert.throws(() => createSharedSurfaceCloth(R, world, invalid, parts, coarse, pins));
    candidate = createSharedSurfaceCloth(R, world, data, parts, coarse, pins, {particleCentroids:true,coupledContactStiffness:true});
    assert.equal(candidate.skin.certificate.coupledContactStiffness,true);
    assert(world.integrationParameters.softBodiesContactStiffening*30>=candidate.skin.certificate.maximumAxialFrequency);
    assert.equal(candidate.skin.certificate.centroidConstraints,201);
    assert.equal(candidate.skin.certificate.particleAttachments,172);
    assert.equal(candidate.skin.certificate.joints,29);
    assert.equal(candidate.cloth.numAttachments(),172);
    assert.equal(candidate.cloth.numCells(),3760);
    const source = candidate.skin.skinPositions;
    assert(Math.max(...candidate.readRendered().map((value, i) => Math.abs(value - source[i]))) < 1e-7);
    assert.equal(candidate.cloth.meshCollisionEnabled(0), false, 'The cage boundary is not collision geometry');
    assert.equal(candidate.skin.certificate.productionAccepted, false);
    world.gravity = {x: 0, y: -9.81 * units, z: 0};
    for (let i = 0; i < 4; i++) world.step();
    const displayed = candidate.readRendered();
    for (const range of candidate.skin.ranges) {
      const native = candidate.skin.certificate.nativeParts.find(part => part.name === range.name);
      assert(candidate.cloth.meshCollisionEnabled(native.mesh));
      assert.equal(candidate.cloth.isMeshOriented(native.mesh),range.name!=='cape_cloth');
      const values = candidate.cloth.meshVertices(native.mesh);
      const original = parts.find(part => part.name === range.name).geometry;
      const map = range.name === 'cape_cloth' ? null : createPipingCollisionVolume(original).renderVertexMap;
      for (let i = 0; i < range.count; i++) for (let k = 0; k < 3; k++) {
        assert.equal(displayed[(range.start + i) * 3 + k], Math.fround(values[(map?.[i] ?? i) * 3 + k] / units));
      }
    }
    assert.deepEqual(parts.map(part => Array.from(part.geometry.attributes.position.array)), before);
    assert(Math.abs(candidate.skin.masses.reduce((a, b) => a + b, 0) - .444) < 1e-6);
    candidate.dispose(); candidate.dispose();
    assert.throws(() => candidate.readParticles(), /disposed/);
    assert.throws(() => candidate.readRendered(), /disposed/);
    world.free(); world = null;

    // These three real inserted points were ignored by native skin embedding
    // at the source scale. Moving one must move its actual skin vertex too.
    const clothSource = data.sourceParts.find(part => part.name === 'cape_cloth');
    world = new R.World({x: 0, y: 0, z: 0});
    world.integrationParameters.lengthUnit = units;
    world.timestep = 1 / 240;
    const native = world.createSoftBody(new R.SoftBodyDesc(data.positions.map(value => value * units))
      .setCells(data.cells).setPinnedParticles(Array.from({length: data.positions.length / 3}, (_, i) => i))
      .setParticleMass(.001).setParticleRadius(0).setSelfContacts(false).setOriented(false)
      .setSkin(clothSource.positions.map(value => value * units), clothSource.indices).setSkinCollision(true));
    for (const [name, section, vertex] of [
      ['cape_front_edge_0', 7, 7], ['cape_front_edge_0', 8, 8], ['cape_front_edge_1', 7, 3047],
    ]) {
      const id = data.fronts[name].centers[section];
      const original = native.particlePosition(id), target = {...original, z: original.z + .001 * units};
      native.setParticlePosition(id, target); world.step();
      const actual = native.meshVertices(0).slice(vertex * 3, vertex * 3 + 3);
      assert(Math.hypot(actual[0] - target.x, actual[1] - target.y, actual[2] - target.z) / units < 1e-7);
      native.setParticlePosition(id, original);
    }
  } finally {
    candidate?.dispose(); world?.free();
    for (const part of parts) part.geometry.dispose();
    fs.rmSync(temporary, {recursive: true, force: true});
  }
});
