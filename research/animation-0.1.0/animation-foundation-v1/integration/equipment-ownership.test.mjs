import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { FoundationActor, FoundationPool } from "./foundation-host.mjs";
import { SceneBudget } from "./scene-budget.mjs";
import { FIXTURES } from "../configuration/fixtures/index.mjs";
import { disposeAssets } from "./asset-fixtures.mjs";
function asset(label, throwGeometry = false) {
  const counts = { geometry: 0, material: 0, texture: 0 };
  const tex = new T.Texture(),
    mat = new T.MeshBasicMaterial({ map: tex }),
    g = new T.BufferGeometry().setAttribute(
      "position",
      new T.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
    ),
    a = new T.Group();
  a.add(new T.Mesh(g, mat));
  g.addEventListener("dispose", () => {
    counts.geometry++;
    if (throwGeometry) throw Error("geometry observer " + label);
  });
  mat.addEventListener("dispose", () => counts.material++);
  tex.addEventListener("dispose", () => counts.texture++);
  return { a, counts };
}
function actor(load) {
  const a = Object.create(FoundationActor.prototype);
  Object.assign(a, {
    disposed: false,
    f: { h: { facePort: null } },
    body: { authoredFaces: [] },
    generation: 0,
    pendingEquips: 0,
    mounts: new Map(),
    handles: [],
    equipLease: null,
    strategy: null,
    mountRoot: new T.Group(),
    frame: { revision: 0 },
    budget: new SceneBudget(),
    anchors: { getTransform: () => new T.Matrix4() },
    bindings: {
      describe: () => ({ bytes: 100, calibration: new T.Matrix4() }),
      load,
    },
    effects: { enter: () => ({ dispose() {} }) },
  });
  return a;
}

