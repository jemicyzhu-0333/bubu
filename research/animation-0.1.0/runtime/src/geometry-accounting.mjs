/** Shared decoded geometry array accounting, excluding JS objects, textures,
 * renderer morph textures/staging, per-actor skeleton state and prepared bytes. */
export function geometryBackingBytes(root) {
  const buffers=new Set(), geometries=new Set();
  const collect=a=>{if(a)buffers.add(a.isInterleavedBufferAttribute?a.data.array.buffer:a.array.buffer);};
  root.traverse(o=>{if(!o.geometry||geometries.has(o.geometry))return;geometries.add(o.geometry);const g=o.geometry;collect(g.index);Object.values(g.attributes).forEach(collect);Object.values(g.morphAttributes).forEach(list=>list.forEach(collect));});
  return [...buffers].reduce((n,b)=>n+b.byteLength,0);
}
/** Conservative shared geometry-array reservation before asynchronous parsing.
 * Encoded bytes cover retained backing views; dense accessor sizes cover copies. */
export function decodedArrayReservation(assetBytes,document) {
  const sizes={5120:1,5121:1,5122:2,5123:2,5125:4,5126:4},counts={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT2:4,MAT3:9,MAT4:16};
  return assetBytes+(document.accessors??[]).reduce((n,a)=>n+a.count*counts[a.type]*sizes[a.componentType],0);
}
