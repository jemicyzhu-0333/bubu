import {createRigidTeaController} from '../../original-parts-hybrid-v1/tea/src/rigid-tea.mjs';
import {normalizeTeaSample} from '../integration/tea-sample-boundary.mjs';

/** Research candidate only. One coherent source-space translation preserves
 * the existing cup/grip relation; sip, rest and reduced-motion stay unchanged.
 * This cannot resolve the independently infeasible fixed cloth pins. */
export function createTeaClearanceCandidate(inputs) {
  const base=createRigidTeaController(inputs);
  return Object.freeze({sample(time,options){
    const sample=normalizeTeaSample(base.sample(time,options));
    const forward=.0098*sample.handEntry*(1-sample.lift);
    return {...sample,
      matrices:Object.fromEntries(Object.entries(sample.matrices).map(([name,matrix])=>{
        const moved=matrix.clone();moved.elements[14]+=forward;return [name,moved];
      })),
      cup:{...sample.cup,center:sample.cup.center.map((value,i)=>value+(i===2?forward:0))},
    };
  }});
}
