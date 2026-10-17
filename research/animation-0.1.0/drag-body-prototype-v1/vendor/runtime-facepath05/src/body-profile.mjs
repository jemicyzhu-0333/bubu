import {Quaternion} from 'three';
import {fail} from './contracts.mjs';
// Fixed, explicit capability. This does not change the immutable face profile.
export const BODY_PROFILE_ID='approved05-four-limb-rotation-prototype-v1';
export const BODY_PROFILE=Object.freeze({id:BODY_PROFILE_ID,channels:Object.freeze({Shoulder_L:.20,Shoulder_R:.20,Hip_L:.14,Hip_R:.14})});
export function validateBodyProfile(id){if(id===undefined)return null;if(id!==BODY_PROFILE_ID)fail('BODY_CAPABILITY','Unknown body profile');return BODY_PROFILE;}
export function assertBodyQuaternion(node,rest,cap){
 if(!node.isBone)fail('BODY_INVARIANT','Allowed channel must be bone');
 const q=node.quaternion;
 if(!q.toArray().every(Number.isFinite)||Math.abs(q.lengthSq()-1)>2e-6)fail('BODY_INVARIANT','Nonunit or nonfinite bone quaternion');
 const base=new Quaternion().fromArray(rest).normalize();
 if(q.clone().normalize().angleTo(base)>cap+1e-7)fail('BODY_INVARIANT','Bone rotation exceeds profile cap');
}
