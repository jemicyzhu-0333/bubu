import {APPROVED_D2_FACE_SOURCE,D2_FACE_PROFILE_SHA256} from '../../runtime-facepath05/src/approved-d2-face-source.mjs';
// Browser-safe admission: caller supplies a bounded pack reader, never an actor,
// eligibility claim, face owner, or body writer. No node:fs in this import graph.
import {ActorPool} from '../../runtime-facepath05/src/actor-pool.mjs';
import {WeightedExpressionOwner} from '../../runtime-facepath05/src/expression-owner.mjs';
import {prepareFullFacePack,prepareD2FacePack} from '../../runtime-facepath05/src/pack-loader.mjs';
import {FULL_FACE_SLOT_IDS} from '../../runtime-facepath05/src/face-contract.mjs';
import {BODY_PROFILE_ID} from '../../runtime-facepath05/src/body-profile.mjs';
import {ADMISSION} from '../../expression-scheduler-p1/src/p0-binding.mjs';
export const facts=interactionOwned=>({context:'none',source:'testfixture',enabled:false,interactionOwned});
export async function createAdmittedHost(readPack,{modelVariant='full18'}={}){
 if(!['full18','d2'].includes(modelVariant))throw new TypeError('Explicit full18 or d2 model variant required');
 const admission=modelVariant==='d2'?{sourceSha256:APPROVED_D2_FACE_SOURCE.sha256,profileSha256:D2_FACE_PROFILE_SHA256}:ADMISSION;
 if(typeof readPack!=='function')throw Error('Bounded full18 pack reader required');
 const pack=await (modelVariant==='d2'?prepareD2FacePack:prepareFullFacePack)(readPack),pool=new ActorPool({bodyProfile:BODY_PROFILE_ID});
 const policy={format:'bubu-expression-scheduler',version:'0.1.0-p1',sourceSha256:admission.sourceSha256,profileSha256:admission.profileSha256,rng:{algorithm:'xorshift32-split-v1',seed:42},candidates:FULL_FACE_SLOT_IDS.map(faceId=>({key:faceId,faceId,amount:1,selectionWeight:1,enterSec:.16,exitSec:.20,hold:{kind:'fixed',sec:30},gap:{kind:'fixed',sec:.3},cooldownSec:0,sources:['testfixture']})),contexts:[{key:'none',candidates:[],excludeRecent:0}]};
 let owner;try{owner=new WeightedExpressionOwner({pool,pack,policy,initialFacts:facts(false),visibilityPolicy:'freeze'});await owner.ready;return {owner,pool,pack};}catch(error){try{owner?.dispose();}finally{pool.dispose();}throw error;}
}
