/** Shared decoded geometry array accounting, excluding JS objects, textures,
 * renderer morph textures/staging, per-actor skeleton state and prepared bytes. */
export function geometryBackingBytes(root) {
  const buffers=new Set(), geometries=new Set();
  const collect=a=>{if(a)buffers.add(a.isInterleavedBufferAttribute?a.data.array.buffer:a.array.buffer);};
  root.traverse(o=>{if(!o.geometry||geometries.has(o.geometry))return;geometries.add(o.geometry);const g=o.geometry;collect(g.index);Object.values(g.attributes).forEach(collect);Object.values(g.morphAttributes).forEach(list=>list.forEach(collect));});
  return [...buffers].reduce((n,b)=>n+b.byteLength,0);
}
/** Allocation model for the supported, preflight-validated Three 0.186.1 slice.
 * loadBufferView slices the ENTIRE view, once per view index, even if overlapping
 * another view or used by a tiny accessor. TypedArray(buffer, offset, count) and
 * interleaved attributes share that backing; sparse overlays copy their dense
 * base, and missing bases allocate a dense array. No images, compression,
 * animations, topology conversion or arbitrary loader plugins are admitted.
 *
 * assetBytes bounds the loader's retained BIN copy (including padding). The
 * separate sourceBytes charge covers its input ArrayBuffer. Prepared-pack bytes,
 * JS objects, source-parity scratch, skeletons and GPU allocations are excluded;
 * this is NOT a process-heap or VRAM ceiling.
 */
export function decodedArrayPlan(assetBytes,document) {
  const sizes={5121:1,5123:2,5125:4,5126:4};
  const counts={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16};
  const accessors=new Set(),views=new Set(),meshes=new Set(),skins=new Set();
  // Both supported preflights require every node to belong to the sole scene.
  for(const node of document.nodes) {
    if(node.mesh!==undefined)meshes.add(node.mesh);
    if(node.skin!==undefined)skins.add(node.skin);
  }
  for(const index of meshes)for(const primitive of document.meshes[index].primitives) {
    Object.values(primitive.attributes).forEach(i=>accessors.add(i));
    if(primitive.indices!==undefined)accessors.add(primitive.indices);
    for(const target of primitive.targets??[])Object.values(target).forEach(i=>accessors.add(i));
  }
  for(const index of skins) {
    const a=document.skins[index].inverseBindMatrices;
    if(a!==undefined)accessors.add(a);
  }
  let denseBytes=0;
  for(const index of accessors) {
    const a=document.accessors[index];
    if(a.bufferView!==undefined)views.add(a.bufferView);
    if(a.sparse) {
      views.add(a.sparse.indices.bufferView);views.add(a.sparse.values.bufferView);
    }
    if(a.bufferView===undefined||a.sparse)denseBytes+=a.count*counts[a.type]*sizes[a.componentType];
  }
  const viewBytes=[...views].reduce((n,i)=>n+document.bufferViews[i].byteLength,0);
  return Object.freeze({inputBytes:assetBytes,binReservationBytes:assetBytes,viewBytes,denseBytes,
    loadedAccessors:accessors.size,loadedBufferViews:views.size,
    decodedBytes:assetBytes+viewBytes+denseBytes});
}
export function decodedArrayReservation(assetBytes,document) {
  return decodedArrayPlan(assetBytes,document).decodedBytes;
}
