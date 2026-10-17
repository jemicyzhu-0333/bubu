import {Group} from 'three';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {acquireFaceGLB} from './pack-loader.mjs';
import {assertNeutralRest} from './neutral-source-check.mjs';
import {bindFacePaths} from './face-binding.mjs';
import {FaceTimeline} from './face-timeline.mjs';
import {fail} from './contracts.mjs';

/** Seven reviewed semantic paths. The rendering handle is trusted host access,
 * not a sandbox: callers must not mutate geometry, materials, morphs or pose. */
export async function createFaceSuite(pack,cache,{signal}={}) {
  let lease,model,root,document,binding,timeline,rest,disposed=false;
  const live=()=>{if(disposed)fail('DISPOSED','Face actor');};
  const dispose=()=>{
    if(disposed)return;disposed=true;
    root?.removeFromParent();root?.clear();binding?.dispose();
    const skeletons=new Set();model?.traverse(o=>{if(o.skeleton)skeletons.add(o.skeleton);});
    for(const s of skeletons)s.dispose();lease?.release();
    lease=null;model=null;document=null;binding=null;timeline=null;rest=null;
  };
  try {
    lease=await acquireFaceGLB(pack,cache,{signal});
    model=clone(lease.value.gltf.scene);
    document=pack.audits.get(pack.manifest.character.asset).document;
    const nodes=assertNeutralRest(model,document);
    // Immutable rest references are compiled only once; this audit is optional,
    // not part of the steady sampling hot path.
    rest=document.nodes.map(n=>({node:nodes.get(n.name),position:n.translation??[0,0,0],quaternion:n.rotation??[0,0,0,1],scale:n.scale??[1,1,1]}));
    binding=bindFacePaths(model,pack.profile);
    timeline=new FaceTimeline(pack.profile.paths.map(p=>p.id),(id,value)=>binding.apply(id,value));
    root=new Group();root.name='Face_actor';root.add(model);root.updateMatrixWorld(true);
    const actor={
      root,budget:pack.budget,verification:lease.value.verification,readiness:pack.profile.readiness,
      get disposed(){return disposed;},
      get state(){live();return timeline.snapshot();},
      enqueue(cue){live();timeline.enqueue(cue);return actor;},
      advance(time){live();return timeline.advance(time);},
      isAnimating(){live();return timeline.isAnimating();},
      nextDeadline(){live();return timeline.nextDeadline();},
      assertCurrent(){
        live();binding.assertCurrent(timeline.path,timeline.value);
        for(const r of rest)for(const key of ['position','quaternion','scale']) {
          const actual=r.node[key],expected=r[key];
          for(let i=0;i<expected.length;i++) {
            const value=actual.getComponent?actual.getComponent(i):actual[['x','y','z','w'][i]];
            if(value!==expected[i])fail('FACE_INVARIANT','Source pose changed');
          }
        }
        return true;
      },
      dispose
    };
    return actor;
  } catch(error) {dispose();throw error;}
}
