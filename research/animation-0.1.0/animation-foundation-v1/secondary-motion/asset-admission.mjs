import * as THREE from "three";

function releaseParts(parts, originalError) {
  const errors = [];
  for (const part of parts) {
    try {
      part.geometry.dispose();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length)
    throw new AggregateError(
      originalError ? [originalError, ...errors] : errors,
      "Secondary asset cleanup failures",
    );
  if (originalError) throw originalError;
}

const admissions = new WeakMap();
const MAX_VERTICES = 100000;
const MAX_BYTES = 32 * 1024 * 1024;

export function assertMatrix(matrix) {
  if (
    !matrix.elements.every(
      (value) => Number.isFinite(value) && Math.abs(value) <= 1e6,
    ) ||
    Math.abs(matrix.determinant()) < 1e-10
  ) {
    throw new Error("Invalid bounded transform");
  }
}

// Canonical baked positions and triangle topology identify the binding input.
export async function geometryIdentity(geometry) {
  const positions = geometry.attributes.position;
  const indices = geometry.index;
  const header = new TextEncoder().encode(
    JSON.stringify({
      vertices: positions.count,
      itemSize: positions.itemSize,
      indexType: indices?.array.constructor.name ?? null,
      indexCount: indices?.count ?? 0,
    }),
  );
  const positionBytes = new Uint8Array(
    positions.array.buffer,
    positions.array.byteOffset,
    positions.array.byteLength,
  );
  const indexBytes = indices
    ? new Uint8Array(
        indices.array.buffer,
        indices.array.byteOffset,
        indices.array.byteLength,
      )
    : new Uint8Array();
  const bytes = new Uint8Array(
    header.length + positionBytes.length + indexBytes.length,
  );
  bytes.set(header);
  bytes.set(positionBytes, header.length);
  bytes.set(indexBytes, header.length + positionBytes.length);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

export function bakeAccessory(asset) {
  if (!asset?.isObject3D) throw new Error("Accessory asset required");
  const parts = [];
  let nodeCount = 0;
  let vertices = 0;
  let bytes = 0;
  asset.updateWorldMatrix(true, true);
  assertMatrix(asset.matrixWorld);
  const inverse = asset.matrixWorld.clone().invert();
  try {
    asset.traverse((mesh) => {
      if (++nodeCount > 512)
        throw new Error("Accessory hierarchy cap exceeded");
      if (!mesh.isMesh) return;
      if (mesh.isSkinnedMesh || parts.length >= 64)
        throw new Error("Unsupported or excessive meshes");
      const source = mesh.geometry;
      const position = source.attributes.position;
      if (
        !position ||
        position.isInterleavedBufferAttribute ||
        position.itemSize !== 3
      ) {
        throw new Error("Non-interleaved xyz positions required");
      }
      vertices += position.count;
      if (vertices > MAX_VERTICES)
        throw new Error("Accessory vertex cap exceeded");
      for (const attribute of [
        ...Object.values(source.attributes),
        ...Object.values(source.morphAttributes).flat(),
        source.index,
      ].filter(Boolean)) {
        bytes +=
          attribute.array?.byteLength ?? attribute.data?.array?.byteLength ?? 0;
        if (bytes > MAX_BYTES)
          throw new Error("Accessory geometry byte cap exceeded");
      }
      for (const value of position.array) {
        if (!Number.isFinite(value) || Math.abs(value) > 10)
          throw new Error("Unbounded source coordinates");
      }
      assertMatrix(mesh.matrixWorld);
      const geometry = source.clone();
      geometry.applyMatrix4(inverse.clone().multiply(mesh.matrixWorld));
      if (
        !Array.from(geometry.attributes.position.array).every(
          (value) => Number.isFinite(value) && Math.abs(value) <= 10,
        )
      ) {
        geometry.dispose();
        throw new Error("Unbounded baked coordinates");
      }
      parts.push({ name: mesh.name, geometry, material: mesh.material });
    });
    if (!parts.length) throw new Error("Accessory contains no meshes");
    return parts;
  } catch (error) {
    releaseParts(parts, error);
  }
}

export function validateProfile(input) {
  const finitePoint = (point) =>
    Array.isArray(point) &&
    point.length === 3 &&
    point.every((value) => Number.isFinite(value) && Math.abs(value) <= 10);
  if (
    !input ||
    !Array.isArray(input.chains) ||
    input.chains.length < 1 ||
    input.chains.length > 4
  ) {
    throw new Error("Bounded authored chains required");
  }
  const proxies = input.proxies ?? [];
  if (!Array.isArray(proxies) || proxies.length > 12)
    throw new Error("Bounded proxies required");
  for (const proxy of proxies) {
    if (
      !finitePoint(proxy.center) ||
      !Number.isFinite(proxy.radius) ||
      proxy.radius <= 0 ||
      proxy.radius > 3
    ) {
      throw new Error("Invalid authored proxy");
    }
  }
  let jointCount = 1; // Identity root slot used by pinned and partially pinned vertices.
  for (const chain of input.chains) {
    if (
      !Array.isArray(chain) ||
      chain.length < 2 ||
      chain.length > 8 ||
      !chain.every(finitePoint)
    ) {
      throw new Error("Invalid authored chain");
    }
    for (let index = 1; index < chain.length; index++) {
      if (
        new THREE.Vector3(...chain[index]).distanceTo(
          new THREE.Vector3(...chain[index - 1]),
        ) < 1e-6
      ) {
        throw new Error("Degenerate chain");
      }
    }
    jointCount += chain.length;
  }
  for (const [key, low, high] of [
    ["radius", 1e-6, 0.2],
    ["stiffness", 0, 30],
    ["dragForce", 0, 1],
    ["gravityPower", 0, 2],
    ["maxAngleRad", 1e-6, 0.5],
  ]) {
    if (!Number.isFinite(input[key]) || input[key] < low || input[key] > high)
      throw new Error(`Invalid ${key}`);
  }
  if (
    !Array.isArray(input.colliderLinks) ||
    input.colliderLinks.length !== input.chains.length
  ) {
    throw new Error("Explicit collider links required for each chain");
  }
  for (const links of input.colliderLinks) {
    if (
      !Array.isArray(links) ||
      links.length > 12 ||
      new Set(links).size !== links.length ||
      !links.every(
        (index) =>
          Number.isInteger(index) && index >= 0 && index < proxies.length,
      )
    ) {
      throw new Error("Invalid collider link");
    }
  }
  for (let chainIndex = 0; chainIndex < input.chains.length; chainIndex++) {
    for (const tail of input.chains[chainIndex].slice(1)) {
      for (const proxyIndex of input.colliderLinks[chainIndex]) {
        const proxy = proxies[proxyIndex];
        const clearance =
          new THREE.Vector3(...tail).distanceTo(
            new THREE.Vector3(...proxy.center),
          ) -
          proxy.radius -
          input.radius;
        if (clearance < -1e-6)
          throw new Error("Authored rest tail penetrates linked proxy");
      }
    }
  }
  return {
    jointCount,
    profile: {
      chains: input.chains.map((chain) => chain.map((point) => point.slice())),
      proxies: proxies.map((proxy) => ({
        center: proxy.center.slice(),
        radius: proxy.radius,
      })),
      colliderLinks: input.colliderLinks.map((links) => links.slice()),
      ...Object.fromEntries(
        ["radius", "stiffness", "dragForce", "gravityPower", "maxAngleRad"].map(
          (key) => [key, input[key]],
        ),
      ),
    },
  };
}

/** Async once per admitted asset. Runtime instances consume immutable snapshots, not live source geometry. */
export async function admitSecondaryAsset({ asset, descriptor }) {
  if (
    descriptor?.version !== 2 ||
    !Array.isArray(descriptor.parts) ||
    descriptor.parts.length > 64
  ) {
    throw new Error("Explicit version 2 authored binding descriptor required");
  }
  const { profile, jointCount } = validateProfile(descriptor.profile);
  let declaredVertices = 0;
  const authoredParts = descriptor.parts.map((part) => {
    if (
      !Number.isInteger(part.vertexCount) ||
      part.vertexCount < 0 ||
      (declaredVertices += part.vertexCount) > MAX_VERTICES ||
      part.jointIndices?.length !== part.vertexCount * 4 ||
      part.weights?.length !== part.vertexCount * 4 ||
      part.pins?.length !== part.vertexCount
    )
      throw new Error("Bounded binding arrays required");
    return {
      name: part.name,
      vertexCount: part.vertexCount,
      geometrySHA256: part.geometrySHA256,
      jointIndices: Array.from(part.jointIndices),
      weights: Array.from(part.weights),
      pins: Array.from(part.pins),
    };
  });
  const parts = bakeAccessory(asset);
  try {
    if (parts.length !== authoredParts.length)
      throw new Error("Binding mesh count mismatch");
    for (let partIndex = 0; partIndex < parts.length; partIndex++) {
      const part = parts[partIndex];
      const authored = authoredParts[partIndex];
      const count = part.geometry.attributes.position.count;
      if (
        authored.name !== part.name ||
        authored.vertexCount !== count ||
        authored.geometrySHA256 !== (await geometryIdentity(part.geometry))
      ) {
        throw new Error("Binding source hash/topology mismatch");
      }
      if (
        authored.jointIndices?.length !== count * 4 ||
        authored.weights?.length !== count * 4 ||
        authored.pins?.length !== count
      )
        throw new Error("Binding array length mismatch");
      for (let vertex = 0; vertex < count; vertex++) {
        let sum = 0;
        for (let influence = 0; influence < 4; influence++) {
          const index = vertex * 4 + influence;
          const joint = authored.jointIndices[index];
          const weight = authored.weights[index];
          if (
            !Number.isInteger(joint) ||
            joint < 0 ||
            joint >= jointCount ||
            !Number.isFinite(weight) ||
            weight < 0 ||
            weight > 1
          )
            throw new Error("Invalid authored influence");
          if (authored.pins[vertex] === true && joint !== 0 && weight !== 0)
            throw new Error("Pinned vertex has moving influence");
          sum += weight;
        }
        if (
          typeof authored.pins[vertex] !== "boolean" ||
          Math.abs(sum - 1) > 1e-6
        )
          throw new Error("Invalid authored pin/weight sum");
      }
      part.indices = new Uint16Array(authored.jointIndices);
      part.weights = new Float64Array(authored.weights);
      part.pins = Uint8Array.from(authored.pins, (value) => (value ? 1 : 0));
    }
    const state = { parts, profile, disposed: false };
    const token = Object.freeze({
      dispose() {
        if (state.disposed) return;
        state.disposed = true;
        releaseParts(parts);
      },
    });
    admissions.set(token, state);
    return token;
  } catch (error) {
    releaseParts(parts, error);
  }
}

export function admittedState(token) {
  const state = admissions.get(token);
  if (!state || state.disposed)
    throw new Error("Live secondary asset admission required");
  return state;
}
