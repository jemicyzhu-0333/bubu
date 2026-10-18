import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { parseArgs } from "node:util";
import { pathToFileURL, fileURLToPath } from "node:url";

import { createSplitLimbAdapter } from "../runtime/split-limb-adapter.mjs";
import { createContractCheckedMixedBindingAdapter } from "../runtime/mixed-binding-contract.mjs";
const { values: args } = parseArgs({
  options: {
    "research-root": { type: "string" },
    asset: { type: "string" },
    manifest: { type: "string" },
    output: { type: "string" },
    scenario: { type: "string" },
    "full-export": { type: "boolean" },
    "windows-only": { type: "boolean" },
    "numeric-only": { type: "boolean" },
    "lifecycle-only": { type: "boolean" },
  },
});
if (args["full-export"] && (args["numeric-only"] || args["windows-only"]))
  throw new TypeError("Choose full export, windows only, or numeric only");
const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const researchRoot = path.resolve(
  args["research-root"] ??
    process.env.RESEARCH_ROOT ??
    "research/animation-0.1.0",
);
const asset = path.resolve(
  args.asset ??
    process.env.ASSET_PATH ??
    path.join(packageRoot, "geometry/bubu-hybrid-binding.glb"),
);
const manifestPath = path.resolve(
  args.manifest ??
    process.env.BINDING_MANIFEST ??
    path.join(path.dirname(asset), "binding-manifest.json"),
);
const out = path.resolve(
  args.output ?? process.env.OUTPUT_ROOT ?? "integration-output",
);
const sourceGLB = path.join(
  researchRoot,
  "runtime-facepath05/fixtures/face-d2/asset.glb",
);
const { fixture } = await import(
  pathToFileURL(
    path.join(researchRoot, "petting-continuous-r2/tools/fixture.mjs"),
  )
);
const { N3_CAVITY_DELTA, N3_CAVITY_STRENGTH, n3CavityGate } = await import(
  pathToFileURL(
    path.join(researchRoot, "runtime-facepath05/src/n3-cavity-mask.mjs"),
  )
);
const numericOnly = !!args["numeric-only"];
const selectedScenarios = args["lifecycle-only"]
  ? []
  : (args.scenario ?? process.env.BUBU_SCENARIOS ?? "drag,longpress").split(
      ",",
    );
fs.mkdirSync(out, { recursive: true });
const bytes = fs.readFileSync(asset),
  hash = (b) => crypto.createHash("sha256").update(b).digest("hex");
const parts = (
  await new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    "",
  )
).scene;
const adapterKind = "mixed",
  fullExport = !numericOnly && !args["windows-only"];
if (!["static", "mixed"].includes(adapterKind))
  throw new TypeError("Unknown adapter");
const bindingContract =
  adapterKind === "mixed" ? JSON.parse(fs.readFileSync(manifestPath)) : null;
const sourceBytes = fs.readFileSync(sourceGLB);
const report = {
  adapterKind,
  fullExport,
  actualDOMHost: true,
  sourceSHA256: hash(sourceBytes),
  bindingManifestSHA256: bindingContract
    ? hash(fs.readFileSync(manifestPath))
    : null,
  asset,
  assetSHA256: hash(bytes),
  three: T.REVISION,
  scenarios: {},
  lifecycle: {},
  limitations: [
    "CPU world-space export, not GPU validation. Original pointer host and ground controller unchanged.",
  ],
};
const fps = 30;

