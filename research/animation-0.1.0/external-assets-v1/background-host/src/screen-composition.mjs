/** Pure drawing description; an adapter must apply the V1 mask once to the combined frame.
 * The environment raster stays behind the ONE existing 3D actor/prop context.
 * No RAF, new renderer, lights, actor mutation or hit-region expansion is introduced.
 */
export function screenComposition(descriptors, metrics) {
  if (metrics.status !== 'ready') return {status:'deferred',layers:[]};
  return {status:'ready',frame:metrics.backgroundFrame,canvas:metrics.backgroundCanvas,
    mask:descriptors[0]?.mask ?? null,backgroundWash:'rgba(23,27,39,.08)',
    layers:descriptors.map(d => ({asset:d.asset,space:'screen',layer:d.layer,alpha:d.alpha,
      gradient:{colors:d.sky,from:[0,30],to:[0,172],rect:[20,30,180,142]},
      ground:{color:d.ground,rect:[20,140,180,32]},imageRect:[...d.artRect]})),
    contactSurfaces:[],affectsHitTesting:false,performing:false};
}
