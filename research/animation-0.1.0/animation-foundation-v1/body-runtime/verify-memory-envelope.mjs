import { performance } from "node:perf_hooks";
import * as T from "three";
import { MeshBVH } from "three-mesh-bvh";
import { createSurfaceQuery } from "./surface-query.mjs";
const n = Number(process.argv[2] ?? 20000),
  nt = Number(process.argv[3] ?? 40000);
if (
  !Number.isSafeInteger(n) ||
  !Number.isSafeInteger(nt) ||
  n < 100 ||
  n > 100000 ||
  nt < 1 ||
  nt > 200000
)
  throw new Error(
    "Bounded integer sizes required: vertices 100..100000, triangles 1..200000",
  );
if (typeof global.gc !== "function")
  throw new Error("Run with node --expose-gc");
const samples = [];
const snap = (label) => {
  const m = process.memoryUsage();
  samples.push({ label, ...m, time: performance.now() });
  return m;
};
const g = new T.BufferGeometry(),
  p = new Float32Array(n * 3),
  si = new Uint16Array(n * 4),
  sw = new Float32Array(n * 4),
  ix = new Uint32Array(nt * 3),
  w = Math.floor(Math.sqrt(n)),
  h = Math.floor(n / w);
const boneOf = new Int32Array(n);
for (let i = 0; i < n; i++) {
  const x = (i % w) / w,
    y = Math.floor(i / w) / h;
  p.set([x, y, 0.03 * Math.sin(x * 10) * Math.cos(y * 10)], i * 3);
  const mode = x < 0.3 ? 0 : x < 0.6 ? 1 : 2;
  boneOf[i] = mode < 2 ? mode : -1;
  si[i * 4] = 0;
  si[i * 4 + 1] = 1;
  sw[i * 4] = mode === 0 ? 1 : mode === 1 ? 0 : 0.5;
  sw[i * 4 + 1] = 1 - sw[i * 4];
}
let mixed = 0,
  rigid = 0;
const mixedVertices = new Set(),
  rigidBones = new Set();
for (let t = 0; t < nt; t++) {
  const cell = Math.floor(t / 2) % ((w - 1) * (h - 1)),
    a = Math.floor(cell / (w - 1)) * w + (cell % (w - 1)),
    tri = t % 2 ? [a + 1, a + w + 1, a + w] : [a, a + 1, a + w];
  ix.set(tri, t * 3);
  if (boneOf[tri[0]] >= 0 && tri.every((i) => boneOf[i] === boneOf[tri[0]])) {
    rigid++;
    rigidBones.add(boneOf[tri[0]]);
  } else {
    mixed++;
    tri.forEach((i) => mixedVertices.add(i));
  }
}
g.setAttribute("position", new T.BufferAttribute(p, 3));
g.setAttribute("skinIndex", new T.BufferAttribute(si, 4));
g.setAttribute("skinWeight", new T.BufferAttribute(sw, 4));
g.setIndex(new T.BufferAttribute(ix, 1));
const skin = new T.SkinnedMesh(
    g,
    new T.MeshBasicMaterial({ side: T.DoubleSide }),
  ),
  b = new T.Bone(),
  c = new T.Bone();
b.add(c);
skin.add(b);
skin.bind(new T.Skeleton([b, c]));
skin.updateMatrixWorld(true);
const borrowed = new Set([
  p.buffer,
  si.buffer,
  sw.buffer,
  ix.buffer,
  skin.skeleton.boneMatrices.buffer,
]);
let records = [];
class TrackedBVH extends MeshBVH {
  constructor(...args) {
    snap("before-bvh");
    super(...args);
    records.push(this);
    snap("after-bvh");
  }
}
for (let i = 0; i < 3; i++) global.gc();
const baseline = snap("before-query");
const start = performance.now();
let q = createSurfaceQuery({
  THREE: T,
  MeshBVH: TrackedBVH,
  skin,
  assertCurrent() {},
});
const elapsed = performance.now() - start;
const built = snap("built");
const buffers = new Set(),
  seen = new Set();
function visit(x) {
  if (!x || typeof x !== "object" || seen.has(x)) return;
  seen.add(x);
  if (x instanceof ArrayBuffer || x instanceof SharedArrayBuffer) {
    if (!borrowed.has(x)) buffers.add(x);
    return;
  }
  if (ArrayBuffer.isView(x)) {
    visit(x.buffer);
    return;
  }
  for (const v of Object.values(x)) visit(v);
}
records.forEach(visit);
const reachableOwnedBytes = [...buffers].reduce((a, b) => a + b.byteLength, 0);
const partitionExtras = q.diagnostics.rigidGroups
  ? 4 * rigid + 4 * mixed + 12 * mixed + 4 * mixedVertices.size
  : 0;
const accountedTypedBytes = reachableOwnedBytes + partitionExtras;
const residentBound = q.diagnostics.residentUpperBoundBytes;
const lastBVHRootBytes = records.at(-1)._roots.at(-1).byteLength;
for (let i = 0; i < 3; i++) global.gc();
const liveGC = snap("live-after-gc");
const releaseStart = performance.now();
q.dispose();
q = null;
records = [];
buffers.clear();
seen.clear();
const releaseMs = performance.now() - releaseStart;
snap("disposed-before-gc");
for (let i = 0; i < 3; i++) global.gc();
snap("disposed-after-gc");
{
  let tiny = new T.BoxGeometry(),
    tinyTree = new MeshBVH(tiny);
  tiny.dispose();
  tiny = null;
  tinyTree = null;
}
for (let i = 0; i < 3; i++) global.gc();
snap("after-replacing-upstream-build-cache");
g.dispose();
skin.material.dispose();
skin.skeleton.dispose();
console.log(
  JSON.stringify({
    n,
    triangles: nt,
    rigid,
    mixed,
    rigidGroups: rigidBones.size,
    dynamicVertices: mixedVertices.size,
    buildMs: elapsed,
    releaseMs,
    lastBVHRootBytes,
    reachableOwnedBytes,
    partitionExtras,
    accountedTypedBytes,
    residentBound,
    reservation: 32 * 1024 * 1024,
    deltaBuiltArrayBuffers: built.arrayBuffers - baseline.arrayBuffers,
    deltaLiveGCArrayBuffers: liveGC.arrayBuffers - baseline.arrayBuffers,
    samples,
    maxRSSKiB: process.resourceUsage().maxRSS,
    scope:
      "Memory snapshots are not exact instantaneous peak. Owned typed buffers exclude borrowed source arrays; partition extras calculated from exact topology.",
  }),
);
