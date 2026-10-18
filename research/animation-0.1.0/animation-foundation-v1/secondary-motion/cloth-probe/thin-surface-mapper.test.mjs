import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { createThinSurfaceMapper } from "./thin-surface-mapper.mjs";
const vertices = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  record = [0, 0.2, 0.3, 0.5, 0.01, 0.02, 0.03];
test("thin surface reconstructs local offsets and follows rigid motion", () => {
  const m = createThinSurfaceMapper({ indices: [0, 1, 2], vertexCount: 3 }),
    a = new T.BufferAttribute(new Float64Array(3), 3);
  m.bind(record, a);
  m.prepare(vertices);
  m.apply();
  assert(
    Math.hypot(a.getX(0) - 0.31, a.getY(0) - 0.52, a.getZ(0) - 0.03) < 1e-8,
  );
  const transform = new T.Matrix4()
      .makeRotationY(0.4)
      .setPosition(0.3, 0.1, -0.2),
    moved = vertices.slice();
  for (let i = 0; i < 3; i++)
    new T.Vector3()
      .fromArray(vertices, i * 3)
      .applyMatrix4(transform)
      .toArray(moved, i * 3);
  const expected = new T.Vector3(0.31, 0.52, 0.03).applyMatrix4(transform);
  m.prepare(moved);
  m.apply();
  assert(expected.distanceTo(new T.Vector3().fromBufferAttribute(a, 0)) < 1e-7);
  m.dispose();
  assert.equal(m.diagnostics().ownedBytes, 0);
  assert.throws(() => m.apply(), /disposed/);
});
test("failed particle snapshot cannot publish partial or stale positions", () => {
  const m = createThinSurfaceMapper({ indices: [0, 1, 2], vertexCount: 3 }),
    a = new T.BufferAttribute(new Float64Array(3), 3);
  m.bind(record, a);
  m.prepare(vertices);
  m.apply();
  const before = a.array.slice();
  assert.throws(() => m.prepare(new Float32Array(9)), /Degenerate/);
  assert.throws(() => m.apply(), /Prepare/);
  assert.deepEqual(a.array, before);
  m.dispose();
});
test("mapper snapshots records, rejects alias and external target changes", () => {
  const m = createThinSurfaceMapper({ indices: [0, 1, 2], vertexCount: 3 }),
    a = new T.BufferAttribute(new Float64Array(3), 3),
    records = record.slice();
  m.bind(records, a);
  records.fill(NaN);
  assert.throws(() => m.bind(record, a), /Duplicate/);
  m.prepare(vertices);
  m.apply();
  assert(a.array.every(Number.isFinite));
  a.needsUpdate = true;
  assert.throws(() => m.apply(), /changed/);
  m.dispose();
});

test("detached output fails before publishing any bound target", () => {
  const m = createThinSurfaceMapper({ indices: [0, 1, 2], vertexCount: 3 }),
    first = new T.BufferAttribute(new Float32Array(3), 3),
    second = new T.BufferAttribute(new Float32Array(3), 3);
  m.bind(record, first);
  m.bind(record, second);
  m.prepare(vertices);
  const before = first.array.slice(),
    version = first.version;
  structuredClone(second.array.buffer, { transfer: [second.array.buffer] });
  assert.throws(() => m.apply(), /target changed/);
  assert.deepEqual(first.array, before);
  assert.equal(first.version, version);
  m.dispose();
});
test("overlapping byte ranges reject but disjoint packed outputs remain valid", () => {
  const m = createThinSurfaceMapper({ indices: [0, 1, 2], vertexCount: 3 }),
    buffer = new ArrayBuffer(24),
    a = new T.BufferAttribute(new Float32Array(buffer, 0, 3), 3),
    b = new T.BufferAttribute(new Float32Array(buffer, 12, 3), 3),
    overlap = new T.BufferAttribute(new Float32Array(buffer, 4, 3), 3);
  m.bind([0, 1, 0, 0, 0, 0, 0], a);
  assert.throws(() => m.bind(record, overlap), /Duplicate/);
  m.bind([0, 0, 1, 0, 0, 0, 0], b);
  m.prepare(vertices);
  m.apply();
  assert.deepEqual([...a.array], [0, 0, 0]);
  assert.deepEqual([...b.array], [1, 0, 0]);
  m.dispose();
});

test("shared-memory particle snapshots require a separate synchronization contract", () => {
  const m = createThinSurfaceMapper({ indices: [0, 1, 2], vertexCount: 3 });
  assert.throws(
    () => m.prepare(new Float32Array(new SharedArrayBuffer(36))),
    /Invalid particle/,
  );
  m.dispose();
});
