import test from "node:test";
import assert from "node:assert/strict";
import { createContactRegistry, FULL_CONTACT_COVERAGE } from "./admission.mjs";
import { createContactOwner } from "./owner.mjs";

const hash = n => String(n).repeat(64);
const actor = { sourceSHA256: hash(1), partsSHA256: hash(2) };
const action = { id: "tea", trajectorySHA256: hash(3), attachmentSHA256: hash(4) };
const garment = { id: "cape", modelSHA256: hash(5), attachmentSHA256: hash(6) };
const proof = (g, status = "supported") => ({
  actor, action, garment: g, status, reason: status === "blocked" ? "endpoint-attachment-conflict" : "synthetic-test-only",
  coverage: status === "blocked" ? ["endpoints"] : [...FULL_CONTACT_COVERAGE],
});

test("exact blocked combination wins over absent bare-body evidence and never calls start", () => {
  let starts = 0;
  const owner = createContactOwner({
    actor, registry: createContactRegistry([proof(garment, "blocked")]),
    readGarments: () => [garment],
  });
  const result = owner.begin(action, () => { starts++; });
  assert.equal(result.status, "blocked");
  assert.equal(result.allowed, false);
  assert.equal(starts, 0);
  assert.equal(owner.snapshot().active, null);
});
test("changed mesh, attachment or action versions are untested rather than implicitly approved", () => {
  const registry = createContactRegistry([proof(null), proof(garment)]);
  const request = { actor, action, garments: [garment] };
  assert.equal(registry.evaluate(request).status, "supported");
  for (const candidate of [
    { ...request, action: { ...action, trajectorySHA256: hash(7) } },
    { ...request, actor: { ...actor, partsSHA256: hash(7) } },
    { ...request, garments: [{ ...garment, modelSHA256: hash(7) }] },
    { ...request, garments: [{ ...garment, attachmentSHA256: hash(7) }] },
  ]) assert.equal(registry.evaluate(candidate).status, "untested");
  assert.equal(createContactRegistry().evaluate({ ...request, garments: [] }).allowed, false);
});
test("sampled endpoint success cannot be promoted to complete contact acceptance", () => {
  assert.throws(() => createContactRegistry([{ ...proof(garment), coverage: ["endpoints"] }]), /Partial/);
  assert.throws(() => createContactRegistry([proof(garment), proof(garment)]), /Duplicate/);
});
test("separately reviewed garments do not establish combined wardrobe clearance", () => {
  const second = { ...garment, id: "scarf" };
  const registry = createContactRegistry([proof(null), proof(garment), proof(second)]);
  const result = registry.evaluate({ actor, action, garments: [garment, second] });
  assert.equal(result.status, "untested");
  assert.equal(result.allowed, false);
  assert.equal(result.findings.at(-1).reason, "wardrobe-combination-not-reviewed");
});
test("exact complete wardrobe evidence is order independent but cannot authorize a different combination", () => {
  const second = { ...garment, id: "scarf" };
  const combination = { ...proof(null), garments: [second, garment] };
  delete combination.garment;
  const registry = createContactRegistry([
    proof(null), proof(garment), proof(second), combination,
  ]);
  assert.equal(registry.evaluate({ actor, action, garments: [garment, second] }).allowed, true);
  assert.equal(registry.evaluate({ actor, action, garments: [second, garment] }).allowed, true);
  const changed = { ...second, attachmentSHA256: hash(9) };
  assert.equal(registry.evaluate({ actor, action, garments: [garment, changed] }).status, "untested");
  assert.throws(() => createContactRegistry([combination, { ...combination, garments: [garment, second] }]), /Duplicate/);
  assert.throws(() => createContactRegistry([{ ...combination, coverage: ["endpoints"] }]), /Partial/);
  assert.throws(() => createContactRegistry([{ ...combination, garments: [garment] }]), /two to five/);
  // All evidence here is synthetic, exercising registry semantics only.
  const blocked = createContactRegistry([proof(null), proof(garment, "blocked"), proof(second), combination]);
  assert.equal(blocked.evaluate({ actor, action, garments: [garment, second] }).status, "blocked");
});
test("an active action rejects conflicting equips before mutation; stop permits a fresh boundary", () => {
  const registry = createContactRegistry([proof(null), proof(garment, "blocked")]);
  let stops = 0;
  const owner = createContactOwner({ actor, registry, readGarments: () => [] });
  assert.equal(owner.begin(action, () => ({ stop() { stops++; } })).allowed, true);
  assert.equal(owner.checkEquipment([garment]).allowed, false);
  assert.equal(owner.snapshot().active.id, "tea");
  owner.stop();
  assert.equal(stops, 1);
  assert.equal(owner.checkEquipment([garment]), null);
  owner.dispose();
  assert.equal(stops, 1);
});
test("reentrant cancellation cleans the staged handle and cannot resurrect an action", () => {
  let stopped = 0;
  const owner = createContactOwner({
    actor, registry: createContactRegistry([proof(null)]), readGarments: () => [],
  });
  assert.throws(() => owner.begin(action, () => {
    owner.stop();
    return { stop() { stopped++; } };
  }), /invalidated/);
  assert.equal(stopped, 1);
  assert.equal(owner.snapshot().active, null);
});
test("cleanup failure retires ownership before the next action", () => {
  const owner = createContactOwner({
    actor, registry: createContactRegistry([proof(null)]), readGarments: () => [],
  });
  owner.begin(action, () => ({ stop() { throw new Error("observer"); } }));
  assert.throws(() => owner.stop(), /observer/);
  assert.equal(owner.snapshot().active, null);
  owner.dispose();
  assert.throws(() => owner.begin(action, () => ({})), /unavailable/);
});

test("async action factories are rejected before execution, and thenable late handles are retired", async () => {
  const owner = createContactOwner({
    actor, registry: createContactRegistry([proof(null)]), readGarments: () => [],
  });
  let calls = 0;
  assert.throws(() => owner.begin(action, async () => { calls++; }), /synchronous/);
  assert.equal(calls, 0);
  let release;
  const late = new Promise(resolve => { release = resolve; });
  assert.throws(() => owner.begin(action, () => late), /synchronous/);
  release({ stop() { calls++; } });
  await late;
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.equal(owner.snapshot().active, null);
  owner.dispose();
});
