// F3 (G-20261112-002, owner decision 2026-11-12): with reduced motion on, V2 keeps
// drag/pet interaction and only tones down motion. No fallback to 2D.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { FoundationPool } from "../animation-foundation-v1/integration/foundation-host.mjs";

function head(actor) {
  const p = actor.f.h.body.skin.localToWorld(new T.Vector3(-0.2, 1.4, 0)).project(actor.f.camera);
  return { clientX: (p.x + 1) * 192, clientY: (1 - p.y) * 192 };
}

describe("grok-regression F3: reduced motion keeps interaction", () => {
  test("petting and drag work while every frame has reducedMotion=true", async () => {
    const pool = new FoundationPool();
    try {
      const actor = await pool.create({ equipmentMode: "bare" });
      const rm = { reducedMotion: true };
      actor.step(0.1, rm);
      actor.f.emit("pointerdown", 0.15, head(actor));
      actor.step(0.15, rm);
      actor.step(0.8, rm);
      assert.equal(actor.f.h.state.mode, "petting", "long press on head should pet");
      const p = head(actor);
      p.clientX += 90;
      p.clientY -= 50;
      actor.f.emit("pointermove", 0.85, p);
      actor.step(0.85, rm);
      assert.equal(actor.f.h.state.mode, "drag", "pulling away should pick up");
      actor.dispose();
    } finally {
      pool.dispose();
    }
  });
});
