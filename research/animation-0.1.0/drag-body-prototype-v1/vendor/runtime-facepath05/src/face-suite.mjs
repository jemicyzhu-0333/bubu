import {assertBodyQuaternion,validateBodyProfile} from './body-profile.mjs';
import {Group} from 'three';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {acquireFaceGLB} from './pack-loader.mjs';
import {assertNeutralRest} from './neutral-source-check.mjs';
import {bindFacePaths} from './face-binding.mjs';
import {FaceTimeline} from './face-timeline.mjs';
import {ExpressionDirector,validatePackPolicy} from './director.mjs';
import {createWeightedDriver,validateWeightedInputs} from './weighted-driver.mjs';
import {fail} from './contracts.mjs';

/** Explicit registered semantic paths (default slice7 or opt-in full18). The rendering handle is trusted host access,
 * not a sandbox: callers must not mutate geometry, materials, morphs or pose. */
export function createFaceSuite(pack,cache,options={}) { return createFaceActor(pack,cache,options); }
export function createDirectedFaceSuite(pack,cache,{signal,policy,onRecord,onDispose}={}) {
  return createFaceActor(pack,cache,{signal,policy:validatePackPolicy(pack,policy),onRecord,onDispose},'directed');
}
export function createWeightedFaceSuite(pack,cache,{signal,policy,initialFacts,onRecord,onDispose,bodyProfile}={}) {
  const frozen=validateWeightedInputs(pack,policy,initialFacts);
  return createFaceActor(pack,cache,{signal,...frozen,onRecord,onDispose,bodyProfile:validateBodyProfile(bodyProfile)},'weighted');
}
async function createFaceActor(pack,cache,{signal,policy,initialFacts,onRecord,onDispose,bodyProfile}={},mode='timeline') {
  const directed=mode!=='timeline',weighted=mode==='weighted';
  let lease,model,root,document,binding,timeline,rest,disposed=false;
  const live=()=>{if(disposed)fail('DISPOSED','Face actor');};
  const dispose=()=>{
    if(disposed)return;disposed=true;
    let cleanupError;const clean=fn=>{try{fn();}catch(e){cleanupError??=e;}};
    clean(()=>timeline?.dispose?.());clean(()=>root?.removeFromParent());clean(()=>root?.clear());clean(()=>binding?.dispose());
    const skeletons=new Set();model?.traverse(o=>{if(o.skeleton)skeletons.add(o.skeleton);});
    for(const s of skeletons)clean(()=>s.dispose());clean(()=>lease?.release());
    lease=null;model=null;if(directed)root=null;document=null;binding=null;timeline=null;rest=null;
    clean(()=>onDispose?.());if(cleanupError)throw cleanupError;
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
    const apply=(id,value)=>{live();return binding.apply(id,value);};
    const newDriver=()=>weighted?createWeightedDriver(policy,initialFacts,apply,onRecord):directed?new ExpressionDirector(policy,apply,onRecord):new FaceTimeline(pack.profile.paths.map(p=>p.id),apply);
    timeline=newDriver();
    const driverState=()=>weighted?timeline.directorState:timeline.state;
    root=new Group();root.name='Face_actor';root.add(model);root.updateMatrixWorld(true);
    const actor={
      get root(){return root;},budget:pack.budget,verification:lease.value.verification,readiness:pack.profile.readiness,
      get disposed(){return disposed;},
      get state(){live();return directed?driverState():timeline.snapshot();},
      enqueue(cue){live();timeline.enqueue(cue);return actor;},
      advance(time){live();return timeline.advance(time);},
      isAnimating(){live();return timeline.isAnimating();},
      nextDeadline(){live();return timeline.nextDeadline();},
      assertCurrent(){
        live();const state=directed?driverState():timeline;binding.assertCurrent(state.path,directed?state.amount:state.value);
        for(const r of rest)for(const key of ['position','quaternion','scale']) {
          if(key==='quaternion'&&bodyProfile&&Object.hasOwn(bodyProfile.channels,r.node.name)){assertBodyQuaternion(r.node,r.quaternion,bodyProfile.channels[r.node.name]);continue;}
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
    if(directed) {
      delete actor.enqueue;
      actor.submit=batch=>{live();timeline.submit(batch);};
      actor.advance=(time,steps)=>{live();return timeline.advance(time,steps);};
      Object.defineProperties(actor,{
        progress:{get(){live();return timeline.progress;}},
        hasInteraction:{get(){live();return timeline.hasInteraction;}},
        observerStatus:{get(){live();return timeline.observerStatus;}}
      });
      actor.retire=time=>{live();if(weighted)timeline.retire(time);else {timeline=null;timeline=newDriver();}};
      if(weighted)Object.defineProperty(actor,'weightedState',{get(){live();return timeline.state;}});
    }
    return actor;
  } catch(error) {dispose();throw error;}
}
