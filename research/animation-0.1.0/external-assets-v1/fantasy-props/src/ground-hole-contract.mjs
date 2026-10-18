/** Environment-only contract. Caller must apply this mask to its scene ground and
 * affected actor draw passes atomically. This is not a hand prop or a fall timeline. */
export const groundHoleContract=Object.freeze({
  kind:'environment-opening',portable:false,openingRadius:Object.freeze([.47,.3384]),surfaceY:0,bottomY:-.34,requires:Object.freeze(['replace ground in opening with generated interior','clip affected actor fragments below surface within opening','restore ground and clipping on dispose'])
});
export function insideOpening(localPoint){
  if(!localPoint?.every(Number.isFinite)||localPoint.length!==3)throw TypeError('Finite local xyz required');
  return(localPoint[0]/.47)**2+(localPoint[2]/.3384)**2<1;
} export function clipActorFragment(localPoint){
  return insideOpening(localPoint)&&localPoint[1]<0;
}
