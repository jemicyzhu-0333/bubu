import assert from "node:assert/strict";
import fs from "node:fs";
import { FoundationPool } from "./foundation-host.mjs";
import { FIXTURES } from "../configuration/fixtures/index.mjs";
import { loadGLB, revised } from "./asset-fixtures.mjs";
const p = new FoundationPool(),
  a = await p.create();
for (const id of [1, 2]) {
  const config = structuredClone(FIXTURES[id]);
  config.secondaryMotion[0].mode = "rigid-follow";
  await assert.rejects(a.equip(config), /Unimplemented/);
}
let resolve, reject;
const pending = a.equip(FIXTURES[4], {
  load: () =>
    new Promise((r, j) => {
      resolve = r;
      reject = j;
    }),
});
await a.equip(FIXTURES[0]);
reject(Error("old failed"));
await assert.rejects(pending, /old failed/);
assert.equal(a.mounts.size, 2);
let done;
const original = structuredClone(FIXTURES[4]);
const snapshot = a.equip(original, {
  load: () => new Promise((r) => (done = r)),
});
original.mounts[0].anchor = "hip.sideR";
done(await loadGLB(revised + "/accessory-expansion/models/05-halo.glb"));
await snapshot;
assert.equal(a.mounts.get("halo").spec.anchor, "crown");
for (let i = 1; i <= 200; i++) a.step(i * 0.05);
assert(a.handles.every((h) => h.state === "disposed"));
a.reset();
assert(a.handles.every((h) => h.state !== "disposed"));
a.step(10.05);
p.dispose();
assert.equal(p.diagnostics().actors, 0);
fs.writeFileSync(
  new URL("./evidence/contract-report.json", import.meta.url),
  JSON.stringify(
    {
      snapshotImmutable: true,
      oldFailureDoesNotRemoveNewEquip: true,
      secondaryModesFailClosed: true,
      expiredEffectsRestartOnReset: true,
      disposedActors: 0,
    },
    null,
    2,
  ),
);
console.log("Contract regressions passed");
