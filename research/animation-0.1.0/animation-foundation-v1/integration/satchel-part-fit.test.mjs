import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import * as T from "three";
import { FoundationPool } from "./foundation-host.mjs";
import { fitSatchelParts } from "./satchel-part-fit.mjs";
import { prepareD2Bindings } from "./binding-provider.mjs";
import { admitAsset } from "./resource-admission.mjs";
import { loadGLB, revised, correctedSatchel, sha256, disposeAsset } from "./asset-fixtures.mjs";
import { createCompleteOutfit } from "../configuration/fixtures/complete-outfit.mjs";

async function withAsset(run) {
  const pool = new FoundationPool(); let asset;
  try {
    const actor = await pool.create();
    asset = await actor.bindings.load(createCompleteOutfit().mounts.find(m => m.id === "satchel"));
    await run(asset);
  } finally { if (asset) disposeAsset(asset); pool.dispose(); }
}

test("satchel assembly preserves every buffer, rigid shape, flap/catch relation and support pivot", () => withAsset(asset => {
  const before = new Map(asset.children.map(m => [m, {
    attributes: Object.fromEntries(Object.entries(m.geometry.attributes).map(([k, a]) => [k, a.array.slice()])),
    indices: m.geometry.index.array.slice(), material: m.material,
  }]));
  const pouch = asset.getObjectByName("satchel_pouch");
  const pivot = new T.Vector3().fromBufferAttribute(pouch.geometry.attributes.position, 255);
  fitSatchelParts(asset);
  assert(pivot.clone().applyMatrix4(pouch.matrix).distanceTo(pivot) < 1e-12);
  for (const mesh of asset.children) {
    const saved = before.get(mesh), p = mesh.geometry.attributes.position;
    for (const [name, values] of Object.entries(saved.attributes))
      assert.deepEqual(mesh.geometry.attributes[name].array, values);
    assert.deepEqual(mesh.geometry.index.array, saved.indices);
    assert.equal(mesh.material, saved.material);
    if (mesh.name === "satchel_continuous_strap") assert(mesh.matrix.equals(new T.Matrix4()));
    else assert(mesh.matrix.equals(pouch.matrix));
    assert(Math.abs(mesh.matrix.determinant() - 1) < 1e-12);
    for (let i = 0; i < p.count; i++) for (let j = i + 1; j < p.count; j++) {
      const a = new T.Vector3().fromBufferAttribute(p, i), b = new T.Vector3().fromBufferAttribute(p, j);
      assert(Math.abs(a.distanceTo(b) - a.applyMatrix4(mesh.matrix).distanceTo(b.applyMatrix4(mesh.matrix))) < 1e-12);
    }
  }
  const matrices = asset.children.map(m => m.matrix.clone());
  assert.throws(() => fitSatchelParts(asset), /Unmodified/);
  assert(asset.children.every((m, i) => m.matrix.equals(matrices[i])));
}));

test("invalid final satchel part rejects before moving pouch or flap", () => withAsset(asset => {
  asset.getObjectByName("satchel_square_catch").geometry.index.array[0] = 9999;
  assert.throws(() => fitSatchelParts(asset), /Unmodified/);
  assert(asset.children.every(m => m.matrix.equals(new T.Matrix4())));
}));

test("satchel fit identity, renamed mounts, reset and motion use private persistent frames", async () => {
  const pool = new FoundationPool(), providers = [];
  try {
    const actor = await pool.create();
    for (const fitHash of ["a".repeat(64), "b".repeat(64)])
      providers.push(await prepareD2Bindings(actor.body, actor.anchors, admitAsset, {
        loadGLB, revised, correctedSatchel,
        sha256: url => String(url).endsWith("/satchel-part-fit.mjs") ? fitHash : sha256(url),
        readJSON: url => JSON.parse(fs.readFileSync(url)),
        digest: text => createHash("sha256").update(text).digest("hex"),
      }));
    const outfit = createCompleteOutfit(), satchel = outfit.mounts.find(m => m.id === "satchel");
    const halo = outfit.mounts.find(m => m.id === "halo");
    assert.notEqual(providers[0].contactFor(satchel, outfit).attachmentSHA256,
      providers[1].contactFor(satchel, outfit).attachmentSHA256);
    assert.equal(providers[0].contactFor(halo, outfit).attachmentSHA256,
      providers[1].contactFor(halo, outfit).attachmentSHA256);
    satchel.id = "renamed-bag";
    outfit.secondaryMotion.find(m => m.mountId === "satchel").mountId = satchel.id;
    await actor.equip(outfit);
    const mount = actor.mounts.get(satchel.id), pouch = mount.root.getObjectByName("satchel_pouch");
    const initial = pouch.matrix.clone(), rest = pouch.geometry.attributes.position.array.slice();
    assert(!initial.equals(new T.Matrix4()));
    for (let i = 0; i <= 30; i++) actor.step(i / 60);
    assert(pouch.matrix.equals(initial));
    actor.step(.6, { reducedMotion: true });
    assert.deepEqual(pouch.geometry.attributes.position.array, rest);
    actor.reset(); assert(pouch.matrix.equals(initial));
    await actor.equip(outfit);
    const next = actor.mounts.get(satchel.id).root.getObjectByName("satchel_pouch");
    assert.notEqual(next.geometry, pouch.geometry); assert(next.matrix.equals(initial));
  } finally { for (const p of providers) p.dispose(); pool.dispose(); }
});

test("failed satchel assembly releases real secondary buffers and retains the previous outfit", async () => {
  const pool = new FoundationPool();
  try {
    const actor = await pool.create(), outfit = createCompleteOutfit();
    await actor.equip(outfit);
    const previous = actor.mounts, bytes = actor.budget.diagnostics().claimedBytes;
    const roots = actor.mountRoot.children.slice(), original = actor.bindings, disposed = [];
    actor.bindings = { ...original, describe(...args) {
      const descriptor = original.describe(...args);
      if (descriptor.kind === "satchel") descriptor.fitParts = root => {
        root.traverse(mesh => { if (mesh.isMesh) {
          const count = { n: 0 }; disposed.push(count);
          mesh.geometry.addEventListener("dispose", () => count.n++);
        } });
        throw Error("satchel fit rejected");
      };
      return descriptor;
    } };
    await assert.rejects(actor.equip(outfit), /satchel fit rejected/);
    assert.equal(actor.mounts, previous);
    assert.deepEqual(actor.mountRoot.children, roots);
    assert.equal(actor.budget.diagnostics().claimedBytes, bytes);
    assert.equal(actor.budget.diagnostics().pendingReservations, 0);
    assert.equal(disposed.length, 4); assert(disposed.every(count => count.n === 1));
    actor.step(0);
  } finally { pool.dispose(); }
});
