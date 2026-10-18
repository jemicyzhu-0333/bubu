import test from "node:test";
import assert from "node:assert/strict";
import { SceneBudget } from "./scene-budget.mjs";
test("pending reservations bound aggregate allocation and commits cannot expand", () => {
  const budget = new SceneBudget({ maxBytes: 100 }),
    a = budget.reserve(60, "a"),
    b = budget.reserve(40, "b");
  assert.throws(() => budget.reserve(1, "overflow"), /exhausted/);
  assert.throws(() => a.commit(61), /exceed/);
  a.commit(30);
  assert.equal(budget.diagnostics().claimedBytes, 70);
  const c = budget.reserve(30, "c");
  b.release();
  b.release();
  c.release();
  a.release();
  assert.equal(budget.diagnostics().claimedBytes, 0);
});
test("closed ledger still releases pending work but rejects commit and new allocation", () => {
  const budget = new SceneBudget(),
    claim = budget.reserve(100, "pending");
  budget.close();
  assert.throws(() => claim.commit(1), /live/);
  assert.throws(() => budget.reserve(1, "new"), /closed/);
  claim.release();
  assert.equal(budget.diagnostics().claims, 0);
});
