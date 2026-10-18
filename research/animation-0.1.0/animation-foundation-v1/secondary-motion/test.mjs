import fs from "node:fs";
import os from "node:os";
import assert from "node:assert/strict";
import * as T from "three";
import {
  admitSecondaryAsset,
  createSecondaryMotion,
  ENGINE,
} from "./index.mjs";
import { bakeAccessory, geometryIdentity } from "./asset-admission.mjs";
import { createDetachedProp, RAPIER_VERSION } from "./rapier.mjs";
import {
  createBody,
  correctedSatchel,
  loadGLB,
  revised,
  disposeAsset,
} from "../integration/asset-fixtures.mjs";

const body = await createBody();
body.f.tick(0);
body.owner.update();
const assets = {
  satchel: await correctedSatchel(body),
  cape: await loadGLB(revised + "/accessory-expansion/models/07-cape.glb"),
};
const descriptors = Object.fromEntries(
  Object.keys(assets).map((kind) => [
    kind,
    JSON.parse(
      fs.readFileSync(new URL(`./descriptors/${kind}.json`, import.meta.url)),
    ),
  ]),
);
const report = {
  scope:
    "V2 explicit binding admission; CPU only, no native/cloth/palm-contact acceptance",
  versions: { ...ENGINE, rapier: RAPIER_VERSION },
  runtime: {
    node: process.version,
    os: os.platform(),
    cpu: os.cpus()[0].model,
  },
  fixtures: {},
  tests: {},
};
const sample = (time, root) => {
  root.position.x =
    time < 1
      ? 0
      : time < 2
        ? (time - 1) * 0.4
        : time < 3
          ? 0.4 - (time - 2) * 0.7
          : -0.3;
  root.rotation.y = time < 3 ? 0 : Math.min(0.4, (time - 3) * 0.2);
};
const quantiles = (values) => {
  values.sort((a, b) => a - b);
  return Object.fromEntries(
    [0.5, 0.95, 0.99].map((q) => [
      `p${q * 100}`,
      values[Math.floor(values.length * q)],
    ]),
  );
};
const admissions = {};
for (const [kind, asset] of Object.entries(assets)) {
  const ready = performance.now();
  const admission = await admitSecondaryAsset({
    asset,
    descriptor: descriptors[kind],
  });
  admissions[kind] = admission;
  const results = {};
  const timings = [];
  let maxPin = 0;
  let maxDisplacement = 0;
  let maxAngle = 0;
  for (const hz of [30, 60, 120]) {
    const parent = new T.Group();
    const instance = createSecondaryMotion({ admission, parent });
    for (let frame = 0; frame <= hz * 5; frame++) {
      const before = performance.now();
      instance.update({ time: frame / hz, sampleAnchor: sample });
      if (frame > hz) timings.push(performance.now() - before);
      for (const part of instance.parts) {
        const positions = part.mesh.geometry.attributes.position;
        for (let vertex = 0; vertex < positions.count; vertex++) {
          const distance = new T.Vector3()
            .fromBufferAttribute(positions, vertex)
            .distanceTo(new T.Vector3().fromArray(part.rest, vertex * 3));
          assert(Number.isFinite(distance));
          if (part.pins[vertex]) maxPin = Math.max(maxPin, distance);
          maxDisplacement = Math.max(maxDisplacement, distance);
          if (frame === 0) assert(distance < 1e-6);
        }
      }
      for (const chain of instance.chains) {
        for (const node of chain)
          maxAngle = Math.max(
            maxAngle,
            node.quaternion.angleTo(new T.Quaternion()),
          );
      }
    }
    results[hz] = instance.diagnostics();
    sample(0, instance.root);
    instance.reset(0);
    for (let frame = 0; frame <= hz * 5; frame++)
      instance.update({ time: frame / hz, sampleAnchor: sample });
    assert(
      instance
        .diagnostics()
        .tails.flat(2)
        .every(
          (value, index) =>
            Math.abs(value - results[hz].tails.flat(2)[index]) < 1e-12,
        ),
    );
    instance.dispose();
    assert.equal(parent.children.length, 0);
    assert.equal(instance.diagnostics().ownedGeometries, 0);
  }
  let rateError = 0;
  for (const hz of [30, 120])
    results[hz].tails.flat(2).forEach((value, index) => {
      rateError = Math.max(
        rateError,
        Math.abs(value - results[60].tails.flat(2)[index]),
      );
    });
  assert(rateError < 1e-7);
  assert.equal(maxPin, 0);
  assert(maxDisplacement < 0.2);
  report.fixtures[kind] = {
    vertices: results[60].vertices,
    maxPin,
    maxDisplacement,
    maxAngle,
    rateError,
    cpuMs: quantiles(timings),
    admissionAndReplayMs: performance.now() - ready,
  };
}

// Static transitions restore once. Repeated/120Hz no-tick frames do not skin or update normals.
const quiet = createSecondaryMotion({
  admission: admissions.cape,
  parent: new T.Group(),
});
quiet.update({ time: 0 });
quiet.update({ time: 1 / 60 });
quiet.update({ time: 2 / 60, hidden: true });
const quietBefore = quiet.diagnostics();
const quietTimes = [];
for (let frame = 3; frame <= 603; frame++) {
  const before = performance.now();
  quiet.update({
    time: frame / 60,
    hidden: true,
    sampleAnchor: (time, root) => {
      root.position.x = time;
    },
  });
  quietTimes.push(performance.now() - before);
}
const quietAfter = quiet.diagnostics();
assert.equal(quietAfter.deformationPasses, quietBefore.deformationPasses);
assert.equal(quietAfter.normalPasses, quietBefore.normalPasses);
assert.equal(quietAfter.restCopies, quietBefore.restCopies);
assert.equal(quietAfter.resets, quietBefore.resets);
assert.equal(quiet.root.position.x, 603 / 60);
quiet.update({ time: 20 });
assert.equal(quiet.diagnostics().steps, quietBefore.steps);
quiet.dispose();
report.tests.hidden601Frames = {
  vertexPasses: 0,
  normalPasses: 0,
  extraRestCopies: 0,
  cpuMs: quantiles(quietTimes),
};

