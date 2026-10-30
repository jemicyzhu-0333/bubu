import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as T from 'three';
import {teaHandMotionBounds} from './tea-hand-motion-bound.mjs';
import {createTeaClearanceCandidate} from './tea-clearance-candidate.mjs';
import {loadGLB,disposeAsset,hybrid} from '../integration/asset-fixtures.mjs';
const inputs=Object.fromEntries([['config','rigid-config'],['hold','hold-fit'],['sip','sip-fit']].map(([k,v])=>[k,JSON.parse(fs.readFileSync(new URL(`../../original-parts-hybrid-v1/tea/inputs/${v}.json`,import.meta.url)))]));

test('analytic hand bounds contain actual frozen-controller vertex displacement on both branches and cancellation',async()=>{
  const asset=await loadGLB(hybrid),controller=createTeaClearanceCandidate(inputs);asset.updateMatrixWorld(true);
  try{for(const [hand,name]of [['handL','Bubu_hand-left'],['handR','Bubu_hand-right']]){
    const mesh=asset.getObjectByName(name),positions=[];
    for(let i=0;i<mesh.geometry.attributes.position.count;i++)positions.push(...new T.Vector3().fromBufferAttribute(mesh.geometry.attributes.position,i).applyMatrix4(mesh.matrixWorld).toArray());
    const bounds=teaHandMotionBounds(inputs,hand,positions,{forwardOffset:.0098});assert(bounds.restJoinError<1e-10);
    const times=[0,.12,.38,.6,.71,.83,1,1.2,2,2.1,2.4,2.7,3.1,3.4];
    for(const cancelAt of [null,.71,2.7,4.1])for(let i=0;i<times.length-1;i++){
      const a=controller.sample(times[i],{cancelAt}),b=controller.sample(times[i+1],{cancelAt});
      const bound=bounds.entry*Math.abs(a.handEntry-b.handEntry)+bounds.lift*Math.abs(a.lift-b.lift)+1e-9;
      for(let j=0;j<positions.length;j+=3){const p=new T.Vector3().fromArray(positions,j);assert(p.clone().applyMatrix4(a.matrices[hand]).distanceTo(p.applyMatrix4(b.matrices[hand]))<=bound);}
    }
  }}finally{disposeAsset(asset);}
});

test('motion proof rejects unsupported angle branches and nonfinite or degenerate declarations',()=>{
  for(const mutate of [x=>x.config.hands.handL.thetaHold=Math.PI,x=>x.config.exponent=.5,x=>x.config.carrier.height[1]=x.config.carrier.height[0],x=>x.sip.parameters.cupTiltX=Math.PI]){
    const bad=structuredClone(inputs);mutate(bad);assert.throws(()=>teaHandMotionBounds(bad,'handL',[0,0,0]));
  }
  assert.throws(()=>teaHandMotionBounds(inputs,'handL',[NaN,0,0]));
});
