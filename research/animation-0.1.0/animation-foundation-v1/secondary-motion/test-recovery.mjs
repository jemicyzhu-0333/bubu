import fs from "node:fs";
import assert from "node:assert/strict";
import * as T from "three";
import { admitSecondaryAsset, createSecondaryMotion } from "./index.mjs";
import {
  loadGLB,
  revised,
  disposeAsset,
} from "../integration/asset-fixtures.mjs";

const asset = await loadGLB(
  revised + "/accessory-expansion/models/07-cape.glb",
);
const descriptor = JSON.parse(
  fs.readFileSync(new URL("./descriptors/cape.json", import.meta.url)),
);
const impossible = structuredClone(descriptor);
impossible.profile.proxies = [{ center: [0, 0.22, -0.7], radius: 0.05 }];
impossible.profile.maxAngleRad = 0.00001;
await assert.rejects(
  admitSecondaryAsset({ asset, descriptor: impossible }),
  /rest tail penetrates/,
);
const admission = await admitSecondaryAsset({ asset, descriptor });
const report = { impossibleRestRejected: true, rates: [] };
const sample = (time, root) => {
  const t = Math.min(3, time);
  root.position.x = 0.3 * Math.sin(8 * t);
  root.rotation.z = 0.7 * Math.sin(4 * t);
};
for (const hz of [30, 60, 120]) {
  const instance = createSecondaryMotion({ admission, parent: new T.Group() });
  let previous = null;
  let maxComponentJump = 0;
  let maxRecoveryFrameJump = 0;
  let previousRejects = 0;
  let maxPenetration = 0;
  let rejectsAtStop = 0;
  for (let frame = 0; frame <= hz * 6; frame++) {
    instance.update({ time: frame / hz, sampleAnchor: sample });
    const current = instance.parts.map((part) =>
      part.mesh.geometry.attributes.position.array.slice(),
    );
    const diagnostics = instance.diagnostics();
    let jump = 0;
    if (previous)
      current.forEach((values, partIndex) =>
        values.forEach((value, index) => {
          jump = Math.max(jump, Math.abs(value - previous[partIndex][index]));
        }),
      );
    maxComponentJump = Math.max(maxComponentJump, jump);
    if (diagnostics.recoveryTicks > previousRejects)
      maxRecoveryFrameJump = Math.max(maxRecoveryFrameJump, jump);
    previousRejects = diagnostics.recoveryTicks;
    for (let chain = 0; chain < diagnostics.tails.length; chain++) {
      for (const tail of diagnostics.tails[chain].slice(1)) {
        for (const proxyIndex of descriptor.profile.colliderLinks[chain]) {
          const proxy = descriptor.profile.proxies[proxyIndex];
          const center = new T.Vector3(...proxy.center).applyMatrix4(
            instance.root.matrixWorld,
          );
          maxPenetration = Math.max(
            maxPenetration,
            proxy.radius +
              descriptor.profile.radius -
              center.distanceTo(new T.Vector3(...tail)),
          );
        }
      }
    }
    if (frame === hz * 3) rejectsAtStop = diagnostics.recoveryTicks;
    previous = current;
  }
  const diagnostics = instance.diagnostics();
  assert(maxPenetration <= 1e-6);
  assert(diagnostics.recoveryTicks > 0);
  assert.equal(diagnostics.staticFallback, false);
  if (hz >= 60) assert.equal(maxRecoveryFrameJump, 0);
  assert.equal(diagnostics.recovering, false);
  assert(diagnostics.recoveryTicks - rejectsAtStop < 5);
  report.rates.push({
    hz,
    maxComponentJump,
    maxRecoveryFrameJump,
    maxPenetration,
    rejectsAtStop,
    diagnostics,
  });
  instance.dispose();
}
assert(
  report.rates[0].maxRecoveryFrameJump <=
    report.rates[1].maxComponentJump + 1e-7,
);
const reference = report.rates[1].diagnostics.tails.flat(2);
for (const row of report.rates)
  assert(
    row.diagnostics.tails
      .flat(2)
      .every((value, index) => Math.abs(value - reference[index]) < 1e-7),
  );
admission.dispose();
disposeAsset(asset);
fs.writeFileSync(
  new URL("./recovery-evidence.json", import.meta.url),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
