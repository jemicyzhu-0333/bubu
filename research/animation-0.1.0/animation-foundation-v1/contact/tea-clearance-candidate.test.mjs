import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as T from 'three';
import {createRigidTeaController} from '../../original-parts-hybrid-v1/tea/src/rigid-tea.mjs';
import {createTeaClearanceCandidate} from './tea-clearance-candidate.mjs';

const read=name=>JSON.parse(fs.readFileSync(new URL(`../../original-parts-hybrid-v1/tea/inputs/${name}.json`,import.meta.url)));
const inputs={config:read('rigid-config'),hold:read('hold-fit'),sip:read('sip-fit')};
test('bounded coherent clearance preserves grip vectors, exact sip/rest and cancellation continuity',()=>{
  const original=structuredClone(inputs),base=createRigidTeaController(inputs),candidate=createTeaClearanceCandidate(inputs);
  for(const cancelAt of [null,0,.6,1.3,1.7,2.7,4.1,5.5,6.8,7.4]){
    let previous;
    for(let i=0;i<=1080;i++){
      const time=i/120,options={cancelAt},a=base.sample(time,options),b=candidate.sample(time,options);
      const offset=new T.Vector3().fromArray(b.cup.center).sub(new T.Vector3().fromArray(a.cup.center));
      assert.ok(offset.length()<=.0098+1e-12);assert.equal(offset.x,0);assert.equal(offset.y,0);
      for(const [name,hand] of Object.entries(inputs.config.hands)){
        for(const anchor of [hand.root,hand.gripSource]){
          const before=new T.Vector3().fromArray(anchor).applyMatrix4(a.matrices[name]);
          const after=new T.Vector3().fromArray(anchor).applyMatrix4(b.matrices[name]);
          assert.ok(after.sub(before).sub(offset).length()<1e-12);
        }
        for(let j=0;j<16;j++)if(j!==14)assert.equal(a.matrices[name].elements[j],b.matrices[name].elements[j]);
      }
      assert.deepEqual(a.cup.quaternion,b.cup.quaternion);assert.equal(a.cup.scale,b.cup.scale);
      if(a.lift===1||a.handEntry===0)assert.deepEqual(b,a);
      // The added translation has no cancellation reset or discontinuous branch.
      // Quintic smoothstep has maximum slope 1.875; the fastest changed
      // segment is the existing 0.32-second cancellation lift rewind.
      if(previous!==undefined)assert.ok(Math.abs(offset.z-previous)<=.0098*1.875/.32/120+1e-12);
      previous=offset.z;
    }
    if(cancelAt!==null){
      const a=candidate.sample(cancelAt-1e-9<0?0:cancelAt-1e-9),b=candidate.sample(cancelAt,{cancelAt});
      assert.ok(new T.Vector3().fromArray(a.cup.center).distanceTo(new T.Vector3().fromArray(b.cup.center))<1e-8);
    }
  }
  for(const time of [0,1.5,3.4,7.2,9])assert.deepEqual(candidate.sample(time,{reducedMotion:true}),base.sample(time,{reducedMotion:true}));
  assert.deepEqual(inputs,original);
});
