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

test("body-frame rest detail follows declared rigid motion and rejects stale invalid preparation", () => {
  const rest = new Float64Array(vertices),
    m = createThinSurfaceMapper({ indices: [0, 1, 2], vertexCount: 3, restPositions: rest }),
    a = new T.BufferAttribute(new Float64Array(3), 3);
  m.bind(record, a);
  assert.throws(() => m.apply(), /Prepare/);
  rest.fill(NaN); // Constructor owns its rest-frame snapshot.
  const q = new T.Quaternion().setFromEuler(new T.Euler(0.3, 0.4, -0.2)),
    transform = new T.Matrix4().makeRotationFromQuaternion(q).setPosition(0.3, 0.1, -0.2),
    moved = new Float64Array(vertices);
  for (let i = 0; i < 3; i++) new T.Vector3().fromArray(vertices, i * 3).applyMatrix4(transform).toArray(moved, i * 3);
  m.prepare(moved, q.toArray()); m.apply();
  assert(new T.Vector3(0.31, 0.52, 0.03).applyMatrix4(transform).distanceTo(new T.Vector3().fromBufferAttribute(a, 0)) < 1e-12);
  const before = a.array.slice();
  assert.throws(() => m.prepare(moved, [0, 0, 0, 2]), /Unit body rotation/);
  assert.throws(() => m.apply(), /Prepare/);
  assert.deepEqual(a.array, before);
  m.dispose(); m.dispose(); assert.equal(m.diagnostics().ownedBytes, 0);
});

test("0.5167 s cloth edge counterexample separates triangle-offset compression from particle displacement", () => {
  // Exact saved particle witness: source IDs 386, 389, 390, 387; render
  // vertices 2501 and 2502. This is a local regression, not cloth admission.
  const rest = new Float64Array([
    -.9196597933769226,.927685022354126,.34673628211021423,
    -.8764256834983826,.800865888595581,.4319722354412079,
    -.8795650005340576,.729067325592041,.43509942293167114,
    -.934258759021759,.8730856776237488,.35393112897872925,
  ]), moved = new Float64Array([
    -.9196597933769226,.927685022354126,.34673628211021423,
    -.8675514459609985,.8138205409049988,.46530529856681824,
    -.8737356662750244,.7516903281211853,.4821265935897827,
    -.932213306427002,.8797877430915833,.3684350848197937,
  ]), records = [
    0,.6069967357229676,.09360335172554961,.29939991255148285,0,0,-.006773193041787076,
    1,.5514614422110663,.36233606508728444,.08620249270164927,0,0,-.007279683749011349,
  ], ratios = [];
  for (const restPositions of [null, rest]) {
    const mapper = createThinSurfaceMapper({ indices:[0,1,2,0,2,3], vertexCount:4, restPositions }),
      attribute = new T.BufferAttribute(new Float64Array(6), 3);
    mapper.bind(records, attribute);
    mapper.prepare(rest); mapper.apply();
    const distance = () => new T.Vector3().fromBufferAttribute(attribute,0).distanceTo(new T.Vector3().fromBufferAttribute(attribute,1)),
      restLength = distance();
    assert(Math.abs(restLength-.004067021855285471)<1e-8);
    mapper.prepare(moved); mapper.apply(); ratios.push(distance()/restLength);
    mapper.dispose();
  }
  assert(ratios[0]<.8 && Math.abs(ratios[0]-.76195715)<1e-4);
  assert(ratios[1]>=.8 && Math.abs(ratios[1]-.91828453)<1e-4);
});
