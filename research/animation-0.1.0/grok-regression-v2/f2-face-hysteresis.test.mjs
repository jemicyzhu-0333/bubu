// F2 (G-20261112-002): drag expression must not flicker when drag speed hovers
// around the face-intent threshold (about 57/84 DIP/s alternating).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { withFixture, switches } from "./helpers.mjs";

describe("grok-regression F2: face intent near speed threshold", () => {
  test("alternating ~57/84 DIP/s for 4s: at most one switch per 0.25s", () =>
    withFixture((f) => {
      const p = f.point(0, 1.4);
      let t = 0, y = p.clientY;
      f.emit("pointerdown", t, p);
      f.tick(t);
      const trace = [];
      for (let i = 1; i <= 240; i++) {
        t = i / 60;
        y -= i % 2 ? 0.95 : 1.4;
        f.emit("pointermove", t, { clientX: p.clientX, clientY: y });
        trace.push(f.tick(t).drag.faceIntent);
      }
      const tail = trace.slice(80); // last 160 frames = 2.67s
      const n = switches(tail);
      assert.ok(n <= Math.ceil(160 / 60 / 0.25), `face intent switched ${n} times in 160 frames`);
    }));
});
