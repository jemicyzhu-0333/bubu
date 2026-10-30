import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { admitAsset } from "./resource-admission.mjs";

function mesh(array = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])) {
  const geometry = new T.BufferGeometry();
  geometry.setAttribute("position", new T.BufferAttribute(array, 3));
  return new T.Mesh(geometry, new T.MeshBasicMaterial());
}
test("admission rejects non-finite geometry, transforms and out-of-range indices", () => {
  const a = mesh();
  a.geometry.attributes.position.array[0] = NaN;
  assert.throws(() => admitAsset(a), /Non-finite/);
  a.geometry.attributes.position.array[0] = 0;
  a.position.x = Infinity;
  assert.throws(() => admitAsset(a), /transform/);
  a.position.x = 0;
  a.geometry.setIndex([0, 1, 3]);
  assert.throws(() => admitAsset(a), /triangle index/);
  a.geometry.dispose(); a.material.dispose();
});
test("a short attribute view cannot hide a large retained backing buffer", () => {
  const a = mesh(new Float32Array(new ArrayBuffer(16000004), 0, 9));
  assert.throws(() => admitAsset(a), /budget/);
  a.geometry.dispose(); a.material.dispose();
});
test("overlapping attribute views account their backing buffer once", () => {
  const buffer = new ArrayBuffer(108);
  const a = mesh(new Float32Array(buffer, 0, 9));
  a.geometry.setAttribute("normal", new T.BufferAttribute(new Float32Array(buffer, 0, 9), 3));
  assert.equal(admitAsset(a).bytes, 108);
  a.geometry.dispose(); a.material.dispose();
});
