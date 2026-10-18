/** Isolated cloth research. Never imported by FoundationActor. */
import R from "@dimforge/rapier3d-compat";
import * as T from "three";
import { MeshBVH } from "three-mesh-bvh";
import fs from "node:fs";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { createHash, randomUUID } from "node:crypto";
import {
  loadGLB,
  disposeAsset,
  hybrid,
} from "../../integration/asset-fixtures.mjs";
import { cleanupOwned } from "../../integration/cleanup-owned.mjs";
import { createThinSurfaceMapper } from "./thin-surface-mapper.mjs";
import { bakeAccessory, geometryIdentity } from "../asset-admission.mjs";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const output = new URL("./cape-dynamic-evidence.json", import.meta.url);
const runId = randomUUID();
const write = (value) =>
  fs.writeFileSync(output, JSON.stringify({ runId, ...value }, null, 2));
write({ status: "running", accepted: false });
async function run() {
  const frames = Number(
    process.argv.find((x) => x.startsWith("--frames="))?.split("=")[1] ?? 120,
  );
  assert(Number.isSafeInteger(frames) && frames >= 1 && frames <= 600);
  const skipContact = process.argv.includes("--skip-contact");
  const colliderType =
    process.argv.find((x) => x.startsWith("--body-collider="))?.split("=")[1] ??
    "trimesh";
  assert(["none", "trimesh", "convex"].includes(colliderType));
  const rawCoarse = fs.readFileSync(
    new URL("./cape-coarse.json", import.meta.url),
  );
  const coarse = JSON.parse(rawCoarse),
    binding = JSON.parse(
      fs.readFileSync(new URL("./cape-binding.json", import.meta.url)),
    );
  const modelURL = new URL(
      "../../../wearable-approved-round5/accessory-expansion/models/07-cape.glb",
      import.meta.url,
    ),
    modelSHA = sha(fs.readFileSync(modelURL));
  assert.equal(
    modelSHA,
    "e29010956b989a60e196472b2206e6c397b34f12f3b7092d67f53f189c128e21",
  );
  assert.equal(modelSHA, binding.sourceModelSHA256);
  assert.equal(sha(rawCoarse), binding.simulationSHA256);
  assert.equal(
    sha(fs.readFileSync(hybrid)),
    "52a080d81606fbe92e9cd71593bd703f356eb50a0e1c74ccc34547a0db308e67",
  );
  assert.equal(coarse.schema, "bubu-cloth-surface/1");
  assert.equal(binding.schema, "bubu-thin-surface-binding/1");
  const count = coarse.positions.length / 3;
  assert(Number.isInteger(count) && count >= 3 && count <= 2048);
  assert(coarse.positions.every((v) => Number.isFinite(v) && Math.abs(v) < 10));
  assert(coarse.indices.length % 3 === 0 && coarse.indices.length <= 4096 * 3);
  assert(
    coarse.indices.every((i) => Number.isInteger(i) && i >= 0 && i < count),
  );
  assert(
    coarse.pins.length <= count &&
      new Set(coarse.pins).size === coarse.pins.length &&
      coarse.pins.every((i) => Number.isInteger(i) && i >= 0 && i < count),
  );
  const edges = new Map(),
    dihedrals = [];
  for (let i = 0; i < coarse.indices.length; i += 3) {
    const t = coarse.indices.slice(i, i + 3);
    assert(new Set(t).size === 3);
    for (let k = 0; k < 3; k++) {
      const a = t[k],
        b = t[(k + 1) % 3],
        c = t[(k + 2) % 3],
        key = [Math.min(a, b), Math.max(a, b)].join(",");
      if (edges.has(key)) {
        const old = edges.get(key);
        assert(!old.shared, "Non-manifold cloth");
        dihedrals.push(old.a, old.b, old.c, c);
        old.shared = true;
      } else edges.set(key, { a, b, c, shared: false });
    }
  }
  const edgeList = [...edges.values()].map((e) => ({
    ...e,
    rest: Math.hypot(
      ...[0, 1, 2].map(
        (k) => coarse.positions[e.a * 3 + k] - coarse.positions[e.b * 3 + k],
      ),
    ),
  }));
  assert(edgeList.every((e) => e.rest > 1e-8));
  let mapper;
  let world,
    bodyAsset,
    capeAsset,
    parts = [];
  const report = {
    scope:
      "Actual cape research with rigidly translated body; not drag/petting/tea or garment admission",
    accepted: false,
    inputHashes: { model: modelSHA, simulation: sha(rawCoarse) },
    moduleHashes: Object.fromEntries(
      [
        "./run-cape.mjs",
        "./thin-surface-mapper.mjs",
        "../asset-admission.mjs",
        "../../integration/asset-fixtures.mjs",
        "../../../package-lock.json",
      ].map((name) => [
        name,
        sha(fs.readFileSync(new URL(name, import.meta.url))),
      ]),
    ),
    particles: count,
    renderVertices: binding.vertices,
    frames,
    contactSkipped: skipContact,
    bodyCollider: colliderType,
    contacts: [],
    stepMs: [],
    mapMs: [],
    maxPinError: 0,
    maxStretch: 1,
    minStretch: 1,
  };
  const inverseShift = new T.Matrix4();
  try {
    bodyAsset = await loadGLB(hybrid);
    bodyAsset.updateMatrixWorld(true);
    const bodyMesh = bodyAsset.getObjectByName("Bubu_body");
    assert(
      bodyMesh.matrixWorld.equals(new T.Matrix4()),
      "Expected source-accessor coordinates",
    );
    capeAsset = await loadGLB(modelURL);
    parts = bakeAccessory(capeAsset);
    assert.deepEqual(
      new Set(parts.map((p) => p.name)),
      new Set([...binding.bindings.map((b) => b.name), ...binding.fixedParts]),
    );
    const meshes = [];
    for (const def of binding.bindings) {
      const part = parts.find((p) => p.name === def.name);
      assert(part);
      assert.equal(def.geometrySHA256, await geometryIdentity(part.geometry));
      assert.equal(def.vertices, part.geometry.attributes.position.count);
      assert.equal(def.records.length, def.vertices * 7);
      for (let i = 0; i < def.vertices; i++) {
        const row = def.records.slice(i * 7, i * 7 + 7);
        assert(row.every(Number.isFinite));
        assert(
          Number.isInteger(row[0]) &&
            row[0] >= 0 &&
            row[0] < coarse.indices.length / 3,
        );
        assert(row.slice(1, 4).every((w) => w >= -1e-6 && w <= 1 + 1e-6));
        assert(Math.abs(row[1] + row[2] + row[3] - 1) < 1e-5);
        assert(Math.hypot(...row.slice(4)) < 0.08);
      }
      meshes.push({
        def,
        geometry: part.geometry,
        bvh: new MeshBVH(part.geometry, { indirect: true }),
      });
    }
    mapper = createThinSurfaceMapper({
      indices: coarse.indices,
      vertexCount: count,
    });
    for (const { def, geometry } of meshes)
      mapper.bind(def.records, geometry.attributes.position);
    console.log("stage: validated inputs");
    await R.init();
    world = new R.World({ x: 0, y: -9.81, z: 0 });
    world.timestep = 1 / 60;
    const bodyGeometry = bodyMesh.geometry,
      bodyBVH = new MeshBVH(bodyGeometry, { indirect: true });
    const body = world.createRigidBody(
      R.RigidBodyDesc.kinematicPositionBased(),
    );
    if (colliderType !== "none") {
      const collider =
        colliderType === "convex"
          ? R.ColliderDesc.convexHull(
              new Float32Array(bodyGeometry.attributes.position.array),
            )
          : R.ColliderDesc.trimesh(
              new Float32Array(bodyGeometry.attributes.position.array),
              new Uint32Array(bodyGeometry.index.array),
            );
      assert(collider, "Body hull construction failed");
      world.createCollider(collider, body);
    }
    const desc = new R.SoftBodyDesc(coarse.positions)
      .setEdges(edgeList.flatMap((e) => [e.a, e.b]))
      .setDihedrals(dihedrals)
      .setSurface(coarse.indices)
      .setPinnedParticles(coarse.pins)
      .setSoftness(30, 1)
      .setParticleMass(0.001)
      .setParticleRadius(0.003)
      .setSelfContacts(false)
      .setOriented(false)
      .setSurfaceCollider(R.ColliderDesc.ball(0.003).setFriction(0.3));
    const cloth = world.createSoftBody(desc);
    console.log("stage: cloth created");
    const contactFrames = new Set([
      0,
      Math.floor(frames / 4),
      Math.floor(frames / 2),
      frames - 1,
    ]);
    for (let frame = 0; frame < frames; frame++) {
      const time = frame / 60,
        shift = 0.03 * Math.sin(time * 1.5);
      body.setNextKinematicTranslation({ x: shift, y: 0, z: 0 });
      for (const i of coarse.pins)
        cloth.setParticleKinematicTarget(i, {
          x: coarse.positions[i * 3] + shift,
          y: coarse.positions[i * 3 + 1],
          z: coarse.positions[i * 3 + 2],
        });
      let start = performance.now();
      world.step();
      report.stepMs.push(performance.now() - start);
      const vertices = cloth.particlePositions();
      assert(vertices.every((v) => Number.isFinite(v) && Math.abs(v) < 10));
      for (const i of coarse.pins)
        report.maxPinError = Math.max(
          report.maxPinError,
          Math.hypot(
            vertices[i * 3] - coarse.positions[i * 3] - shift,
            vertices[i * 3 + 1] - coarse.positions[i * 3 + 1],
            vertices[i * 3 + 2] - coarse.positions[i * 3 + 2],
          ),
        );
      for (const e of edgeList) {
        const length = Math.hypot(
          ...[0, 1, 2].map(
            (k) => vertices[e.a * 3 + k] - vertices[e.b * 3 + k],
          ),
        );
        report.maxStretch = Math.max(report.maxStretch, length / e.rest);
        report.minStretch = Math.min(report.minStretch, length / e.rest);
      }
      start = performance.now();
      mapper.prepare(vertices);
      mapper.apply();
      for (const { geometry } of meshes) geometry.computeVertexNormals();
      report.mapMs.push(performance.now() - start);
      if (frame % 30 === 0) console.log("stage: mapped frame", frame);
      if (!skipContact && contactFrames.has(frame)) {
        const intersections = {};
        inverseShift.makeTranslation(-shift, 0, 0);
        for (const { def, bvh } of meshes) {
          bvh.refit();
          intersections[def.name] = bodyBVH.bvhcast(bvh, inverseShift, {
            intersectsTriangles: (x, y) => x.intersectsTriangle(y),
          });
        }
        report.contacts.push({ frame, intersections });
      }
    }
    assert(report.maxPinError < 1e-5);
    for (const name of ["stepMs", "mapMs"]) {
      const values = report[name].sort((a, b) => a - b);
      report[name] = {
        p50: values[Math.floor(values.length * 0.5)],
        p95: values[Math.floor(values.length * 0.95)],
        max: values.at(-1),
      };
    }
    report.anySampledRenderBodyIntersection = skipContact
      ? null
      : report.contacts.some((x) =>
          Object.values(x.intersections).some(Boolean),
        );
    return report;
  } finally {
    cleanupOwned(
      [
        () => mapper?.dispose(),
        () => world?.free(),
        ...parts.map((p) => () => p.geometry.dispose()),
        () => bodyAsset && disposeAsset(bodyAsset),
        () => capeAsset && disposeAsset(capeAsset),
      ],
      "Cloth probe cleanup",
    );
  }
}
try {
  const report = await run();
  write({ status: "completed", ...report });
  console.log(report);
} catch (error) {
  write({ status: "failed", accepted: false, error: error.message });
  throw error;
}
