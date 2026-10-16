import {Group} from 'three';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {acquireNeutralGLB} from './pack-loader.mjs';
import {assertNeutralRest} from './neutral-source-check.mjs';
import {fail} from './contracts.mjs';
/** Static diagnostic API. A returned scene is a trusted host rendering handle,
 * not an immutable sandbox. Host must not mutate pose, morphs, materials or geometry. */
export async function createNeutralSuite(pack,cache,{signal}={}) {
  let lease,model,root,document,disposed=false;
  const live=()=>{if(disposed)fail('DISPOSED','Neutral actor');};
  const dispose=()=>{
    if(disposed)return;disposed=true;root?.removeFromParent();root?.clear();
    const skeletons=new Set();model?.traverse(o=>{if(o.skeleton)skeletons.add(o.skeleton);});
    for(const s of skeletons)s.dispose();lease?.release();
    // Do not retain parsed source/clone graphs through a disposed actor handle.
    lease=null;model=null;document=null;
  };
  try {
    lease=await acquireNeutralGLB(pack,cache,{signal});
    model=clone(lease.value.gltf.scene);
    document=pack.audits.get(pack.manifest.character.asset).document;
    assertNeutralRest(model,document);
    root=new Group();root.name='Neutral_actor';root.add(model);root.updateMatrixWorld(true);
    return {
      root,budget:pack.budget,verification:lease.value.verification,readiness:pack.profile.readiness,
      get disposed(){return disposed;},
      assertNeutral(){live();assertNeutralRest(model,document);return true;},
      advance(time){live();if(!Number.isFinite(time)||time<0)fail('TIME','Neutral clock');return false;},
      isAnimating(){live();return false;},nextDeadline(){live();return Infinity;},
      dispose
    };
  } catch(error) {dispose();throw error;}
}
