import assert from 'node:assert/strict';
import {N3_CAVITY_MASK,n3CavityGate,N3_CAVITY_STRENGTH} from './n3-cavity-mask.mjs';
const states=['R0','D1','A7','D4','01','N2','N3','T05','07','P2','08','A4','04','A8','S2','S3','T5','S5',null];
assert.equal(N3_CAVITY_MASK.length,704);assert.equal(N3_CAVITY_STRENGTH,.66);
for(const state of states)for(let i=0;i<=64;i++){const amount=i/64,g=n3CavityGate(state,amount);assert.ok(g>=0&&g<=1);if(state!=='N3'||amount<=.375)assert.equal(g,0);}
assert.equal(n3CavityGate('N3',1),1);assert.ok(n3CavityGate('N3',.375+1e-6)<1e-10);assert.ok(1-n3CavityGate('N3',1-1e-6)<1e-10);
assert.equal(N3_CAVITY_MASK.filter(x=>x===0).length,64);
console.log('19 states/Basis × 65 amounts passed; closure and endpoint continuity passed; 64 outer-rim vertices exact black.');
