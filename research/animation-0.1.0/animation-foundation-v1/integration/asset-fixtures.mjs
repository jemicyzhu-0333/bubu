import { bakeGroup, disposeAsset } from "./asset-resources.mjs";
export { bakeGroup, disposeAsset, disposeAssets } from "./asset-resources.mjs";
import fs from "node:fs";
import { cleanupOwned } from "./cleanup-owned.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { fixture } from "../body-runtime/fixture.mjs";
import { createContractCheckedMixedBindingAdapter } from "../../original-parts-hybrid-v1/runtime/mixed-binding-contract.mjs";
import { SatchelAdapter } from "../../external-assets-v1/existing-wearables/src/local-adapters/satchel-adapter.mjs";
import { createPartsSource } from "./parts-source.mjs";
import { admitAsset } from "./resource-admission.mjs";
import { SceneBudget } from "./scene-budget.mjs";
export const research = fileURLToPath(new URL("../../", import.meta.url));
export const revised = path.join(research, "external-assets-v1");
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
export function createHybridSource(budget) {
  return createPartsSource({
    budget,
    load: () => loadGLB(hybrid),
    measure: (asset) => admitAsset(asset).bytes,
    dispose: disposeAsset,
  });
}
export async function createBody({ partsSource, ...options } = {}) {
  if (
    sha256(source) !==
      "84ec5d8608f21e43bf06df26b8b2f81124909ebb39c77bb9cc153aca17319a3a" ||
    sha256(hybrid) !==
      "52a080d81606fbe92e9cd71593bd703f356eb50a0e1c74ccc34547a0db308e67"
  )
    throw Error("Unapproved body bytes");
  const ownsSource = !partsSource;
  partsSource ??= createHybridSource(new SceneBudget());
  const lease = await partsSource.acquire();
  let f, owner;
  try {
    f = await fixture(options);
    owner = createContractCheckedMixedBindingAdapter({
    THREE: T,
    sourceSkin: f.h.body.skin,
    parts: lease.asset,
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
  } catch (error) {
    try {
      cleanupOwned([
        () => owner?.dispose(),
        () => f?.h.dispose(),
        () => lease.release(),
        () => { if (ownsSource) partsSource.close(); },
      ], "Body construction cleanup failures");
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Body construction and cleanup failed");
    }
    throw error;
  }
  let disposed = false;
  return {
    f,
    owner,
    authoredFaces: options.authoredFaces ?? [],
    dispose() {
      if (disposed) return;
      disposed = true;
      cleanupOwned([
        () => owner.dispose(),
        () => f.h.dispose(),
        () => lease.release(),
        () => { if (ownsSource) partsSource.close(); },
      ], "Body disposal failures");
    },
  };
}
export async function correctedSatchel(body) {
  const raw = await loadGLB(
    path.join(research, "accessories-v1/03-satchel/satchel.glb"),
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
