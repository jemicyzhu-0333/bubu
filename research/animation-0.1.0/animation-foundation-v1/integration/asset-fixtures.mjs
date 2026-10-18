import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { fixture } from "../body-runtime/fixture.mjs";
import { createContractCheckedMixedBindingAdapter } from "../../bubu-external-assets-staging-20261018/.cache/clean-a/research/animation-0.1.0/original-parts-hybrid-v1/runtime/mixed-binding-contract.mjs";
import { SatchelAdapter } from "../../bubu-asset-physics-revision-20261018/existing-wearables/src/local-adapters/satchel-adapter.mjs";
export const workspace = path.resolve(
  fileURLToPath(new URL("../../", import.meta.url)),
);
export const reference = path.join(
  workspace,
  "bubu-external-assets-staging-20261018/.cache/clean-a",
);
export const research = path.join(reference, "research/animation-0.1.0");
export const revised = path.join(
  workspace,
  "bubu-asset-physics-revision-20261018",
);
export const source = path.join(
  research,
  "runtime-facepath05/fixtures/face-d2/asset.glb",
);
export const hybrid = path.join(
  research,
  "original-parts-hybrid-v1/geometry/bubu-hybrid-binding.glb",
);
export const sha256 = (p) =>
  createHash("sha256").update(fs.readFileSync(p)).digest("hex");
export async function loadGLB(p) {
  if (fs.statSync(p).size > 16000000)
    throw Error("Fixture encoded file budget exceeded");
  const loader = new GLTFLoader();
  loader.register((parser) => ({
    name: "CPUTextureMetadataOnly",
    async loadTexture(index) {
      const img = parser.json.images[parser.json.textures[index].source];
      await parser.getDependency("bufferView", img.bufferView);
      return new T.Texture();
    },
  }));
  const b = fs.readFileSync(p);
  if (b.readUInt32LE(0) !== 0x46546c67 || b.readUInt32LE(12) > b.length - 20)
    throw Error("Invalid GLB");
  const json = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString());
  if (
    (json.nodes?.length ?? 0) > 128 ||
    (json.textures?.length ?? 0) > 4 ||
    (json.accessors ?? []).reduce((n, a) => n + a.count, 0) > 1000000 ||
    (json.buffers ?? []).some((x) => x.uri || x.byteLength > 16000000) ||
    (json.images ?? []).some((x) => x.uri)
  )
    throw Error("GLB preflight budget or external resource rejection");
  return (
    await loader.parseAsync(
      b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
      "",
    )
  ).scene;
}
let sharedParts;
export async function createBody(options = {}) {
  if (
    sha256(source) !==
      "84ec5d8608f21e43bf06df26b8b2f81124909ebb39c77bb9cc153aca17319a3a" ||
    sha256(hybrid) !==
      "52a080d81606fbe92e9cd71593bd703f356eb50a0e1c74ccc34547a0db308e67"
  )
    throw Error("Unapproved body bytes");
  sharedParts ??= loadGLB(hybrid);
  const parts = await sharedParts;
  const f = await fixture(options);
  const owner = createContractCheckedMixedBindingAdapter({
    THREE: T,
    sourceSkin: f.h.body.skin,
    parts,
    assertSourceCurrent: () => f.h.owner.assertCurrent(),
    contract: JSON.parse(
      fs.readFileSync(
        path.join(
          research,
          "original-parts-hybrid-v1/geometry/binding-manifest.json",
        ),
      ),
    ),
    admittedSourceSHA256: sha256(source),
    candidateSHA256: sha256(hybrid),
  });
  return {
    f,
    owner,
    authoredFaces: options.authoredFaces ?? [],
    dispose() {
      owner.dispose();
      f.h.dispose();
    },
  };
}
export function bakeGroup(root, frame = new T.Matrix4()) {
  root.updateWorldMatrix(true, true);
  const result = new T.Group(),
    inv = frame.clone().invert();
  root.traverse((m) => {
    if (!m.isMesh) return;
    const geometry = m.geometry.clone();
    geometry.applyMatrix4(inv.clone().multiply(m.matrixWorld));
    const mesh = new T.Mesh(geometry, m.material.clone());
    mesh.name = m.name;
    result.add(mesh);
  });
  return result;
}
export async function correctedSatchel(body) {
  const raw = await loadGLB(
    path.join(
      workspace,
      "bubu-publication-20261018/research/animation-0.1.0/accessories-v1/03-satchel/satchel.glb",
    ),
  );
  let adapter;
  try {
    adapter = new SatchelAdapter({
      actorRoot: body.f.h.owner.root,
      parent: body.f.h.body.offset,
      asset: raw,
    });
    adapter.update(0, { reducedMotion: true });
    return bakeGroup(adapter.root, body.f.h.body.skin.matrixWorld);
  } finally {
    adapter?.dispose();
    disposeAsset(raw);
  }
}
export function disposeAsset(root) {
  const gs = new Set(),
    ms = new Set(),
    ts = new Set();
  root.traverse((m) => {
    if (m.geometry) gs.add(m.geometry);
    for (const mat of Array.isArray(m.material)
      ? m.material
      : m.material
        ? [m.material]
        : []) {
      ms.add(mat);
      for (const v of Object.values(mat)) if (v?.isTexture) ts.add(v);
    }
  });
  gs.forEach((x) => x.dispose());
  ms.forEach((x) => x.dispose());
  ts.forEach((x) => x.dispose());
}
