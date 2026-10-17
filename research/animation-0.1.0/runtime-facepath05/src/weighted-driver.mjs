// Strict internal capability bridge, not an arbitrary driver/plugin API.
// The canonical P1 module imports this runtime's canonical Director/Timeline.
import {P0SchedulerBinding,validateBindingInputs} from '../../expression-scheduler-p1/src/p0-binding.mjs';
export function validateWeightedInputs(pack,policy,initialFacts) {
  if(pack?.kind!=='approved-full-face-paths-opt-in')throw new TypeError('Weighted actor requires the explicit admitted full18 pack');
  return validateBindingInputs(policy,initialFacts);
}
export function createWeightedDriver(policy,initialFacts,apply,onRecord) {
  return new P0SchedulerBinding(policy,initialFacts,apply,onRecord);
}
