import test from 'node:test';
import assert from 'node:assert/strict';
import {createClothStabilityMeasure} from './cloth-stability.mjs';
import {createEdgeStrainMeasure} from './edge-strain.mjs';

const rest = [0,0,0, 1,0,0, 0,1,0, 0,0,1];
const cells = [0,1,2,3], mass = [1,2,3,4], gravity = {x:0,y:-9.81,z:0};
test('orientation detects reflection even when every physical edge retains its length', () => {
  const measure = createClothStabilityMeasure(rest, cells, mass);
  const reflected = rest.map((v,i) => i%3===0 ? -v : v);
  const edges = createEdgeStrainMeasure(rest, [0,1,0,2,0,3,1,2,1,3,2,3], 2)(reflected);
  assert.equal(edges.min, 1); assert.equal(edges.max, 1);
  const result = measure({positions:reflected, velocities:new Float64Array(12), gravity});
  assert.equal(result.invertedCells, 1); assert.equal(result.minimumSignedVolumeRatio, -1);
  assert.equal(result.collapsedCells, 0);
  const flat = rest.slice(); flat[11] = 0;
  assert.equal(measure({positions:flat, velocities:new Float64Array(12), gravity}).collapsedCells, 1);
});
test('energy uses masses and model-unit velocity, and immutable rest data survives callers', () => {
  const source = rest.slice(), topology = cells.slice(), masses = mass.slice();
  const measure = createClothStabilityMeasure(source, topology, masses);
  source.length=0; topology.fill(0); masses.fill(0);
  const moved = rest.map((v,i) => i%3===1 ? v+2 : v);
  const velocities = Float64Array.from({length:12}, (_,i) => i%3===0 ? 3 : 0);
  const result = measure({positions:moved, velocities, gravity});
  assert.equal(result.kineticEnergy, 45);
  assert(Math.abs(result.gravitationalDelta-196.2)<1e-12);
  assert.equal(result.maximumSpeed, 3); assert.equal(result.minimumSignedVolumeRatio, 1);
  assert.equal(result.invertedCells, 0);
  velocities[2]=NaN;
  assert.throws(()=>measure({positions:moved,velocities,gravity}),/Finite matching/);
});
