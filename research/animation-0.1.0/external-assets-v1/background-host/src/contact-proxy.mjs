/** Explicit research geometry, NOT a depth reconstruction of coffee-shop.png.
 * Callers supply measured world dimensions; no inferred units from V1 pixels.
 * A renderer may build its own environment-owned mesh from these indexed vertices.
 */
export function createTableProxy({center, width, depth, thickness}) {
  if (!Array.isArray(center) || center.length !== 3 || !center.every(Number.isFinite) ||
      ![width,depth,thickness].every(n => Number.isFinite(n) && n > 0)) throw new RangeError('PROXY_CALIBRATION_REQUIRED');
  const [x,y,z] = center, w=width/2, d=depth/2;
  return Object.freeze({kind:'explicit-table-proxy',space:'world',label:'Research proxy, not PNG-derived depth',
    visualApproval:false,actorAttachment:null,owner:'environment',shadowMode:'none',
    vertices:Object.freeze([x-w,y,z-d,x+w,y,z-d,x+w,y,z+d,x-w,y,z+d,
      x-w,y-thickness,z-d,x+w,y-thickness,z-d,x+w,y-thickness,z+d,x-w,y-thickness,z+d]),
    indices:Object.freeze([0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,1,2,6,1,6,5,2,3,7,2,7,6,3,0,4,3,4,7]),
    contact:Object.freeze({normal:Object.freeze([0,1,0]),constant:-y,
      bounds:Object.freeze({minX:x-w,maxX:x+w,minZ:z-d,maxZ:z+d}),scope:'top-only'})});
}
