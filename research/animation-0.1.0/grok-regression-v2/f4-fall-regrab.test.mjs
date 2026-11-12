// F4 (G-20261112-002): the pet can be re-grabbed while it is falling, and the
// expression is not blank in mid-air.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { withFixture, skinPoint } from "./helpers.mjs";

function liftAndRelease(f) {
  const p = f.point(0, 1.4);
  let t = 0;
  f.emit("pointerdown", t, p);
  f.tick(t);
  for (let i = 1; i <= 60; i++) {
    t = i / 60;
    f.emit("pointermove", t, { clientX: p.clientX, clientY: p.clientY - i * 3 });
    f.tick(t);
  }
  t += 0.5;
  f.tick(t);
  t += 0.001;
  f.emit("pointerup", t, { clientX: p.clientX, clientY: p.clientY - 180 });
  const s = f.tick(t);
  return { t, s };
}

describe("grok-regression F4: fall re-grab and mid-air face", () => {
  test("pointerdown on the body 0.15s after release is accepted", () =>
    withFixture((f) => {
      let { t } = liftAndRelease(f);
      t += 0.15;
      const falling = f.tick(t);
      assert.equal(falling.drag.mode, "descending", "precondition: still falling");
      t += 0.004; // after the last sealed frame
      f.at(t);
      f.target.emit("pointerdown", skinPoint(f, 0, 1.0));
      const s = f.tick(t + 1 / 60);
      assert.notEqual(s.pointerId, null, "re-grab during fall must be accepted");
      assert.ok(["pending", "drag"].includes(s.mode), `mode=${s.mode}`);
    }));

  test("guard: the same re-grab is accepted once settled", () =>
    withFixture((f) => {
      let { t } = liftAndRelease(f);
      let s;
      for (let i = 0; i < 300; i++) {
        t += 1 / 60;
        s = f.tick(t);
        if (s.drag.mode === "settle") break;
      }
      assert.equal(s.drag.mode, "settle", "precondition: reached settle");
      t += 0.004;
      f.at(t);
      f.target.emit("pointerdown", skinPoint(f, 0, 1.0));
      s = f.tick(t + 1 / 60);
      assert.notEqual(s.pointerId, null);
    }));

  test("faceIntent is never null while descending", () =>
    withFixture((f) => {
      let { t } = liftAndRelease(f);
      let descending = 0, blank = 0;
      for (let i = 1; i <= 150; i++) {
        t += 1 / 60;
        const s = f.tick(t);
        if (s.drag.mode === "descending") {
          descending++;
          if (s.drag.faceIntent == null) blank++;
        }
      }
      assert.ok(descending > 0, "precondition: a descending phase exists");
      assert.equal(blank, 0, `${blank}/${descending} descending frames had no face intent`);
    }));
});
