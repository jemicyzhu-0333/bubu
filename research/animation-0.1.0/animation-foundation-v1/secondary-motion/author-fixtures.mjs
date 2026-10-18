// OFFLINE AUTHORING ONLY. This geometry heuristic is not imported by the runtime.
import fs from "node:fs";
import { bakeAccessory, geometryIdentity } from "./asset-admission.mjs";
import {
  createBody,
  correctedSatchel,
  loadGLB,
  revised,
  disposeAsset,
} from "../integration/asset-fixtures.mjs";

const profiles = {
  cape: {
    chains: [
      [-0.45, 1.23, -0.71],
      [0, 1.23, -0.77],
      [0.45, 1.23, -0.71],
    ].map((point) => [point, [point[0], 0.76, -0.91], [point[0], 0.22, -0.72]]),
    pinAboveY: 1.2,
    radius: 0.025,
    stiffness: 3.5,
    dragForce: 0.45,
    gravityPower: 0.12,
    proxies: [{ center: [0, 0.76, -0.2], radius: 0.57 }],
  },
  satchel: {
    chains: [
      [
        [-0.91, 0.57, 0.35],
        [-0.94, 0.35, 0.36],
        [-0.94, 0.14, 0.36],
      ],
    ],
    pinAboveY: 0.55,
    radius: 0.055,
    stiffness: 6,
    dragForce: 0.55,
    gravityPower: 0.1,
    proxies: [{ center: [-0.15, 0.4, 0.1], radius: 0.65 }],
  },
};
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const body = await createBody();
body.f.tick(0);
body.owner.update();
const assets = {
  satchel: await correctedSatchel(body),
  cape: await loadGLB(revised + "/accessory-expansion/models/07-cape.glb"),
};
for (const [kind, asset] of Object.entries(assets)) {
  const profile = profiles[kind];
  const descriptor = {
    version: 2,
    authoring:
      "Offline candidate X/Y authoring for these two approved fixtures only; no runtime inference",
    profile: {
      ...profile,
      maxAngleRad: 0.25,
      colliderLinks: profile.chains.map(() => [0]),
    },
    parts: [],
  };
  delete descriptor.profile.pinAboveY;
  const parts = bakeAccessory(asset);
  for (const part of parts) {
    const positions = part.geometry.attributes.position;
    const jointIndices = [];
    const weights = [];
    const pins = [];
    for (let vertex = 0; vertex < positions.count; vertex++) {
      let chainIndex = 0;
      let nearest = Infinity;
      profile.chains.forEach((chain, index) => {
        const distance = Math.abs(positions.getX(vertex) - chain[0][0]);
        if (distance < nearest) {
          nearest = distance;
          chainIndex = index;
        }
      });
      const chain = profile.chains[chainIndex];
      const u = clamp(
        (profile.pinAboveY - positions.getY(vertex)) /
          (profile.pinAboveY - chain.at(-1)[1]),
        0,
        1,
      );
      const coordinate = u * (chain.length - 1);
      const joint = Math.min(chain.length - 2, Math.floor(coordinate));
      const blend = coordinate - joint;
      const amount = clamp(u * 3, 0, 1);
      const offset =
        1 +
        profile.chains
          .slice(0, chainIndex)
          .reduce((sum, points) => sum + points.length, 0);
      jointIndices.push(0, offset + joint, offset + joint + 1, 0);
      weights.push(1 - amount, amount * (1 - blend), amount * blend, 0);
      pins.push(amount === 0);
    }
    descriptor.parts.push({
      name: part.name,
      vertexCount: positions.count,
      geometrySHA256: await geometryIdentity(part.geometry),
      jointIndices,
      weights,
      pins,
    });
    part.geometry.dispose();
  }
  fs.writeFileSync(
    new URL(`./descriptors/${kind}.json`, import.meta.url),
    JSON.stringify(descriptor),
  );
  disposeAsset(asset);
}
body.dispose();
