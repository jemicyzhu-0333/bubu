import {ActorPool} from '../vendor/runtime-facepath05/src/actor-pool.mjs';
import {WeightedExpressionOwner} from '../vendor/runtime-facepath05/src/expression-owner.mjs';
import {prepareFullFacePack} from '../vendor/runtime-facepath05/src/pack-loader.mjs';
import {localPackReader} from '../vendor/runtime-facepath05/tools/read-local-pack.mjs';
import {FULL_FACE_SLOT_IDS} from '../vendor/runtime-facepath05/src/face-contract.mjs';
import {ADMISSION} from '../vendor/expression-scheduler-p1/src/p0-binding.mjs';
import {BODY_PROFILE_ID} from '../vendor/runtime-facepath05/src/body-profile.mjs';
// Testfixture policy, never a production probability/art-direction approval.
export const facts=interactionOwned=>({context:'none',source:'testfixture',enabled:false,interactionOwned});
export function policy(){return {format:'bubu-expression-scheduler',version:'0.1.0-p1',sourceSha256:ADMISSION.sourceSha256,profileSha256:ADMISSION.profileSha256,rng:{algorithm:'xorshift32-split-v1',seed:42},candidates:FULL_FACE_SLOT_IDS.map(faceId=>({key:faceId,faceId,amount:1,selectionWeight:1,enterSec:.16,exitSec:.20,hold:{kind:'fixed',sec:30},gap:{kind:'fixed',sec:.3},cooldownSec:0,sources:['testfixture']})),contexts:[{key:'none',candidates:[],excludeRecent:0}]};}
export async function createHost({body=true}={}){const pack=await prepareFullFacePack(localPackReader(new URL('../vendor/runtime-facepath05/fixtures/face-full18/',import.meta.url).pathname));const pool=new ActorPool(body?{bodyProfile:BODY_PROFILE_ID}:{});const owner=new WeightedExpressionOwner({pool,pack,policy:policy(),initialFacts:facts(false),visibilityPolicy:'freeze'});await owner.ready;return {owner,pool,pack};}