function empty(a) {
  assert.equal(a.pendingEquips, 0);
  assert.equal(a.budget.diagnostics().claimedBytes, 0);
  assert.equal(a.budget.diagnostics().pendingReservations, 0);
  assert.equal(a.mountRoot.children.length, 0);
  assert.equal(a.mounts.size, 0);
}
function released(x) {
  assert.deepEqual(x.counts, { geometry: 1, material: 1, texture: 1 });
}
function errors(error) {
  return [error, ...(error.errors ?? []).flatMap(errors)];
}
test("attachment is owned before a childadded observer can fail", async () => {
  const x = asset("mount"),
    a = actor(async () => x.a);
  a.mountRoot.addEventListener("childadded", () => {
    throw Error("mount observer");
  });
  await assert.rejects(a.equip(FIXTURES[0]), /mount observer/);
  empty(a);
  released(x);
});
test("committed attachments are released exactly once after effect creation fails", async () => {
  const xs = [asset("first"), asset("second")];
  let n = 0;
  const a = actor(async () => xs[n++].a);
  a.effects.enter = () => {
    throw Error("effect allocation");
  };
  await assert.rejects(a.equip(FIXTURES[0]), /effect allocation/);
  empty(a);
  xs.forEach(released);
});
test("geometry disposal failure does not skip materials textures or other assets", async () => {
  const xs = [asset("first", true), asset("second")];
  let n = 0;
  const a = actor(async () => xs[n++].a);
  const primary = Error("effect allocation");
  a.effects.enter = () => {
    throw primary;
  };
  await assert.rejects(a.equip(FIXTURES[0]), (e) => {
    assert(errors(e).includes(primary));
    assert(errors(e).some((x) => x.message === "geometry observer first"));
    return true;
  });
  empty(a);
  xs.forEach(released);
  a.remove();
  xs.forEach(released);
});
test("successful ownership transfer survives until explicit removal", async () => {
  const x = asset("success"),
    a = actor(async () => x.a);
  const result = await a.equip(FIXTURES[4]);
  assert.equal(result.stale, false);
  assert.equal(a.pendingEquips, 0);
  assert.equal(a.mounts.size, 1);
  assert.equal(a.budget.diagnostics().pendingReservations, 0);
  assert(a.budget.diagnostics().residentBytes > 0);
  assert.equal(x.counts.geometry, 0);
  a.remove();
  empty(a);
  released(x);
});
test("two invalidated pending loads release late assets once and retain reservations until settled", async () => {
  let r1,
    r2,
    n = 0;
  const a = actor(
    () =>
      new Promise((r) => {
        if (n++ === 0) r1 = r;
        else r2 = r;
      }),
  );
  const x = asset("late1"),
    y = asset("late2");
  const p1 = a.equip(FIXTURES[4]),
    p2 = a.equip(FIXTURES[4]);
  a.remove();
  assert.equal(a.pendingEquips, 2);
  assert.equal(a.budget.diagnostics().pendingReservations, 2);
  r1(x.a);
  r2(y.a);
  const results = await Promise.all([p1, p2]);
  assert(results.every((x) => x.stale));
  empty(a);
  released(x);
  released(y);
});
test("partial attachment then late load rejection cleans pending ownership after generation changes", async () => {
  let rejectSecond,
    calls = 0;
  const x = asset("partial"),
    a = actor(() =>
      ++calls === 1
        ? Promise.resolve(x.a)
        : new Promise((resolve, reject) => (rejectSecond = reject)),
    );
  const request = a.equip(FIXTURES[0]);
  while (!rejectSecond) await Promise.resolve();
  a.remove();
  rejectSecond(Error("late load failure"));
  await assert.rejects(request, /late load failure/);
  empty(a);
  released(x);
});
test("batch disposal deduplicates shared owned geometry material and texture", () => {
  const x = asset("shared"),
    clone = x.a.clone(true);
  disposeAssets([x.a, clone, x.a]);
  released(x);
});
test("pool dispose during actual actor construction releases reservations after rejection", async () => {
  const pool = new FoundationPool(),
    pending = pool.create();
  pool.dispose();
  assert.equal(pool.diagnostics().pending, 1);
  assert(pool.diagnostics().budget.pendingReservations > 0);
  await assert.rejects(pending);
  const d = pool.diagnostics();
  assert.equal(d.pending, 0);
  assert.equal(d.actors, 0);
  assert.equal(d.budget.claimedBytes, 0);
  assert.equal(d.budget.pendingReservations, 0);
});
test("reentrant remove during attach or effect creation cancels staged ownership", async () => {
  for (const stage of ["attach", "effect"]) {
    const x = asset(stage);
    const a = actor(async () => x.a);
    let removed = false;
    let effectDisposed = 0;
    if (stage === "attach") {
      a.mountRoot.addEventListener("childadded", () => {
        if (!removed) {
          removed = true;
          a.remove();
        }
      });
    } else {
      a.effects.enter = () => {
        a.remove();
        return {
          dispose() {
            effectDisposed++;
          },
        };
      };
    }
    const result = await a.equip(FIXTURES[4]);
    assert.equal(result.stale, true);
    empty(a);
    released(x);
    assert.equal(effectDisposed, stage === "effect" ? 1 : 0);
  }
});
test("frame failure retains its original error when actor disposal also throws", () => {
  const original = Error("frame failed"),
    cleanup = Error("dispose failed");
  const a = {
    assertActive() {},
    f: { doc: { hidden: false }, h: { resume() {} } },
    strategy: null,
    frame: {
      step() {
        throw original;
      },
    },
    dispose() {
      throw cleanup;
    },
  };
  assert.throws(
    () => FoundationActor.prototype.step.call(a, 1),
    (error) => {
      assert(errors(error).includes(original));
      assert(errors(error).includes(cleanup));
      return true;
    },
  );
});
test("observer-started replacement equip is not cleared by the older stale request", async () => {
  for (const stage of ["attach", "effect"]) {
    const oldAsset = asset("old"),
      newAsset = asset("new");
    let loads = 0,
      replacement,
      started = false,
      oldEffectDisposals = 0;
    const a = actor(async () => (loads++ === 0 ? oldAsset.a : newAsset.a));
    const replace = () => {
      if (!started) {
        started = true;
        replacement = a.equip(FIXTURES[4]);
      }
    };
    if (stage === "attach") a.mountRoot.addEventListener("childadded", replace);
    else
      a.effects.enter = () => {
        const isOld = !started;
        replace();
        return {
          dispose() {
            if (isOld) oldEffectDisposals++;
          },
        };
      };
    const oldResult = await a.equip(FIXTURES[4]);
    const newResult = await replacement;
    assert.equal(oldResult.stale, true);
    assert.equal(newResult.stale, false);
    assert.equal(a.pendingEquips, 0);
    assert.equal(a.mounts.size, 1);
    assert.equal([...a.mounts.values()][0].asset, newAsset.a);
    assert.equal(a.mountRoot.children.length, 1);
    assert.equal(a.budget.diagnostics().claims, 1);
    released(oldAsset);
    assert.equal(newAsset.counts.geometry, 0);
    assert.equal(oldEffectDisposals, stage === "effect" ? 1 : 0);
    a.remove();
    a.remove();
    empty(a);
    released(newAsset);
  }
});
