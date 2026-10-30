import * as T from "three";
import { cleanupOwned } from "./cleanup-owned.mjs";
import { admitSecondaryAsset } from "../secondary-motion/index.mjs";
import { bakeGroup, disposeAsset, disposeAssets } from "./asset-resources.mjs";
import { AccessoryAdapter as EarAdapter } from "../../external-assets-v1/headwear-expansion/src/accessory-adapter.mjs";
import { fitSakuraParts } from "./sakura-part-fit.mjs";
import { fitSatchelParts } from "./satchel-part-fit.mjs";
import { fitWearableCalibration } from "./wearable-calibration-fit.mjs";

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
export async function prepareD2Bindings(body, anchors, admitAsset,
  { loadGLB, revised, correctedSatchel, readJSON, sha256, digest }) {
  const entries = new Map();
  const skin = body.f.h.body.skin;
  const restSkin = skin.matrixWorld.clone();
  try {
    for (const [assetId, descriptor] of Object.entries(descriptors)) {
      let asset =
        descriptor.kind === "satchel"
          ? await correctedSatchel(body)
          : await loadGLB(`${revised}/${descriptor.path}`);
      let admission = null;
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
            if (descriptor.earKind === "sakura") fitSakuraParts(asset);
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
        admission = descriptor.kind
          ? await admitSecondaryAsset({
              asset,
              descriptor: await readJSON(new URL(
                `../secondary-motion/descriptors/${descriptor.kind}.json`, import.meta.url)),
            })
          : null;
        const baseCalibration = restAnchor.clone().invert().multiply(authoredWorld);
        const calibration = descriptor.kind
          ? fitWearableCalibration(descriptor.kind, baseCalibration)
          : baseCalibration;
        entries.set(assetId, {
          admission,
          resources: admitAsset(asset),
          ...descriptor,
          asset,
          calibration,
          contact: Object.freeze({
            id: assetId,
            modelSHA256: await sha256(descriptor.kind === "satchel"
              ? new URL("../../accessories-v1/03-satchel/satchel.glb", import.meta.url)
              : `${revised}/${descriptor.path}`),
            attachmentSHA256: await digest(JSON.stringify({
              anchor: descriptor.anchor, mode: descriptor.mode,
              calibration: calibration.elements,
              calibrationFit: descriptor.kind
                ? await sha256(new URL("./wearable-calibration-fit.mjs", import.meta.url))
                : null,
              secondary: descriptor.kind
                ? await sha256(new URL(`../secondary-motion/descriptors/${descriptor.kind}.json`, import.meta.url))
                : null,
              binding: await sha256(new URL("./binding-provider.mjs", import.meta.url)),
              partFit: descriptor.earKind === "sakura"
                ? await sha256(new URL("./sakura-part-fit.mjs", import.meta.url))
                : descriptor.kind === "satchel"
                ? await sha256(new URL("./satchel-part-fit.mjs", import.meta.url))
                : null,
              fixtures: await sha256(new URL("./asset-resources.mjs", import.meta.url)),
            })),
          }),
        });
      } catch (error) {
        try {
          cleanupOwned(
            [() => admission?.dispose(), () => disposeAsset(asset)],
            "Partial binding cleanup failures",
          );
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            "Binding preparation and cleanup failed",
          );
        }
        throw error;
      }
    }
  } catch (error) {
    const owned = [...entries.values()];
    entries.clear();
    try {
      cleanupOwned(
        [
          ...owned.map((entry) => () => entry.admission?.dispose()),
          () => disposeAssets(owned.map((entry) => entry.asset)),
        ],
        "Binding preparation cleanup failures",
      );
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Binding preparation and cleanup failed",
      );
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
        fitParts: entry.kind === "satchel" ? fitSatchelParts : undefined,
        maxAngleRad: secondary.maxAngleRad,
        contact: entry.contact,
      };
    },
    contactFor(mount, configuration, clipLibrary) {
      const entry = entries.get(mount.assetId);
      if (!entry) throw new Error("Unknown contact asset");
      // Evidence identifies the executable placement, including instance
      // offsets, secondary limits and authored tracks, not just the base fit.
      const result = digest(JSON.stringify({
        version: 1, baseAttachment: entry.contact.attachmentSHA256,
        mountId: mount.id, configuration, clipLibrary: clipLibrary ?? null,
      }));
      const bind = attachmentSHA256 => Object.freeze({ ...entry.contact, attachmentSHA256 });
      return typeof result === "string" ? bind(result) : result.then(bind);
    },
    async load(mount, override) {
      const entry = entries.get(mount.assetId);
      if (!entry) throw new Error("Unknown D2 fixture asset");
      return override
        ? override(`${revised}/${entry.path}`)
        : cloneOwned(entry.asset);
    },
    dispose() {
      const owned = [...entries.values()];
      entries.clear();
      cleanupOwned(
        [
          ...owned.map((entry) => () => entry.admission?.dispose()),
          () => disposeAssets(owned.map((entry) => entry.asset)),
        ],
        "Binding cache cleanup failures",
      );
    },
  });
}
