// Reconstruct rest edges independently; no physics trajectory is rerun.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const [root, input, output] = process.argv.slice(2);
assert(root && input && output && !fs.existsSync(output));
const T = await import(pathToFileURL(path.join(root, 'node_modules/three/build/three.module.js')));
const { default: R } = await import(pathToFileURL(path.join(root, 'node_modules/@dimforge/rapier3d-compat/dist/rapier.mjs')));
const folder = path.join(root, 'animation-foundation-v1/secondary-motion/cloth-probe');
const { validateCollisionSkin } = await import(pathToFileURL(path.join(folder, 'collision-skin.mjs')));
const { createRegionalCollisionSkin } = await import(pathToFileURL(path.join(folder, 'regional-collision-skin.mjs')));
const read = p => JSON.parse(fs.readFileSync(p));
const coarse = read(path.join(folder, 'cape-coarse.json'));
const binding = read(path.join(folder, 'cape-binding.json'));
const frozen = read(path.join(folder, '../../integration/diagnostics/contact-contract-20261019/frozen-cape.json'));
const parts = frozen.parts.map(p => ({ name: p.name, geometry: new T.BufferGeometry()
  .setAttribute('position', new T.Float32BufferAttribute(p.positions, 3)).setIndex(p.indices) }));
let world, region;
try {
  const pins = coarse.pins.filter(p => ![3,6,9,13,17,422,427,431,435,438].includes(p));
  const skin = validateCollisionSkin(read(path.join(input, '../collision-skin.json')), parts, coarse, pins);
  await R.init(); world = new R.World({ x: 0, y: 0, z: 0 });
  region = createRegionalCollisionSkin(R, world, skin, parts, coarse, binding, pins, { thinCloth: true, meshScaledMaterial: true });
  const saved = read(path.join(input, 'failed-cage-particles.json'));
  assert.equal(saved.length, region.skin.positions.length);
  const rest = region.skin.positions, edges = region.skin.edges;
  let maximum = -Infinity, witness;
  for (let i = 0; i < edges.length; i += 2) {
    const a = edges[i], b = edges[i+1];
    const restLength = Math.hypot(...[0,1,2].map(k => rest[a*3+k]-rest[b*3+k]));
    const ratio = Math.hypot(...[0,1,2].map(k => saved[a*3+k]-saved[b*3+k])) / restLength;
    if (ratio > maximum) { maximum = ratio; witness = { a, b, restLength, ratio }; }
  }
  const report = read(path.join(input, 'endpoint-cloth.json'));
  assert(Math.abs(maximum-report.rows.at(-1).cageStrain.max) < 1e-10);
  assert(maximum > 1.2);
  assert(witness.a < coarse.positions.length/3 && witness.b >= coarse.positions.length/3);
  fs.writeFileSync(output, JSON.stringify({ status: 'completed', accepted: false,
    scope: 'Independently reconstructed rest edge metric for saved cloth-to-piping failure; not a full trajectory or performance pass',
    time: report.stoppedAt.time, maximum, witness, maximumAllowed: 1.2, failureReproduced: true }, null, 2));
} finally { region?.dispose(); world?.free(); for (const p of parts) p.geometry.dispose(); }