function rigid(m) {
  const e = m.elements;
  assert.ok(e.every(Number.isFinite));
  assert.ok(Math.abs(m.determinant() - 1) < 1e-5);
  for (let a = 0; a < 3; a++)
    for (let b = a; b < 3; b++) {
      let dot = 0;
      for (let k = 0; k < 3; k++) dot += e[a * 4 + k] * e[b * 4 + k];
      assert.ok(Math.abs(dot - (a === b ? 1 : 0)) < 1e-5);
    }
}
function attach(f) {
  const options = {
    THREE: T,
    sourceSkin: f.h.body.skin,
    parts,
    assertSourceCurrent: () => f.h.owner.assertCurrent(),
  };
  return adapterKind === "mixed"
    ? createContractCheckedMixedBindingAdapter({
        ...options,
        contract: bindingContract,
        admittedSourceSHA256: hash(sourceBytes),
        candidateSHA256: hash(bytes),
      })
    : createSplitLimbAdapter(options);
}
function minFoot(owner) {
  const p = new T.Vector3();
  return Object.fromEntries(
    owner.root.children
      .filter((m) => m.name.includes("foot"))
      .map((m) => {
        let min = Infinity;
        for (let i = 0; i < m.geometry.attributes.position.count; i++) {
          m.getVertexPosition(i, p).applyMatrix4(m.matrixWorld);
          min = Math.min(min, p.y);
        }
        return [m.name, min];
      }),
  );
}
function resourceZero(stats) {
  for (const k of [
    "actors",
    "vertices",
    "nodes",
    "deformedVertices",
    "sourceBytes",
    "decodedArrayBytes",
    "clipKeyScalars",
    "active",
    "pending",
  ])
    assert.equal(stats[k], 0, k);
  assert.equal(stats.cache.retainedReferences, 0);
}
function exportFrame(root, dir, index, time, state, topology) {
  root.updateMatrixWorld(true);
  const meshes = [];
  const p = new T.Vector3(),
    n = new T.Vector3(),
    base = new T.Vector3(),
    delta = new T.Vector3(),
    v4 = new T.Vector4();
  root.traverseVisible((mesh) => {
    if (!mesh.isMesh) return;
    const g = mesh.geometry,
      count = g.attributes.position.count;
    const positions = new Float32Array(count * 3),
      normals = g.attributes.normal ? new Float32Array(count * 3) : null;
    const normalMatrix = new T.Matrix3().getNormalMatrix(mesh.matrixWorld);
    for (let i = 0; i < count; i++) {
      mesh.getVertexPosition(i, p).applyMatrix4(mesh.matrixWorld);
      assert.ok(p.toArray().every(Number.isFinite));
      p.toArray(positions, i * 3);
      if (normals) {
        base.fromBufferAttribute(g.attributes.normal, i);
        n.copy(base);
        for (let j = 0; j < (g.morphAttributes.normal?.length ?? 0); j++) {
          delta.fromBufferAttribute(g.morphAttributes.normal[j], i);
          if (!g.morphTargetsRelative) delta.sub(base);
          n.addScaledVector(delta, mesh.morphTargetInfluences?.[j] ?? 0);
        }
        if (mesh.isSkinnedMesh) {
          v4.set(n.x, n.y, n.z, 0);
          mesh.applyBoneTransform(i, v4);
          n.set(v4.x, v4.y, v4.z);
        }
        n.applyMatrix3(normalMatrix).normalize();
        n.toArray(normals, i * 3);
      }
    }
    if (!topology[mesh.name]) {
      const c = g.attributes.color;
      topology[mesh.name] = {
        name: mesh.name,
        vertexCount: count,
        indices: Array.from(
          g.index?.array ?? Array.from({ length: count }, (_, i) => i),
        ),
        colors: c
          ? Array.from({ length: c.count }, (_, i) => [
              c.getX(i),
              c.getY(i),
              c.getZ(i),
              c.itemSize > 3 ? c.getW(i) : 1,
            ]).flat()
          : null,
        materialColor: mesh.material.color?.toArray(),
        opacity: mesh.material.opacity,
      };
    }
    const prefix = `${String(index).padStart(4, "0")}-${mesh.name.replace(/[^a-z0-9_-]/gi, "_")}`;
    const positionsFile = path.join(dir, prefix + ".positions.bin");
    fs.writeFileSync(positionsFile, Buffer.from(positions.buffer));
    let normalsFile = null;
    if (normals) {
      normalsFile = path.join(dir, prefix + ".normals.bin");
      fs.writeFileSync(normalsFile, Buffer.from(normals.buffer));
    }
    let diffuseColorsFile = null;
    if (mesh.name === "A_mouth_ring") {
      const diffuse = new Float32Array(count * 3),
        mask = g.attributes.bubuD2CavityMask,
        gate = n3CavityGate(state.face.path, state.face.amount),
        baseColor = mesh.material.color.toArray(),
        color = g.attributes.color;
      for (let i = 0; i < count; i++)
        for (let c = 0; c < 3; c++)
          diffuse[i * 3 + c] =
            baseColor[c] * (color ? color.getComponent(i, c) : 1) +
            N3_CAVITY_DELTA[c] * N3_CAVITY_STRENGTH * gate * mask.getX(i);
      diffuseColorsFile = path.join(dir, prefix + ".diffuse.bin");
      fs.writeFileSync(diffuseColorsFile, Buffer.from(diffuse.buffer));
    }
    meshes.push({
      name: mesh.name,
      positionsFile,
      normalsFile,
      diffuseColorsFile,
      faceWeights: mesh.morphTargetInfluences
        ? Array.from(mesh.morphTargetInfluences)
        : [],
    });
  });
  assert.equal(meshes.length, 13, "five parts plus eight actual face meshes");
  assert.ok(!meshes.some((m) => m.name === "A_mochi_skin"));
  return {
    index,
    time,
    label: `${state.mode} / ${state.pet.phase} / ${state.face.path ?? "Basis"}`,
    mode: state.mode,
    phase: state.pet.phase,
    face: state.face,
    meshes,
  };
}
const smooth = (x) => {
  x = Math.max(0, Math.min(1, x));
  return x * x * (3 - 2 * x);
};
async function scenario(name) {
  const f = await fixture();
  let owner;
  const records = [],
    frames = [],
    topology = {},
    modes = new Set();
  const duration = name === "drag" ? 9 : 63;
  const windows =
    name === "drag"
      ? [
          [0, 1.5],
          [3, 4.5],
          [6, 7.5],
        ]
      : [
          [0, 2],
          [31.5, 33.5],
          [60, 63],
        ];
  const keys = new Set(
    name === "drag"
      ? [0, 30, 60, 90, 120, 150, 180, 210, 240, 270]
      : [0, 6, 30, 60, 120, 390, 510, 990, 1020, 1110, 1806, 1824, 1884, 1890],
  );
  let minimum = Infinity,
    maximumLift = -Infinity;
  const dir = path.join(out, name, "binary");
  fs.mkdirSync(dir, { recursive: true });
  try {
    owner = attach(f);
    const start = f.point(-0.2, 1.4);
    let point = { ...start };
    for (let i = 0; i <= duration * fps; i++) {
      const time = i / fps;
      if (i === 6) f.emit("pointerdown", time, start);
      if (name === "drag") {
        if (i >= 15 && i <= 120) {
          const u = smooth((time - 0.5) / 1.2);
          point = {
            clientX: start.clientX + 60 * u + 10 * Math.sin(time * 2) * u,
            clientY: start.clientY - 95 * u,
          };
          f.emit("pointermove", time, point);
        }
        if (i === 123) f.emit("pointerup", time, point);
      } else {
        if (time >= 6 && time <= 10) {
          const u =
            time < 8 ? smooth((time - 6) / 2) : 1 - smooth((time - 8) / 2);
          point = { clientX: start.clientX + 4 * u, clientY: start.clientY };
          f.emit("pointermove", time, point);
        }
        if (time >= 21 && time <= 25) {
          const u =
            time < 23 ? smooth((time - 21) / 2) : 1 - smooth((time - 23) / 2);
          point = {
            clientX: start.clientX - 3 * u,
            clientY: start.clientY - 1.5 * u,
          };
          f.emit("pointermove", time, point);
        }
        if (i === 1806) f.emit("pointerup", time, point);
      }
      const state = f.tick(time);
      owner.update();
      f.h.owner.assertCurrent();
      owner.root.children.forEach((m) => rigid(m.matrix));
      f.h.body.root.updateMatrixWorld(true);
      const feet = minFoot(owner);
      for (const y of Object.values(feet)) {
        minimum = Math.min(minimum, y);
        maximumLift = Math.max(maximumLift, y - f.h.body.initialGround);
      }
      modes.add(state.mode);
      records.push({
        ...state,
        splitFootMinY: feet,
        splitLocalMatrices: Object.fromEntries(
          owner.root.children.map((m) => [m.name, m.matrix.toArray()]),
        ),
      });
      if (
        !numericOnly &&
        (fullExport ||
          keys.has(i) ||
          windows.some(([a, b]) => time >= a && time <= b))
      )
        frames.push(exportFrame(f.h.body.root, dir, i, time, state, topology));
      if (i % 300 === 0) console.log(name, i, "/", duration * fps);
    }
    assert.equal(records.length, duration * fps + 1);
    if (fullExport && !numericOnly) assert.equal(frames.length, records.length);
    assert.ok(modes.has(name === "drag" ? "drag" : "petting"));
    assert.equal(records.at(-1).mode, "idle");
    report.scenarios[name] = {
      frames: records.length,
      exportedFrames: frames.length,
      modes: [...modes],
      minimumFootY: minimum,
      ground: f.h.body.initialGround,
      minimumFootRelativeGround: minimum - f.h.body.initialGround,
      maximumFootLift: maximumLift,
      finiteRigidLocalTransforms: true,
      rigidHands: true,
      nativeSkinBodyFeet: adapterKind === "mixed",
      sourceOwnerCurrent: true,
      groundPenetration: minimum < f.h.body.initialGround - 1e-5,
    };
  } catch (error) {
    report.scenarios[name] = {
      ...report.scenarios[name],
      error: error.stack,
      completedFrames: records.length,
    };
    throw error;
  } finally {
    owner?.dispose();
    f.h.dispose();
    report.scenarios[name] ??= {};
    report.scenarios[name].resources = f.h.pool.stats;
    resourceZero(f.h.pool.stats);
    fs.writeFileSync(
      path.join(out, name, "trajectory.json"),
      JSON.stringify(records),
    );
    fs.writeFileSync(
      path.join(out, name, "manifest.json"),
      JSON.stringify({
        fps,
        speed: 1,
        duration,
        windows,
        numericOnly,
        fullExport,
        actualDOMHost: true,
        adapterKind,
        asset,
        sourceGLB: sourceGLB,
        topology,
        frames,
      }),
    );
    fs.writeFileSync(
      path.join(out, "report.json"),
      JSON.stringify(report, null, 2),
    );
  }
}
async function lifecycle(name) {
  const f = await fixture();
  const owner = attach(f);
  let result;
  try {
    const p = f.point(-0.2, 1.4);
    f.emit("pointerdown", 0.1, p);
    f.tick(0.1);
    f.tick(0.6);
    owner.update();
    if (name === "cancel" || name === "lostcapture") {
      f.emit(
        name === "cancel" ? "pointercancel" : "lostpointercapture",
        0.7,
        p,
      );
      f.tick(0.7);
      owner.update();
      assert.equal(f.h.state.pointerId, null);
    } else if (name === "hidden") {
      f.at(0.7);
      f.doc.hidden = true;
      f.doc.emit("visibilitychange");
      assert.equal(f.h.state.pointerId, null);
      assert.equal(f.h.state.hidden, true);
      f.at(0.8);
      f.doc.hidden = false;
      f.doc.emit("visibilitychange");
      f.tick(0.9);
      owner.update();
      assert.equal(f.h.state.hidden, false);
    } else if (name === "repress") {
      f.emit("pointercancel", 0.7, p);
      f.tick(0.7);
      f.emit("pointerdown", 1, p);
      f.tick(1);
      f.tick(1.5);
      owner.update();
      assert.equal(f.h.state.pointerId, 1);
    } else if (name === "landing-regrab") {
      const moved = { clientX: p.clientX + 30, clientY: p.clientY - 60 };
      f.emit("pointermove", 0.7, moved);
      f.tick(0.7);
      f.tick(1.1);
      f.emit("pointerup", 1.2, moved);
      f.tick(1.2);
      let time = 1.2;
      while (f.h.state.drag.mode !== "settle" && time < 4) {
        time += 1 / 60;
        f.tick(time);
        owner.update();
      }
      assert.equal(f.h.state.drag.mode, "settle");
      const q = f.h.body.skin
        .localToWorld(new T.Vector3(-0.2, 1.4, 0))
        .project(f.camera);
      f.emit("pointerdown", time + 0.005, {
        clientX: (q.x + 1) * 192,
        clientY: (1 - q.y) * 192,
      });
      f.tick(time + 0.005);
      owner.update();
      assert.equal(f.h.state.pointerId, 1);
      assert.equal(f.h.state.mode, "pending");
    } else if (name === "dispose") {
      f.h.dispose();
      assert.throws(() => owner.update());
      assert.equal(owner.root.parent, null);
    } else if (name === "shared") {
      const otherFixture = await fixture(),
        other = attach(otherFixture);
      try {
        const geometry = owner.nativeMeshes[0].geometry;
        assert.equal(other.nativeMeshes[0].geometry, geometry);
        assert.notEqual(
          other.nativeMeshes[0].skeleton,
          owner.nativeMeshes[0].skeleton,
        );
        let disposals = 0;
        geometry.addEventListener("dispose", () => disposals++);
        owner.dispose();
        f.h.dispose();
        otherFixture.tick(0.5);
        other.update();
        otherFixture.h.owner.assertCurrent();
        assert.equal(disposals, 0);
      } finally {
        other.dispose();
        otherFixture.h.dispose();
        resourceZero(otherFixture.h.pool.stats);
      }
    }
    result = { passed: true };
  } catch (error) {
    result = { passed: false, error: error.stack };
  } finally {
    owner.dispose();
    f.h.dispose();
    result.resources = f.h.pool.stats;
    try {
      resourceZero(f.h.pool.stats);
    } catch (e) {
      result.passed = false;
      result.resourceError = e.message;
    }
    report.lifecycle[name] = result;
    fs.writeFileSync(
      path.join(out, "report.json"),
      JSON.stringify(report, null, 2),
    );
  }
}
for (const name of [
  "cancel",
  "hidden",
  "lostcapture",
  "repress",
  "dispose",
  "landing-regrab",
  "shared",
])
  await lifecycle(name);
for (const name of selectedScenarios) {
  if (!["drag", "longpress"].includes(name))
    throw new TypeError("Unknown scenario " + name);
  await scenario(name);
}
console.log(JSON.stringify(report, null, 2));
