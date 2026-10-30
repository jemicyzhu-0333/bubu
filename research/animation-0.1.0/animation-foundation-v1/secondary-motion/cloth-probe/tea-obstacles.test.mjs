import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {loadGLB,disposeAsset,hybrid} from '../../integration/asset-fixtures.mjs';
import {createTeaClearanceCandidate} from '../../contact/tea-clearance-candidate.mjs';
import {createTeaObstacles} from './tea-obstacles.mjs';

test('moving obstacle snapshots match both frozen hand exports at rest and sip',async()=>{
  const inputs=Object.fromEntries([['config','rigid-config'],['hold','hold-fit'],['sip','sip-fit']].map(([key,name])=>[key,JSON.parse(fs.readFileSync(new URL(`../../../original-parts-hybrid-v1/tea/inputs/${name}.json`,import.meta.url)))]));
  const controller=createTeaClearanceCandidate(inputs),asset=await loadGLB(hybrid),owned=createTeaObstacles(asset);
  const diag=new URL('../../integration/diagnostics/contact-contract-20261019/',import.meta.url);
  const exports=JSON.parse(fs.readFileSync(new URL('inputs/tea-keyframes.json',diag)));
  const before=asset.getObjectByName('Bubu_hand-left').geometry.attributes.position.array.slice();
  try{
    for(const time of [0,3.4]){
      owned.apply(controller.sample(time));
      const frame=exports.frames.find(f=>f.time===time);
      for(const entry of owned.entries.filter(e=>e.kind==='hand')){
        const mesh=frame.meshes.find(m=>m.name===entry.name),bytes=fs.readFileSync(new URL(mesh.positionsFile,diag));
        const expected=new Float32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)),actual=entry.geometry.attributes.position.array;
        assert.equal(actual.length,expected.length);let maximum=0;
        for(let i=0;i<actual.length;i++)maximum=Math.max(maximum,Math.abs(actual[i]-expected[i]));
        assert(maximum<2e-7,`${entry.name} at ${time}: ${maximum}`);
      }
      assert.equal(owned.entries.filter(e=>e.kind==='cup'&&e.visible).length>0,time>0);
    }
    assert.deepEqual(asset.getObjectByName('Bubu_hand-left').geometry.attributes.position.array,before);
    owned.dispose();owned.dispose();assert.throws(()=>owned.apply(controller.sample(0)),/disposed/);
  }finally{owned.dispose();disposeAsset(asset);}
});
