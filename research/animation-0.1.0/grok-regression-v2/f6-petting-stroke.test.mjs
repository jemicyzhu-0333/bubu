// F6 (G-20261112-002, owner decision 2026-11-12): petting allows back-and-forth
// stroking, so lateral strokes while petting must not turn into a pick-up.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { withFixture } from "./helpers.mjs";

function startPetting(f) {
  const p = f.point(0, 1.4);
  f.emit("pointerdown", 0, p);
  let s;
  for (let i = 0; i <= 48; i++) s = f.tick(i / 60);
  assert.equal(s.mode, "petting", "precondition: long press on head pets");
  return { p, t: 48 / 60 };
}

describe("grok-regression F6: back-and-forth stroking while petting", () => {
  test("+-16px horizontal strokes for 1.5s stay in petting", () =>
    withFixture((f) => {
      let { p, t } = startPetting(f);
      const modes = new Set();
      for (let i = 1; i <= 90; i++) {
        t += 1 / 60;
        const dx = 16 * Math.sin((i / 60) * 2 * Math.PI * 1.5); // 1.5 strokes per second
        f.emit("pointermove", t, { clientX: p.clientX + dx, clientY: p.clientY });
        modes.add(f.tick(t).mode);
      }
      assert.deepEqual([...modes], ["petting"]);
    }));

  test("guard: a deliberate upward pull from petting still picks up", () =>
    withFixture((f) => {
      let { p, t } = startPetting(f);
      let s;
      for (let i = 1; i <= 20; i++) {
        t += 1 / 60;
        f.emit("pointermove", t, { clientX: p.clientX, clientY: p.clientY - i * 4 });
        s = f.tick(t);
      }
      assert.equal(s.mode, "drag");
    }));
});
