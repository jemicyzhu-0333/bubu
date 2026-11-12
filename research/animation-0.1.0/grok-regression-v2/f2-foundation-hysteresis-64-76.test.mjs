// F2 adoption in foundation-v1 (owner decision 2026-11-12): foundation-v1 adopts
// the F2 face-intent hysteresis on condition that a dedicated test exercises the
// 64/76 DIP/s band through the foundation-v1 pointer host (not only the
// drag-landing-r5 controller in isolation).
// Band semantics under test: T05 -> 01 only below 64; 01 -> T05 only above 76;
// speeds inside 64..76 keep the current face.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { withFixture } from "./helpers.mjs";

describe("grok-regression F2-foundation: 64/76 hysteresis through foundation-v1", () => {
  test("in-band speeds keep the current face; crossings switch once", () =>
    withFixture((f) => {
      const p = f.point(0, 1.4);
      let t = 0, x = p.clientX;
      f.emit("pointerdown", t, p);
      f.tick(t);
      // Steady horizontal drag at `speed` DIP/s for `seconds`; returns the
      // face intents after a 0.25s settling window.
      const segment = (speed, seconds) => {
        const faces = [];
        const frames = Math.round(seconds * 60);
        for (let i = 1; i <= frames; i++) {
          t += 1 / 60;
          x += speed / 60;
          f.emit("pointermove", t, { clientX: x, clientY: p.clientY });
          const s = f.tick(t);
          if (i > 15) faces.push(s.drag.faceIntent);
        }
        return faces;
      };
      const only = (faces, face, label) =>
        assert.deepEqual([...new Set(faces)], [face], label);

      segment(100, 0.6); // enter the fast face
      only(segment(100, 0.5), "T05", "100 DIP/s is fast");
      only(segment(67, 0.8), "T05", "67 DIP/s (inside band) keeps T05");
      only(segment(58, 0.8), "01", "58 DIP/s (below 64) leaves T05");
      only(segment(73, 0.8), "01", "73 DIP/s (inside band) keeps 01");
      only(segment(85, 0.8), "T05", "85 DIP/s (above 76) returns to T05");
    }));
});
