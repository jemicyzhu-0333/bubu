// Shared helpers for grok-regression tests. Test-only; no product code.
import * as T from "three";
import { fixture } from "../animation-foundation-v1/body-runtime/fixture.mjs";

export { fixture };

// Client point for a skin-local coordinate (follows the body while it moves).
export function skinPoint(f, x, y) {
  f.h.body.skin.updateMatrixWorld(true);
  const p = f.h.body.skin.localToWorld(new T.Vector3(x, y, 0)).project(f.camera);
  return { clientX: (p.x + 1) * 192, clientY: (1 - p.y) * 192 };
}

export async function withFixture(run, options) {
  const f = await fixture(options);
  try {
    return await run(f);
  } finally {
    f.h.dispose();
  }
}

// Number of value changes in a sequence.
export const switches = (values) =>
  values.reduce((n, v, i, a) => n + (i && v !== a[i - 1] ? 1 : 0), 0);
