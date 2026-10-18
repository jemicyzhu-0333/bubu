import R from "@dimforge/rapier3d-compat";
import { Triangle, Vector3 } from "three";
import assert from "node:assert/strict";
import fs from "node:fs";
import { performance } from "node:perf_hooks";
await R.init();
const world = new R.World({ x: 0, y: -9.81, z: 0 });
world.timestep = 1 / 60;
const n = 10,
  pins = Array.from({ length: n }, (_, i) => i);
let report;
try {
  const desc = R.SoftBodyDesc.cloth(
    { x: -0.45, y: 1.5, z: 0 },
    { x: 0.1, y: 0, z: 0 },
    { x: 0, y: -0.1, z: 0 },
    n,
    n,
  )
    .setPinnedParticles(pins)
    .setSoftness(30, 1)
    .setParticleMass(0.015)
    .setParticleRadius(0.015)
    .setSelfContacts(false)
    .setSurfaceCollider(R.ColliderDesc.ball(0.015).setFriction(0.3));
  const cloth = world.createSoftBody(desc);
  const obstacle = world.createRigidBody(
    R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 0.95, -0.5),
  );
  world.createCollider(R.ColliderDesc.ball(0.22), obstacle);
  assert.equal(cloth.numParticles(), 100);
  const rest = pins.map((i) => cloth.particlePosition(i));
  const times = [];
  let pinError = 0,
    maxPenetration = 0,
    maxSurfacePenetration = 0,
    maxAbs = 0;
  const triangle = new Triangle(),
    center = new Vector3(),
    closest = new Vector3();
  const meshes = Array.from({ length: cloth.numMeshes() }, (_, i) => ({
    index: i,
    triangles: cloth.meshIndices(i),
  }));
  assert(meshes.length > 0);
  for (let frame = 0; frame < 600; frame++) {
    const t = frame / 60,
      shift = 0.08 * Math.sin(t * 1.3);
    for (let i = 0; i < pins.length; i++)
      cloth.setParticleKinematicTarget(pins[i], {
        x: rest[i].x + shift,
        y: rest[i].y,
        z: rest[i].z,
      });
    const z = -0.5 + 0.65 * Math.max(0, Math.sin(t * 0.7));
    obstacle.setNextKinematicTranslation({ x: 0, y: 0.95, z });
    const start = performance.now();
    world.step();
    times.push(performance.now() - start);
    const values = cloth.particlePositions();
    assert(values.every(Number.isFinite));
    for (const v of values) maxAbs = Math.max(maxAbs, Math.abs(v));
    for (let i = 0; i < pins.length; i++) {
      const p = cloth.particlePosition(pins[i]);
      pinError = Math.max(
        pinError,
        Math.hypot(p.x - rest[i].x - shift, p.y - rest[i].y, p.z - rest[i].z),
      );
    }
    center.set(0, 0.95, z);
    for (const mesh of meshes) {
      const v = cloth.meshVertices(mesh.index),
        ix = mesh.triangles;
      for (let j = 0; j < ix.length; j += 3) {
        triangle.a.fromArray(v, ix[j] * 3);
        triangle.b.fromArray(v, ix[j + 1] * 3);
        triangle.c.fromArray(v, ix[j + 2] * 3);
        triangle.closestPointToPoint(center, closest);
        maxSurfacePenetration = Math.max(
          maxSurfacePenetration,
          0.22 - closest.distanceTo(center),
        );
      }
    }
    for (let i = n; i < 100; i++) {
      const p = cloth.particlePosition(i);
      maxPenetration = Math.max(
        maxPenetration,
        0.22 - Math.hypot(p.x, p.y - 0.95, p.z - z),
      );
    }
  }
  times.sort((a, b) => a - b);
  report = {
    scope:
      "Isolated Rapier 0.21 cloth API feasibility, synthetic 100-particle vertical sheet, moving pins and kinematic sphere. Not garment admission, continuous contact proof or GPU test.",
    frames: 600,
    particles: 100,
    pinMaxError: pinError,
    maxObservedParticleSpherePenetration: maxPenetration,
    maxObservedSurfaceSpherePenetration: maxSurfacePenetration,
    maxAbsPosition: maxAbs,
    stepMs: { p50: times[300], p95: times[570], max: times.at(-1) },
  };
  assert(maxAbs < 10);
  assert(pinError < 1e-5, "Kinematic pins drifted");
  assert(maxSurfacePenetration < 1e-4, "Sampled surface penetrated sphere");
} finally {
  world.free();
}
fs.writeFileSync(
  new URL("./evidence.json", import.meta.url),
  JSON.stringify(report, null, 2),
);
console.log(report);
