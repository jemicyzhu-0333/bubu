/** Offline thin-surface binding proof. No canonical mesh is modified. */
import fs from "node:fs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as T from "three";
import { MeshBVH } from "three-mesh-bvh";
import { loadGLB, disposeAsset } from "../../integration/asset-fixtures.mjs";
import { bakeAccessory, geometryIdentity } from "../asset-admission.mjs";
const sha = (b) => createHash("sha256").update(b).digest("hex");
const coarseURL = new URL("./cape-coarse.json", import.meta.url),
  coarseBytes = fs.readFileSync(coarseURL),
  coarse = JSON.parse(coarseBytes);
const modelURL = new URL(
    "../../../wearable-approved-round5/accessory-expansion/models/07-cape.glb",
    import.meta.url,
  ),
  modelBytes = fs.readFileSync(modelURL);
assert.equal(
  sha(modelBytes),
  "e29010956b989a60e196472b2206e6c397b34f12f3b7092d67f53f189c128e21",
);
assert(
  coarse.positions.length / 3 <= 2048 && coarse.indices.length / 3 <= 4096,
);
const geometry = new T.BufferGeometry()
  .setAttribute("position", new T.Float32BufferAttribute(coarse.positions, 3))
  .setIndex(coarse.indices);
const bvh = new MeshBVH(geometry, { indirect: true });
let raw,
  parts = [];
const point = new T.Vector3(),
  tri = new T.Triangle(),
  tangent = new T.Vector3(),
  bitangent = new T.Vector3(),
  normal = new T.Vector3(),
  weights = new T.Vector3(),
  offset = new T.Vector3(),
  reconstructed = new T.Vector3(),
  hit = {};
const bindings = [];
let maxRestError = 0,
  maxOffset = 0,
  vertices = 0;
try {
  raw = await loadGLB(modelURL);
  parts = bakeAccessory(raw);
  for (const part of parts) {
    if (part.name === "cape_clasp") continue;
    assert(part.name.startsWith("cape_"));
    const position = part.geometry.attributes.position,
      records = [];
    vertices += position.count;
    assert(vertices <= 50000);
    for (let i = 0; i < position.count; i++) {
      point.fromBufferAttribute(position, i);
      assert(bvh.closestPointToPoint(point, hit));
      const face = hit.faceIndex,
        ix = geometry.index;
      // Keep the two opening sides and angular panels distinct. Rest reconstruction
      // alone cannot detect a wrong-face binding because offsets can hide it.
      let angle = Math.atan2(-point.z, point.x);
      if (angle < -Math.PI / 2) angle += Math.PI * 2;
      const u = (angle - (-Math.PI / 2 + 0.055)) / (Math.PI * 2 - 0.11);
      const expectedBand = Math.min(
        coarse.grid.cols - 1,
        Math.max(0, Math.floor(u * coarse.grid.cols)),
      );
      const actualBand = coarse.triangleColumns[face];
      assert(
        Math.abs(expectedBand - actualBand) <= 1,
        "Binding crossed a cloth panel or front opening",
      );
      tri.a.fromBufferAttribute(
        geometry.attributes.position,
        ix.getX(face * 3),
      );
      tri.b.fromBufferAttribute(
        geometry.attributes.position,
        ix.getX(face * 3 + 1),
      );
      tri.c.fromBufferAttribute(
        geometry.attributes.position,
        ix.getX(face * 3 + 2),
      );
      tangent.subVectors(tri.b, tri.a).normalize();
      tri.getNormal(normal);
      bitangent.crossVectors(normal, tangent).normalize();
      tri.getBarycoord(hit.point, weights);
      assert([...weights].every((v) => v >= -1e-6 && v <= 1 + 1e-6));
      offset.subVectors(point, hit.point);
      const d = [
        offset.dot(tangent),
        offset.dot(bitangent),
        offset.dot(normal),
      ];
      reconstructed
        .copy(tri.a)
        .multiplyScalar(weights.x)
        .addScaledVector(tri.b, weights.y)
        .addScaledVector(tri.c, weights.z)
        .addScaledVector(tangent, d[0])
        .addScaledVector(bitangent, d[1])
        .addScaledVector(normal, d[2]);
      maxRestError = Math.max(maxRestError, reconstructed.distanceTo(point));
      maxOffset = Math.max(maxOffset, offset.length());
      records.push(face, weights.x, weights.y, weights.z, ...d);
    }
    bindings.push({
      name: part.name,
      vertices: position.count,
      geometrySHA256: await geometryIdentity(part.geometry),
      records,
    });
  }
  assert(maxRestError < 1e-6);
  assert(
    maxOffset < 0.08,
    "Coarse surface is too far from approved render geometry",
  );
  const result = {
    schema: "bubu-thin-surface-binding/1",
    scope:
      "Offline rest reconstruction proof only; dynamic garment contact not admitted",
    sourceModelSHA256: sha(modelBytes),
    simulationSHA256: sha(coarseBytes),
    recordFields: [
      "triangle",
      "baryA",
      "baryB",
      "baryC",
      "tangentOffset",
      "bitangentOffset",
      "normalOffset",
    ],
    fixedParts: ["cape_clasp"],
    maxRestError,
    maxOffset,
    vertices,
    bindings,
  };
  fs.writeFileSync(
    new URL("./cape-binding.json", import.meta.url),
    JSON.stringify(result),
  );
  console.log({
    vertices,
    parts: bindings.length,
    maxRestError,
    maxOffset,
    sourceUnchanged: sha(fs.readFileSync(modelURL)) === sha(modelBytes),
  });
} finally {
  for (const p of parts) p.geometry.dispose();
  if (raw) disposeAsset(raw);
  geometry.dispose();
}
