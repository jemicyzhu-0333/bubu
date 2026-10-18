import * as T from "three";
import { admitSecondaryAsset } from "../secondary-motion/index.mjs";
import fs from "node:fs";
import {
  loadGLB,
  revised,
  correctedSatchel,
  bakeGroup,
  disposeAsset,
} from "./asset-fixtures.mjs";
import { AccessoryAdapter as EarAdapter } from "../../bubu-asset-physics-revision-20261018/headwear-expansion/src/accessory-adapter.mjs";

const descriptors = Object.freeze({
  "skin.sakura-flower": {
    path: "headwear-expansion/models/09-sakura-flower.glb",
    anchor: "earR.front",
    earKind: "sakura",
    mode: "rigid-follow",
  },
  "skin.forest-leaf": {
    path: "headwear-expansion/models/08-forest-leaf.glb",
    anchor: "earR.rear",
    earKind: "forest",
    mode: "rigid-follow",
  },
  "milestone.satchel": {
    kind: "satchel",
    anchor: "hip.sideR",
    mode: "spring-chain",
  },
  "milestone.cape": {
    path: "accessory-expansion/models/07-cape.glb",
    kind: "cape",
    anchor: "back.upper",
    mode: "authored-chain",
  },
  "milestone.halo": {
    path: "accessory-expansion/models/05-halo.glb",
    anchor: "crown",
    mode: "rigid-follow",
  },
  "open-book": {
    path: "prop-expansion/models/open-book.glb",
    anchor: "palm.gripR",
    mode: "rigid-follow",
    centerGrip: true,
  },
});

function cloneOwned(source) {
  const clone = source.clone(true);
  clone.traverse((mesh) => {
    if (mesh.geometry) mesh.geometry = mesh.geometry.clone();
    if (!mesh.material) return;
    const copy = (material) => {
      const result = material.clone();
      for (const [key, value] of Object.entries(result))
        if (value?.isTexture) result[key] = value.clone();
      return result;
    };
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map(copy)
      : copy(mesh.material);
  });
  return clone;
}

/** D2-specific test asset preparation occurs once, before any pointer input. */
export async function createD2BindingProvider(body, anchors, admitAsset) {
  const entries = new Map();
  const skin = body.f.h.body.skin;
  const restSkin = skin.matrixWorld.clone();
  try {
    for (const [assetId, descriptor] of Object.entries(descriptors)) {
      let asset =
        descriptor.kind === "satchel"
          ? await correctedSatchel(body)
          : await loadGLB(`${revised}/${descriptor.path}`);
      try {
        admitAsset(asset);
        if (descriptor.earKind) {
          let adapter;
          try {
            adapter = new EarAdapter({
              kind: descriptor.earKind,
              sourceSkin: skin,
              parent: body.f.h.body.offset,
              asset,
              assertSourceCurrent: () => body.f.h.owner.assertCurrent(),
            });
            adapter.update({ time: 0, reducedMotion: true });
            const baked = bakeGroup(adapter.root, restSkin);
            disposeAsset(asset);
            asset = baked;
          } finally {
            adapter?.dispose();
          }
        }
        const restAnchor = anchors.getTransform(descriptor.anchor, {
          poseRevision: 0,
        });
        let authoredWorld = restSkin;
        if (descriptor.centerGrip) {
          const center = new T.Box3()
            .setFromObject(asset)
            .getCenter(new T.Vector3());
          authoredWorld = restAnchor
            .clone()
            .multiply(
              new T.Matrix4().makeTranslation(-center.x, -center.y, -center.z),
            );
        }
        const admission = descriptor.kind
          ? await admitSecondaryAsset({
              asset,
              descriptor: JSON.parse(
                fs.readFileSync(
                  new URL(
                    `../secondary-motion/descriptors/${descriptor.kind}.json`,
                    import.meta.url,
                  ),
                ),
              ),
            })
          : null;
        entries.set(assetId, {
          admission,
          resources: admitAsset(asset),
          ...descriptor,
          asset,
          calibration: restAnchor.clone().invert().multiply(authoredWorld),
        });
      } catch (error) {
        disposeAsset(asset);
        throw error;
      }
    }
  } catch (error) {
    for (const entry of entries.values()) {
      entry.admission?.dispose();
      disposeAsset(entry.asset);
    }
    throw error;
  }

  return Object.freeze({
    residentBytes: [...entries.values()].reduce(
      (sum, entry) =>
        sum +
        entry.resources.bytes * (entry.admission ? 2 : 1) +
        entry.resources.vertices * (entry.admission ? 41 : 0),
      0,
    ),
    describe(mount, secondary) {
      const entry = entries.get(mount.assetId);
      if (!entry || mount.anchor !== entry.anchor)
        throw new Error("No admitted runtime fixture binding");
      if (secondary?.mode !== entry.mode)
        throw new Error("Unimplemented runtime secondary mode");
      return {
        kind: entry.kind,
        calibration: entry.calibration.clone(),
        bytes:
          entry.resources.bytes * (entry.admission ? 2 : 1) +
          entry.resources.vertices * (entry.admission ? 65 : 0),
        admission: entry.admission,
        maxAngleRad: secondary.maxAngleRad,
      };
    },
    async load(mount, override) {
      const entry = entries.get(mount.assetId);
      if (!entry) throw new Error("Unknown D2 fixture asset");
      return override
        ? override(`${revised}/${entry.path}`)
        : cloneOwned(entry.asset);
    },
    dispose() {
      for (const entry of entries.values()) {
        entry.admission?.dispose();
        disposeAsset(entry.asset);
      }
      entries.clear();
    },
  });
}
