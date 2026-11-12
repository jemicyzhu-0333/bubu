// F2 in-band acceptance A (G-20261112-013): straight-line input whose
// CONTROLLER-MEASURED speed stays inside the 64..76 DIP/s band must cause no
// face-intent switch that is not explained by measured speed crossing 64/76.
// Measured speed is read from the real DragController instance used by the
// foundation-v1 pointer host (test-side prototype wrap; no product change).
import { describe, test, after } from "node:test";
import assert from "node:assert/strict";
import { DragController } from "../drag-landing-r5/src/drag-controller.mjs";
import { withFixture } from "./helpers.mjs";

const log = [];
const original = DragController.prototype.move;
DragController.prototype.move = function (t, p) {
  const result = original.call(this, t, p);
  log.push({ t, speed: Math.hypot(this.velocity.x, this.velocity.y), face: this.snapshot().faceIntent, mode: this.mode });
  return result;
};
after(() => { DragController.prototype.move = original; });

// A switch between T05 and 01 is explained only by the measured speed being
// beyond the edge it crosses at that sample (T05->01 needs <64, 01->T05 >76).
export function classify(rows) {
  let explained = 0, unexplained = 0;
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1].face, b = rows[i].face;
    if (a === b || !["T05", "01"].includes(a) || !["T05", "01"].includes(b)) continue;
    const ok = (a === "T05" && rows[i].speed < 64) || (a === "01" && rows[i].speed > 76);
    if (ok) explained++; else unexplained++;
  }
  return { explained, unexplained };
}

describe("grok-regression F2-inband: straight line, measured speed in 64..76", () => {
  test("66/74 DIP/s alternating straight line: in-band samples, 0 unexplained switches", () =>
    withFixture((f) => {
      const p = f.point(0, 1.4);
      let t = 0, x = p.clientX;
      f.emit("pointerdown", t, p);
      f.tick(t);
      const run = (speed, seconds, tag) => {
        const from = log.length;
        for (let i = 1, n = Math.round(seconds * 60); i <= n; i++) {
          t += 1 / 60;
          x += speed / 60;
          f.emit("pointermove", t, { clientX: x, clientY: p.clientY });
          f.tick(t);
        }
        for (const row of log.slice(from)) row.tag = tag;
      };
      log.length = 0;
      run(110, 0.6, "enter");
      for (let k = 0; k < 10; k++) run(k % 2 ? 74 : 66, 0.35, "band");
      const band = log.filter((r) => r.tag === "band");
      const settled = band.slice(5); // skip the 80ms window carried over from 110 DIP/s
      const inBand = settled.filter((r) => r.speed >= 64 && r.speed <= 76).length;
      const c = classify(band);
      console.log(`[F2-inband] measured speed ${Math.min(...settled.map((r) => r.speed)).toFixed(2)}..${Math.max(...settled.map((r) => r.speed)).toFixed(2)} DIP/s; in-band ${inBand}/${settled.length}; switches explained ${c.explained}, unexplained ${c.unexplained}`);
      assert.equal(inBand, settled.length, "precondition: measured speed stays in 64..76");
      assert.equal(c.unexplained, 0, `${c.unexplained} face switches not explained by crossing 64/76`);
    }));
});
