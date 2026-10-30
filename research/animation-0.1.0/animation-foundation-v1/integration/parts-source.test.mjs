import test from "node:test";
import assert from "node:assert/strict";
import { createPartsSource } from "./parts-source.mjs";
import { SceneBudget } from "./scene-budget.mjs";

function setup({ load, measure = () => 1024, dispose } = {}) {
  const budget = new SceneBudget();
  let loads = 0, releases = 0;
  const source = createPartsSource({
    budget,
    load: () => { loads++; return load ? load() : {}; },
    measure,
    dispose: (asset) => { releases++; dispose?.(asset); },
  });
  return { source, budget, counts: () => ({ loads, releases }) };
}

test("simultaneous actors borrow one source until the last lease releases", async () => {
  const { source, budget, counts } = setup();
  const [a, b] = await Promise.all([source.acquire(), source.acquire()]);
  assert.equal(a.asset, b.asset);
  assert.deepEqual(counts(), { loads: 1, releases: 0 });
  assert.equal(budget.diagnostics().claimedBytes, 1024);
  a.release();
  assert.throws(() => a.asset, /released/);
  assert.ok(b.asset);
  b.release();
  b.release();
  assert.deepEqual(counts(), { loads: 1, releases: 1 });
  assert.equal(budget.diagnostics().claimedBytes, 0);
  assert.equal(source.diagnostics().references, 0);
});

test("closing during an asynchronous load keeps reservation until all borrowers settle", async () => {
  let resolve;
  const { source, budget, counts } = setup({ load: () => new Promise(r => { resolve = r; }) });
  const a = source.acquire(), b = source.acquire();
  source.close();
  assert.equal(source.diagnostics().references, 2);
  assert.ok(budget.diagnostics().claimedBytes > 0);
  resolve({});
  const results = await Promise.allSettled([a, b]);
  assert.ok(results.every(r => r.status === "rejected"));
  assert.deepEqual(counts(), { loads: 1, releases: 1 });
  assert.equal(budget.diagnostics().claimedBytes, 0);
  await assert.rejects(source.acquire(), /closed/);
});

test("failed first load is retryable without a rejected-promise cache or leaked budget", async () => {
  let fail = true;
  const { source, budget, counts } = setup({ load: () => {
    if (fail) { fail = false; throw new Error("load failed"); }
    return {};
  } });
  await assert.rejects(source.acquire(), /load failed/);
  assert.equal(budget.diagnostics().claimedBytes, 0);
  const lease = await source.acquire();
  lease.release();
  assert.deepEqual(counts(), { loads: 2, releases: 1 });
});

test("failed admission and throwing resource observers still release claims", async () => {
  const { source, budget } = setup({
    measure: () => { throw new Error("invalid model"); },
    dispose: () => { throw new Error("observer failed"); },
  });
  await assert.rejects(source.acquire(), error => {
    assert.equal(error.errors[0].message, "invalid model");
    assert.match(error.errors[1].message, /release failures/);
    return true;
  });
  assert.equal(source.diagnostics().references, 0);
  assert.equal(budget.diagnostics().claimedBytes, 0);
});
