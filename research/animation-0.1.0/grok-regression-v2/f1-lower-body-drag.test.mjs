// F1 (G-20261112-002): a slow drag that starts on the lower/middle body must not
// be silently cancelled while it is still below the pick-up threshold.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { withFixture } from "./helpers.mjs";

describe("grok-regression F1: drag from lower/middle body", () => {
  for (const y of [0.3, 0.6, 0.9, 1.1]) {
    test(`world y=${y}: 1px per 8ms for 20px enters drag`, () =>
      withFixture((f) => {
        const p = f.point(0, y);
        let t = 0;
        f.emit("pointerdown", t, p);
        const down = f.tick(t);
        assert.notEqual(down.pointerId, null, "precondition: pointerdown hits the body");
        let s;
        for (let i = 1; i <= 20; i++) {
          t = i * 0.008;
          f.emit("pointermove", t, { clientX: p.clientX, clientY: p.clientY - i });
          s = f.tick(t);
        }
        assert.notEqual(s.pointerId, null, "gesture must not be silently cancelled");
        assert.equal(s.mode, "drag");
      }));
  }

  test("guard: head drag with the same slow input still enters drag", () =>
    withFixture((f) => {
      const p = f.point(0, 1.4);
      let t = 0, s;
      f.emit("pointerdown", t, p);
      f.tick(t);
      for (let i = 1; i <= 20; i++) {
        t = i * 0.008;
        f.emit("pointermove", t, { clientX: p.clientX, clientY: p.clientY - i });
        s = f.tick(t);
      }
      assert.equal(s.mode, "drag");
    }));

  test("guard: long press on lower body does not start petting", () =>
    withFixture((f) => {
      const p = f.point(0, 0.6);
      f.emit("pointerdown", 0, p);
      f.tick(0);
      let s;
      for (let i = 1; i <= 120; i++) s = f.tick(i / 60);
      assert.notEqual(s.mode, "petting");
    }));
});
