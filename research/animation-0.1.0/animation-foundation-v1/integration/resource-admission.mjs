export const RESOURCE_LIMITS = Object.freeze({
  maxActors: 2,
  maxMountsPerActor: 5,
  maxPendingEquipsPerActor: 2,
  maxAssetNodes: 128,
  maxAssetVertices: 100000,
  maxAssetBytes: 16000000,
  maxTextures: 4,
});
export function admitAsset(asset) {
  let nodes = 0,
    vertices = 0,
    bytes = 0;
  const arrays = new Set(),
    textures = new Set();
  asset.traverse((m) => {
    if (++nodes > 128) throw Error("Fixture node budget exceeded");
    vertices += m.geometry?.attributes.position?.count ?? 0;
    const attributes = [
      ...Object.values(m.geometry?.attributes ?? {}),
      m.geometry?.index,
      ...Object.values(m.geometry?.morphAttributes ?? {}).flat(),
    ].filter(Boolean);
    for (const a of attributes)
      if (!arrays.has(a.array)) {
        arrays.add(a.array);
        bytes += a.array.byteLength;
      }
    for (const mat of Array.isArray(m.material)
      ? m.material
      : m.material
        ? [m.material]
        : [])
      for (const v of Object.values(mat))
        if (v?.isTexture && !textures.has(v)) {
          textures.add(v);
          const image = v.source?.data;
          if (image?.width && image?.height) {
            if (image.width > 2048 || image.height > 2048)
              throw Error("Texture dimensions exceeded");
            bytes += image.width * image.height * 4;
          }
        }
    if (vertices > 100000 || bytes > 16000000 || textures.size > 4)
      throw Error("Fixture asset budget exceeded");
  });
  return { nodes, vertices, bytes, textures: textures.size };
}
