import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRigidTeaController} from '../../original-parts-hybrid-v1/tea/src/rigid-tea.mjs';
import {createTeaSceneResources} from '../../original-parts-hybrid-v1/tea/src/scene-resources.mjs';
import {normalizeTeaSample} from './tea-sample-boundary.mjs';
const read=name=>JSON.parse(fs.readFileSync(new URL(`../../original-parts-hybrid-v1/tea/inputs/${name}.json`,import.meta.url)));
const controller=createRigidTeaController({config:read('rigid-config'),hold:read('hold-fit'),sip:read('sip-fit')});
test('exact cancellation endpoints survive strict render admission without changing frozen inputs',()=>{
  const cup=createTeaSceneResources();let reproduced=0;
  try{
    for(const cancelAt of [1.3,1.7,4.1,5.5,6.8]){
      const at=controller.sample(cancelAt),fade=at.cupScale>0?.18:0,rewind=at.lift>0?.32:0;
      for(const time of [cancelAt+fade,cancelAt+fade+rewind,cancelAt+fade+rewind+.6]){
        const source=controller.sample(time,{cancelAt}),before=structuredClone(source);
        if(source.cup.scale<0){reproduced++;assert.throws(()=>cup.apply(source),/Valid cup sample/);}
        const sample=normalizeTeaSample(source);cup.apply(sample);
        assert.equal(sample.matrices,source.matrices);assert.deepEqual(structuredClone(source),before);
        assert.ok(sample.cup.scale>=0&&sample.cup.scale<=1);
      }
    }
    assert.ok(reproduced>=4);
    const valid=controller.sample(3.4);assert.equal(normalizeTeaSample(valid),valid);
    for(const invalid of [-1e-6,1+1e-6,NaN,Infinity])assert.throws(()=>normalizeTeaSample({...valid,cupScale:invalid,cup:{...valid.cup,scale:invalid}}),/outside unit range/);
    assert.throws(()=>normalizeTeaSample({...valid,cup:{...valid.cup,scale:.5}}),/Inconsistent/);
  }finally{cup.dispose();}
});
