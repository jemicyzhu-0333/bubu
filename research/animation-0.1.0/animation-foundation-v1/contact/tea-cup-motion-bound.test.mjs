import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as T from 'three';
import {createTeaClearanceCandidate} from './tea-clearance-candidate.mjs';
import {cupMotionBound} from './tea-cup-motion-bound.mjs';
const read=name=>JSON.parse(fs.readFileSync(new URL(`../../original-parts-hybrid-v1/tea/inputs/${name}.json`,import.meta.url)));
const inputs={config:read('rigid-config'),hold:read('hold-fit'),sip:read('sip-fit')};
test('analytic cup bound encloses actual transformed sphere points through timeline and cancellation segments',()=>{
  const controller=createTeaClearanceCandidate(inputs),radius=.6;
  const points=Array.from({length:31},(_,i)=>new T.Vector3(Math.cos(i*2.3),Math.sin(i*2.3),Math.cos(i*1.7)).normalize().multiplyScalar(radius));
  const transform=(p,s)=>p.clone().multiplyScalar(s.cup.scale).applyQuaternion(new T.Quaternion(...s.cup.quaternion)).add(new T.Vector3(...s.cup.center));
  for(const cancelAt of [null,1.3,2.7,4.1,6.8]){
    const knots=[0,1.2,1.5,2,3.4,4.8,6.2,6.6,6.9,8.1,9];
    if(cancelAt!==null){const at=controller.sample(cancelAt),fade=at.cupScale>0?.18:0,rewind=at.lift>0?.32:0;knots.push(cancelAt,cancelAt+fade,cancelAt+fade+rewind,cancelAt+fade+rewind+.6);}
    const times=[...new Set(knots)].sort((a,b)=>a-b);
    for(let i=1;i<times.length;i++){
      const start=times[i-1],end=times[i],options={cancelAt},a=controller.sample(start,options),middle=controller.sample((start+end)/2,options),b=controller.sample(end,options),bound=cupMotionBound(a,middle,b,{...inputs,radius});
      for(let j=0;j<=20;j++){
        const state=controller.sample(start+(end-start)*j/20,options);
        for(const p of points)assert.ok(transform(p,state).distanceTo(transform(p,middle))<=bound+1e-12);
      }
    }
  }
  const s=controller.sample(1.7);assert.throws(()=>cupMotionBound(s,{...s,lift:.5},s,{...inputs,radius}),/Monotone/);
});
