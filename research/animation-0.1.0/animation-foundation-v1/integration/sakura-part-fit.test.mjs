import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { loadGLB, revised, bakeGroup, disposeAsset } from "./asset-fixtures.mjs";
import { fitSakuraParts } from "./sakura-part-fit.mjs";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { FoundationPool } from "./foundation-host.mjs";
import { prepareD2Bindings } from "./binding-provider.mjs";
import { correctedSatchel, sha256 } from "./asset-fixtures.mjs";
import { admitAsset } from "./resource-admission.mjs";
import { createCompleteOutfit } from "../configuration/fixtures/complete-outfit.mjs";

async function withAsset(run) {
  const source = await loadGLB(`${revised}/headwear-expansion/models/09-sakura-flower.glb`);
  let asset;
  try { asset = bakeGroup(source); await run(asset, source); }
  finally { if (asset) disposeAsset(asset); disposeAsset(source); }
}

test("private sakura hinges preserve source geometry, connection points and rigid part shape", () => withAsset(asset => {
  const before = new Map(asset.children.map(mesh => [mesh.name, {
    positions: mesh.geometry.attributes.position.array.slice(),
    normals: mesh.geometry.attributes.normal.array.slice(),
    indices: mesh.geometry.index.array.slice(),
    matrix: mesh.matrix.clone(),
  }]));
  fitSakuraParts(asset);
  for (const mesh of asset.children) {
    const original = before.get(mesh.name), p = mesh.geometry.attributes.position;
    assert.deepEqual(p.array, original.positions);
    assert.deepEqual(mesh.geometry.attributes.normal.array, original.normals);
    assert.deepEqual(mesh.geometry.index.array, original.indices);
    if (!["sakura_petal_1", "sakura_petal_2", "sakura_leaf_-019"].includes(mesh.name)) {
      assert(mesh.matrix.equals(original.matrix)); continue;
    }
    const pivot = new T.Vector3().fromBufferAttribute(p, mesh.name.startsWith("sakura_leaf") ? 185 : 0);
    assert(pivot.clone().applyMatrix4(mesh.matrix).distanceTo(pivot) < 1e-12);
    assert(Math.abs(mesh.matrix.determinant() - 1) < 1e-12);
    let maximum = 0;
    for (let i = 0; i < p.count; i++) {
      const a = new T.Vector3().fromBufferAttribute(p, i);
      maximum = Math.max(maximum, a.clone().applyMatrix4(mesh.matrix).distanceTo(a));
      for (let j = i + 1; j < p.count; j++) {
        const b = new T.Vector3().fromBufferAttribute(p, j);
        assert(Math.abs(a.distanceTo(b) - a.clone().applyMatrix4(mesh.matrix)
          .distanceTo(b.applyMatrix4(mesh.matrix))) < 1e-12);
      }
    }
    assert(maximum > .05 && maximum < .2);
  }
  const matrices = asset.children.map(m => m.matrix.clone());
  assert.throws(() => fitSakuraParts(asset), /Unmodified/);
  assert(asset.children.every((m, i) => m.matrix.equals(matrices[i])));
}));

test("invalid second petal rejects the complete fit before changing the first", () => withAsset(asset => {
  const first = asset.getObjectByName("sakura_petal_1");
  const second = asset.getObjectByName("sakura_petal_2");
  second.geometry.attributes.position.array[0] = NaN;
  assert.throws(() => fitSakuraParts(asset), /Unmodified/);
  assert(first.matrix.equals(new T.Matrix4()));
}));

test("contact identity includes the executable flower fit and loaded instances retain private poses", async () => {
  const pool = new FoundationPool(), providers = [], assets = [];
  try {
    const actor = await pool.create();
    for (const fitHash of ["a".repeat(64), "b".repeat(64)])
      providers.push(await prepareD2Bindings(actor.body, actor.anchors, admitAsset, {
        loadGLB, revised, correctedSatchel,
        sha256: url => String(url).endsWith("/sakura-part-fit.mjs") ? fitHash : sha256(url),
        readJSON: url => JSON.parse(fs.readFileSync(url)),
        digest: text => createHash("sha256").update(text).digest("hex"),
      }));
    const outfit = createCompleteOutfit(), flower = outfit.mounts.find(m => m.id === "sakura");
    const halo = outfit.mounts.find(m => m.id === "halo");
    assert.notEqual(providers[0].contactFor(flower, outfit).attachmentSHA256,
      providers[1].contactFor(flower, outfit).attachmentSHA256);
    assert.equal(providers[0].contactFor(halo, outfit).attachmentSHA256,
      providers[1].contactFor(halo, outfit).attachmentSHA256);
    for (let i = 0; i < 2; i++) assets.push(await providers[0].load(flower));
    const first = assets[0].getObjectByName("sakura_petal_1");
    const second = assets[1].getObjectByName("sakura_petal_1");
    assert(first.matrix.equals(second.matrix) && !first.matrix.equals(new T.Matrix4()));
    assert.notEqual(first.geometry, second.geometry);
    first.position.x += 1; first.updateMatrix();
    assert(!first.matrix.equals(second.matrix));
  } finally {
    for (const asset of assets) disposeAsset(asset);
    for (const provider of providers) provider.dispose();
    pool.dispose();
  }
});