const repeated = createSecondaryMotion({
  admission: admissions.cape,
  parent: new T.Group(),
});
repeated.update({ time: 0 });
repeated.update({ time: 1 / 120 });
assert.equal(repeated.diagnostics().deformationPasses, 0);
repeated.update({
  time: 5,
  sampleAnchor: (time, root) => {
    root.position.x = time;
  },
});
assert.equal(repeated.root.position.x, 5);
assert(repeated.diagnostics().maxSubsteps <= 6);
assert.throws(() => repeated.update({ time: NaN }));
assert.throws(() => repeated.reset(Infinity));
repeated.dispose();
report.tests.noTickAndLongGap = true;

// Both geometric bytes and topology are admitted once, before creating runtime instances.
const changed = assets.cape.clone(true);
changed.children[0].geometry = changed.children[0].geometry.clone();
changed.children[0].geometry.attributes.position.array[0] += 0.001;
await assert.rejects(
  admitSecondaryAsset({ asset: changed, descriptor: descriptors.cape }),
  /hash\/topology/,
);
changed.children[0].geometry.dispose();
const bad = structuredClone(descriptors.cape);
bad.parts[0].weights[0] = 9;
await assert.rejects(
  admitSecondaryAsset({ asset: assets.cape, descriptor: bad }),
  /influence/,
);
report.tests.sourceMismatchRejected = true;
report.tests.invalidInfluenceRejected = true;

// Horizontal, overlapping-X chains deliberately use hand-authored cross-chain influences.
const synthetic = new T.Group();
const geometry = new T.BufferGeometry();
geometry.setAttribute(
  "position",
  new T.Float32BufferAttribute([0, 0, 0, 0.2, 0.1, 0.1, 0.4, 0.1, -0.1], 3),
);
const mesh = new T.Mesh(geometry, new T.MeshBasicMaterial());
mesh.name = "crossing";
synthetic.add(mesh);
const baked = bakeAccessory(synthetic);
const descriptor = {
  version: 2,
  profile: {
    chains: [
      [
        [0, 0, 0.1],
        [0.4, 0.1, 0.1],
      ],
      [
        [0, 0, -0.1],
        [0.4, 0.1, -0.1],
      ],
    ],
    radius: 0.01,
    stiffness: 3,
    dragForce: 0.5,
    gravityPower: 0.1,
    maxAngleRad: 0.25,
    proxies: [],
    colliderLinks: [[], []],
  },
  parts: [
    {
      name: "crossing",
      vertexCount: 3,
      geometrySHA256: await geometryIdentity(baked[0].geometry),
      jointIndices: [0, 0, 0, 0, 3, 1, 0, 0, 1, 3, 0, 0],
      weights: [1, 0, 0, 0, 0.75, 0.25, 0, 0, 0.6, 0.4, 0, 0],
      pins: [true, false, false],
    },
  ],
};
baked[0].geometry.dispose();
const crossAdmission = await admitSecondaryAsset({
  asset: synthetic,
  descriptor,
});
const cross = createSecondaryMotion({
  admission: crossAdmission,
  parent: new T.Group(),
});
assert.deepEqual(
  Array.from(cross.parts[0].indices),
  descriptor.parts[0].jointIndices,
);
assert.deepEqual(
  Array.from(cross.parts[0].weights),
  descriptor.parts[0].weights,
);
for (let frame = 0; frame <= 60; frame++) cross.update({ time: frame / 60 });
assert.equal(cross.parts[0].mesh.geometry.attributes.position.getX(0), 0);
cross.dispose();
crossAdmission.dispose();
disposeAsset(synthetic);
report.tests.crossingHorizontalAuthoredBinding = true;

const limited = createSecondaryMotion({
  admission: admissions.cape,
  parent: new T.Group(),
  maxAngleRad: 0.00001,
});
limited.update({ time: 0 });
limited.update({ time: 1 / 60 });
assert.equal(limited.diagnostics().recovering, true);
limited.dispose();
report.tests.angleRestFallback = true;
for (let index = 0; index < 30; index++) {
  const instance = createSecondaryMotion({
    admission: admissions.cape,
    parent: new T.Group(),
  });
  instance.update({ time: 0 });
  instance.dispose();
}
report.tests.churn30 = true;

const prop = await createDetachedProp({
  object: new T.Group(),
  parent: new T.Group(),
});
prop.release();
for (let frame = 0; frame <= 300; frame++) prop.update({ time: frame / 60 });
assert(Math.abs(prop.diagnostics().position.y - 0.035) < 0.001);
report.fixtures.rapierBookProxy = prop.diagnostics();
prop.dispose();
assert.equal(prop.diagnostics().bodies, 0);
for (const admission of Object.values(admissions)) admission.dispose();
for (const asset of Object.values(assets)) disposeAsset(asset);
body.dispose();
report.processHeapUsed = process.memoryUsage().heapUsed;
fs.writeFileSync(
  new URL("./evidence.json", import.meta.url),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
