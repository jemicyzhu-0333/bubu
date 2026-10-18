import test from "node:test";
import assert from "node:assert/strict";
import { createFrameOwner } from "./frame-owner.mjs";

test("frame owner commits one time/revision and preserves ordered ownership", () => {
  const events = [];
  let owner;
  const record = (name) => (frame) => events.push([name, frame?.revision]);
  owner = createFrameOwner({
    advanceBody: (t) => {
      events.push(["body", t]);
      return "state";
    },
    finalizeBody: record("finalize"),
    sampleAnchors: record("anchors"),
    updateAttachments: record("attachments"),
    updateEffects: record("effects"),
    render: record("render"),
  });
  assert.equal(owner.step(1), "state");
  assert.equal(owner.revision, 1);
  assert.equal(owner.time, 1);
  assert.deepEqual(
    events.map((e) => e[0]),
    ["body", "finalize", "anchors", "attachments", "effects", "render"],
  );
  assert.throws(() => owner.assertRevision(0), /Stale/);
  owner.assertRevision(1);
  assert.throws(() => {
    owner.revision = 99;
  }, TypeError);
  assert.equal(owner.revision, 1);
  owner.dispose();
  assert.throws(() => owner.step(2), /disposed/);
});
test("frame owner refuses reentrant updates without multiple body ownership", () => {
  let owner,
    calls = 0;
  const nothing = () => {};
  owner = createFrameOwner({
    advanceBody: () => {
      calls++;
      assert.throws(() => owner.step(2), /Reentrant/);
    },
    finalizeBody: nothing,
    sampleAnchors: nothing,
    updateAttachments: nothing,
    updateEffects: nothing,
    render: nothing,
  });
  owner.step(1);
  assert.equal(calls, 1);
});
