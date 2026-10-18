import fs from "node:fs";
import assert from "node:assert/strict";
import * as T from "three";
import { loadGLB, disposeAsset } from "../../integration/asset-fixtures.mjs";
import { bakeAccessory } from "../asset-admission.mjs";
import { createThinSurfaceMapper } from "./thin-surface-mapper.mjs";
const coarse = JSON.parse(
    fs.readFileSync(new URL("./cape-coarse.json", import.meta.url)),
  ),
  binding = JSON.parse(
    fs.readFileSync(new URL("./cape-binding.json", import.meta.url)),
  );
let raw,
  parts = [],
  mapper;
let maxError = 0,
  checks = 0;
const a = new T.Vector3(),
  b = new T.Vector3(),
  c = new T.Vector3(),
  e = new T.Vector3(),
  n = new T.Vector3(),
  v = new T.Vector3(),
  expected = new T.Vector3();
try {
  raw = await loadGLB(
    new URL(
      "../../../wearable-approved-round5/accessory-expansion/models/07-cape.glb",
      import.meta.url,
    ),
  );
  parts = bakeAccessory(raw);
  mapper = createThinSurfaceMapper({
    indices: coarse.indices,
    vertexCount: coarse.positions.length / 3,
  });
  const targets = binding.bindings.map((def) => {
    const attribute = parts.find((p) => p.name === def.name).geometry.attributes
      .position;
    mapper.bind(def.records, attribute);
    return { def, attribute };
  });
  for (let pose = 0; pose < 5; pose++) {
    const points = Float32Array.from(coarse.positions);
    for (let i = 0; i < points.length; i += 3) {
      points[i] += 0.01 * pose * Math.sin(points[i + 1]);
      points[i + 2] += 0.007 * pose * Math.cos(points[i]);
    }
    mapper.prepare(points);
    mapper.apply();
    for (const { def, attribute } of targets)
      for (let i = 0; i < def.vertices; i++) {
        const r = def.records,
          k = i * 7,
          j = r[k] * 3;
        a.fromArray(points, coarse.indices[j] * 3);
        b.fromArray(points, coarse.indices[j + 1] * 3);
        c.fromArray(points, coarse.indices[j + 2] * 3);
        e.subVectors(b, a).normalize();
        new T.Triangle(a, b, c).getNormal(n);
        v.crossVectors(n, e);
        expected
          .copy(a)
          .multiplyScalar(r[k + 1])
          .addScaledVector(b, r[k + 2])
          .addScaledVector(c, r[k + 3])
          .addScaledVector(e, r[k + 4])
          .addScaledVector(v, r[k + 5])
          .addScaledVector(n, r[k + 6]);
        maxError = Math.max(
          maxError,
          expected.distanceTo(
            new T.Vector3().fromBufferAttribute(attribute, i),
          ),
        );
        checks++;
      }
  }
  assert(maxError < 1e-6);
  const report = {
    scope:
      "Fast mapper against independent Three vector reference on five bounded deformations; not physical/contact acceptance",
    checks,
    maxError,
  };
  fs.writeFileSync(
    new URL("./mapper-evidence.json", import.meta.url),
    JSON.stringify(report, null, 2),
  );
  console.log(report);
} finally {
  mapper?.dispose();
  for (const p of parts) p.geometry.dispose();
  if (raw) disposeAsset(raw);
}
