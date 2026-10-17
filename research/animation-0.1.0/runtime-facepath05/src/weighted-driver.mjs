// Strict internal capability bridge, not an arbitrary driver/plugin API.
// The canonical P1 module imports this runtime's canonical Director/Timeline.
import {P0SchedulerBinding,validateBindingInputs} from '../../expression-scheduler-p1/src/p0-binding.mjs';
export function validateWeightedInputs(pack,policy,initialFacts) {
  if(!['approved-full-face-paths-opt-in','approved-full-face-d2-opt-in'].includes(pack?.kind))throw new TypeError('Weighted actor requires the explicit admitted full18 pack');
  const frozen=validateBindingInputs(policy,initialFacts);
  if(frozen.policy.sourceSha256!==pack.profile.sourceSha256||frozen.policy.profileSha256!==pack.manifest.assets.find(a=>a.id===pack.manifest.character.profile)?.sha256)throw new RangeError('weighted policy and admitted pack mismatch');
  return frozen;
}
export function createWeightedDriver(policy,initialFacts,apply,onRecord) {
  return new P0SchedulerBinding(policy,initialFacts,apply,onRecord);
}
