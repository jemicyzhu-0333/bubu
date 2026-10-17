import test from 'node:test';
import assert from 'node:assert/strict';
import {bindFacePaths} from '../src/face-binding.mjs';
const ids=['04','N3','A7','07','S5','R0','N2'];
function fixture(){
 const paths=ids.map(id=>({id,knots:Array.from({length:8},(_,i)=>({target:id+'_'+i,at:(i+1)/8}))}));
 const names=paths.flatMap(p=>p.knots.map(k=>k.target)),meshes=Array.from({length:8},(_,i)=>({name:'face_'+i,isMesh:true,morphTargetInfluences:Array(56).fill(0),morphTargetDictionary:Object.fromEntries(names.map((n,i)=>[n,i]))}));
 return {meshes,binding:bindFacePaths({getObjectByName:name=>meshes.find(m=>m.name===name)},{faceMeshes:meshes.map(m=>m.name),paths})};
}
test('single semantic path maps every knot and intermediate on all eight layers',()=>{
 const {meshes,binding}=fixture();
 for(let idIndex=0;idIndex<ids.length;idIndex++)for(let step=0;step<=128;step++) {
  const id=ids[idIndex],amount=step/128;binding.apply(id,amount);binding.assertCurrent(id,amount);
  for(const mesh of meshes){const weights=mesh.morphTargetInfluences;assert(weights.every((v,i)=>v>=0&&v<=1&&(i>=idIndex*8&&i<(idIndex+1)*8||v===0)));assert(weights.filter(v=>v!==0).length<=2);assert(Math.abs(weights.reduce((a,b)=>a+b,0)-Math.min(1,amount*8))<1e-15);}
 }
 binding.apply(null,0);assert(meshes.every(m=>m.morphTargetInfluences.every(w=>w===0)));binding.dispose();
});
test('mapping rejects invalid requests and detects unowned layer weights',()=>{
 const {binding,meshes}=fixture();
 for(const [id,value]of [['missing',0],[null,.1],['04',NaN],['04',-1],['04',1.01]]){assert.throws(()=>binding.apply(id,value));assert.throws(()=>binding.assertCurrent(id,value));}
 binding.apply('N3',.65);meshes[6].morphTargetInfluences[0]=.1;assert.throws(()=>binding.assertCurrent('N3',.65),{code:'FACE_INVARIANT'});
 binding.apply(null,0);binding.assertCurrent(null,0);binding.dispose();binding.dispose();assert.throws(()=>binding.apply(null,0),{code:'DISPOSED'});
});
