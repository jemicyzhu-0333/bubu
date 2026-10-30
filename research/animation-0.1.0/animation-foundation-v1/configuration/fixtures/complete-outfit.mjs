import {FIXTURES} from './index.mjs';

/** Composition-specific fit: crown-local Z follows the outward head normal.
 * This remains inside the existing 0.04 anchor limit. The single halo fixture
 * and all asset geometry stay unchanged; whole-outfit contact is still open. */
export function createCompleteOutfit(){
  const outfit=structuredClone(FIXTURES[4]);outfit.id='complete-outfit-v1';
  for(const field of ['mounts','secondaryMotion','effects'])
    outfit[field]=[0,1,2,4].flatMap(i=>structuredClone(FIXTURES[i][field]));
  outfit.mounts.find(m=>m.id==='halo').offset=[0,0,.04];
  // Two small in-plane adjustments separate the flower's leaves from the
  // forest leaf. The ear anchors retain their existing bounded fit contract.
  outfit.mounts.find(m=>m.id==='sakura').offset=[0,.0125,0];
  outfit.mounts.find(m=>m.id==='leaf').offset=[-.0125,0,0];
  // Combined with the binding-owned rigid calibration, these bounded offsets
  // clear the sampled hand/strap and cape-edge crossings. Spring parameters,
  // maximum angles and source geometry stay unchanged.
  outfit.mounts.find(m=>m.id==='satchel').offset=[-.000743019142729933,-.023225645793969817,.0021648003075926342];
  outfit.mounts.find(m=>m.id==='cape').offset=[0,-.025,.04];
  return outfit;
}
