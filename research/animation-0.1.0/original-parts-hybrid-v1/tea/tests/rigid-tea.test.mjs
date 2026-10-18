import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRigidTeaController } from "../src/rigid-tea.mjs";
import { sample } from "../src/timeline.mjs";
const read = (n) =>
  JSON.parse(
    fs.readFileSync(new URL("../inputs/" + n + ".json", import.meta.url)),
  );
const args = {
  config: read("rigid-config"),
  hold: read("hold-fit"),
  sip: read("sip-fit"),
};
const c = createRigidTeaController(args);
function rigid(m) {
  const e = m.elements;
  assert.ok(e.every(Number.isFinite));
  assert.ok(Math.abs(m.determinant() - 1) < 1e-12);
  for (let a = 0; a < 3; a++)
    for (let b = 0; b < 3; b++) {
      let d = 0;
      for (let i = 0; i < 3; i++) d += e[a * 4 + i] * e[b * 4 + i];
      assert.ok(Math.abs(d - (a === b ? 1 : 0)) < 1e-12);
    }
}
test("1001 normal and cancelled samples are proper rigid transforms", () => {
  let n = 0;
  for (let i = 0; i < 271; i++) {
    for (const m of Object.values(c.sample(i / 30).matrices)) rigid(m);
    n++;
  }
  for (const cancelAt of [0, 0.2, 0.8, 1.3, 2.5, 3.8, 5.5, 6.7, 7.5, 8.5])
    for (let i = 0; i < 73; i++) {
      for (const m of Object.values(
        c.sample(cancelAt + i / 60, { cancelAt }).matrices,
      ))
        rigid(m);
      n++;
    }
  assert.equal(n, 1001);
});
test("rest endpoints exactly identity and cup hidden", () => {
  for (const t of [0, 8.1, 9, 100]) {
    const r = c.sample(t);
    for (const m of Object.values(r.matrices))
      assert.deepEqual(
        m.elements,
        [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      );
    assert.equal(r.cup.scale, 0);
  }
});
test("deterministic, input isolation, no internal time", () => {
  const x = c.sample(3);
  c.sample(8);
  assert.deepEqual(c.sample(3), x);
  const cc = createRigidTeaController(args),
    before = cc.sample(3);
  args.config.hands.handL.inset = 8;
  assert.deepEqual(cc.sample(3), before);
  args.config.hands.handL.inset = 0.035;
});
test("entry/lift/exit continuous around boundaries", () => {
  for (const t of [1.2, 1.5, 2, 3.4, 4.8, 6.2, 6.6, 6.9, 8.1]) {
    const a = c.sample(t - 1e-6),
      b = c.sample(t + 1e-6);
    for (const n of ["handL", "handR"])
      assert.ok(
        Math.max(
          ...a.matrices[n].elements.map((v, i) =>
            Math.abs(v - b.matrices[n].elements[i]),
          ),
        ) < 1e-8,
      );
  }
});
test("cancel starts continuously and finishes at rest", () => {
  for (const cancelAt of [0.2, 0.8, 1.3, 2.5, 3.8, 5.5, 6.7, 7.5, 8.5]) {
    const a = c.sample(cancelAt),
      b = c.sample(cancelAt, { cancelAt });
    assert.deepEqual(a.matrices, b.matrices);
    const end = c.sample(cancelAt + 1.2, { cancelAt });
    assert.equal(end.done, true);
    assert.equal(end.cup.scale, 0);
    for (const m of Object.values(end.matrices))
      assert.equal(m.determinant(), 1);
  }
});
test("reduced motion has no prop or limb change", () => {
  const s = c.sample(4, { reducedMotion: true });
  assert.equal(s.done, true);
  assert.equal(s.cup.scale, 0);
  assert.equal(s.faceRequestAt, null);
});
test("reject invalid times and cancellation options", () => {
  for (const t of [-1, NaN, Infinity]) assert.throws(() => c.sample(t));
  for (const cancelAt of [-1, NaN, Infinity])
    assert.throws(() => c.sample(0, { cancelAt }));
});
test("reject malformed config and options before returning transforms", () => {
  for (const mutate of [
    (x) => (x.config.depth = NaN),
    (x) => (x.config.carrier.height = []),
    (x) => (x.config.carrier.radius = [1]),
    (x) => (x.config.carrier.height[1] = x.config.carrier.height[0]),
    (x) => (x.config.hands.handL.root = [0, 0, NaN]),
    (x) => (x.config.hands.handR.cupLocalCorrection = [0, Infinity, 0]),
    (x) => (x.hold.cupCenter = [NaN, 0, 0]),
    (x) => (x.sip.parameters.cupTiltX = undefined),
  ]) {
    const x = structuredClone(args);
    mutate(x);
    assert.throws(() => createRigidTeaController(x));
  }
  for (const opt of [
    null,
    [],
    { foo: 1 },
    { cancelAt: Infinity },
    { reducedMotion: 1 },
  ])
    assert.throws(() => c.sample(0, opt));
});
import {
  createTeaSceneResources,
  teaLimbOverrides,
} from "../src/scene-resources.mjs";
test("cup owns only its prop resources and cleans up idempotently", () => {
  const r = createTeaSceneResources();
  r.apply(c.sample(4));
  assert.equal(r.root.children.length, 3);
  assert.equal(r.root.visible, true);
  r.apply(c.sample(9));
  assert.equal(r.root.visible, false);
  r.dispose();
  r.dispose();
  assert.equal(r.root.children.length, 0);
  assert.throws(() => r.apply(c.sample(0)));
  assert.ok(teaLimbOverrides(c.sample(1))["Bubu_hand-left"].isMatrix4);
});
