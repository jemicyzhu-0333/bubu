const deepFreeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
  return value;
};
const common = {
  revision: 1, space: 'screen', artRect: [20,30,180,142], interactive: false,
  mask: {type:'v1-radial',ellipse:[.90,.86],center:[.50,.54],stops:[[.42,1],[.68,.58],[.98,0]],frameOpacity:.56},
  lightingProfile: 'preserve-existing-actor-lights', shadowMode:'none', cssShadow:false,
  supportSurfaces: [], frontLayers: [], faceOcclusion: false,
  safeRegions: {stage:'StageMetrics.safeRegion',face:'actor-specific measurement required before front layers'},
  compatibility: {actorMaterials:'untouched',actorSkeleton:'untouched',props:'independent-owner'},
  budget: {images:1,decodedPixelBytes:'measure-after-decode',gpuBudget:'unverified'}
};
export const backgrounds = deepFreeze({
  focused: {...common,id:'focused',layer:'backdrop',alpha:1,
    sky:['#1d2a3b','#18202e'],ground:'#2c3040',
    asset:{path:'assets/focused.png',sha256:'cb6ab127f3f0ba5235e637d1ccc056cbdf8aa92d8f5e1f09ae3a28f0f2314af9'}},
  'coffee-decoration': {...common,id:'coffee-decoration',layer:'decoration-back',alpha:.58,
    sky:['#bd906c','#725246'],ground:'#49352e',
    asset:{path:'assets/coffee-shop.png',sha256:'6ae8b01731e9d9586045f190876ae2c8de41f7a7160a1cbb03c7cf6d1e36a07f'},
    notice:'One complete V1 PNG. No extracted depth layers, collision, tabletop, cup or drink action.'}
});

export function validateBackground(d) {
  if (!d || d.space !== 'screen' || d.interactive !== false || d.supportSurfaces.length || d.frontLayers.length) throw new Error('SCREEN_ART_IS_NOT_CONTACT_GEOMETRY');
  if (!/^[a-f0-9]{64}$/.test(d.asset.sha256) || d.artRect.length !== 4 || !d.artRect.every(Number.isFinite)) throw new Error('INVALID_ASSET');
  if (d.shadowMode !== 'none' || d.cssShadow !== false) throw new Error('SHADOW_REQUIRES_SEPARATE_APPROVAL');
  return true;
}
Object.values(backgrounds).forEach(validateBackground);
