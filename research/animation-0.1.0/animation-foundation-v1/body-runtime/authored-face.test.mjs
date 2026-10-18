import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixture.mjs";
const low = { candidate: "P2", amount: 0.25, enterSec: 0.1, exitSec: 0.2 };
const high = { candidate: "P2", amount: 0.8, enterSec: 0.4, exitSec: 0.2 };
test("authored amounts and enter timing reach actual expression owner", async () => {
  const a = await fixture({ authoredFaces: [low] }),
    b = await fixture({ authoredFaces: [high] });
  try {
    a.h.facePort.request({ time: 0, ...low });
    b.h.facePort.request({ time: 0, ...high });
    a.tick(0);
    b.tick(0);
    a.tick(0.15);
    b.tick(0.15);
    assert.equal(a.h.owner.state.path, "P2");
    assert.equal(a.h.owner.state.owner, "authored");
    assert.notDeepEqual(a.h.owner.state, b.h.owner.state);
    console.log("Authored comparison", a.h.owner.state, b.h.owner.state);
    a.h.facePort.release({ time: 0.2 });
    a.tick(0.2);
    a.tick(1);
    assert.notEqual(a.h.owner.state.owner, "authored");
  } finally {
    a.h.dispose();
    b.h.dispose();
  }
});
test("same-time pointer preempts authored port, lifecycle prevents resurrection", async () => {
  let f,
    calls = [];
  f = await fixture({
    authoredFaces: [low],
    beforeCommit: ({ time, mode }) => {
      calls.push({ time, mode });
      if (time === 0.1) f.h.facePort.request({ time, ...low });
    },
  });
  try {
    f.h.facePort.request({ time: 0, ...low });
    f.tick(0);
    f.emit("pointerdown", 0.1);
    f.tick(0.1);
    assert.equal(calls.at(-1).mode, "pending");
    assert.equal(f.h.owner.state.phase, "exit");
    f.h.suspend();
    f.h.resume();
    f.tick(1);
    assert.notEqual(f.h.owner.state.owner, "authored");
    assert.equal(f.h.facePort.pendingCount, 0);
    assert.throws(() => f.h.facePort.request({ time: 0.1, ...low }), /Stale/);
  } finally {
    f.h.dispose();
  }
});
