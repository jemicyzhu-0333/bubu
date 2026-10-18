import assert from "node:assert/strict";
import fs from "node:fs";
import * as T from "../../bubu-asset-physics-revision-20261018/node_modules/three/build/three.module.js";
import { fixture } from "./fixture.mjs";
const f = await fixture();
const body = f.h.body;
function brute() {
  body.root.updateMatrixWorld(true);
  const point = new T.Vector3();
  let min = Infinity;
  for (let i = 0; i < body.skin.geometry.attributes.position.count; i++) {
    body.skin.getVertexPosition(i, point).applyMatrix4(body.skin.matrixWorld);
    min = Math.min(min, point.y);
  }
  return min;
}
let maxError = 0;
function check() {
  const actual = body.minimumFoot(),
    expected = brute();
  maxError = Math.max(maxError, Math.abs(actual - expected));
  assert(Math.abs(actual - expected) < 1e-12);
}
const report = { scenarios: {} };
for (const scenario of ["drag", "longpress"]) {
  const rows = JSON.parse(
    fs.readFileSync(
      new URL(
        `../../bubu-external-assets-staging-20261018/.cache/clean-a/pointer/${scenario}/trajectory.json`,
        import.meta.url,
      ),
    ),
  );
  for (const row of rows) {
    body.root.position.fromArray(row.body.root);
    body.pivot.quaternion.fromArray(row.body.pivot);
    for (const [name, value] of Object.entries(row.body.jointQuaternions))
      body.bones[name].quaternion.fromArray(value);
    check();
  }
  report.scenarios[scenario] = rows.length;
}
body.restore();
check();
const scans = body.floorDiagnostics.scans;
for (let i = 0; i < 100; i++) {
  body.place({ x: i / 100, y: i / 100, z: -i / 100 });
  check();
}
assert.equal(body.floorDiagnostics.scans, scans);
body.bones.Hip_L.rotation.x += 0.01;
check();
assert.equal(body.floorDiagnostics.scans, scans + 1);
body.root.rotation.z += 0.02;
check();
assert.equal(body.floorDiagnostics.scans, scans + 2);
body.skin.geometry.morphAttributes.position = [
  body.skin.geometry.attributes.position.clone(),
];
body.skin.morphTargetInfluences = [0.2];
check();
assert.equal(body.floorDiagnostics.scans, scans + 3);
body.skin.morphTargetInfluences[0] = 0;
body.skin.geometry.morphAttributes.position = [];
body.restore();
f.h.suspend();
const hiddenScans = body.floorDiagnostics.scans;
for (let i = 0; i < 100; i++) f.tick(i / 60);
assert.equal(body.floorDiagnostics.scans, hiddenScans);
f.h.resume();
f.tick(2);
check();
const idleScans = body.floorDiagnostics.scans;
const start = performance.now();
for (let i = 0; i < 600; i++) f.tick(2.1 + i / 60);
report.idleMillisecondsPerFrame = (performance.now() - start) / 600;
assert.equal(body.floorDiagnostics.scans, idleScans);
report.maxFloorError = maxError;
report.diagnostics = body.floorDiagnostics;
f.h.dispose();
fs.writeFileSync(
  new URL("./floor-evidence.json", import.meta.url),
  JSON.stringify(report, null, 2),
);
console.log(report);
