import assert from 'node:assert/strict';
import {prepareNeutralPack,preparePack} from '../../src/pack-loader.mjs';
import {ActorPool} from '../../src/actor-pool.mjs';
import {localPackReader} from '../../tools/read-local-pack.mjs';
const read=name=>localPackReader(new URL('../../fixtures/'+name+'/',import.meta.url).pathname);
const packs=await Promise.all(['neutral-static05','neutral-r6'].map(n=>prepareNeutralPack(read(n))));
const results=[];const settle=()=>new Promise(r=>setTimeout(r,20));const zero=p=>{const s=p.stats;for(const k of ['actors','vertices','nodes','deformedVertices','sourceBytes','decodedArrayBytes','clipKeyScalars','active','pending'])assert.equal(s[k],0,k);assert.equal(s.cache.retainedReferences,0);};
for(const [i,pack] of packs.entries()) {
 const pool=new ActorPool(),[a,b]=await Promise.all([pool.create(pack),pool.create(pack)]);
 assert.equal(pool.stats.active,2);assert.equal(pool.stats.sourceBytes,pack.manifest.assets.find(x=>x.kind==='glb').bytes);assert.equal(pool.stats.decodedArrayBytes,pack.budget.decodedArrayReservation);
 for(const actor of [a,b]){assert.equal(actor.assertNeutral(),true);assert.equal(actor.advance(1e9),false);for(const api of ['play','enqueue','playClip','setFace'])assert.equal(actor[api],undefined);}
 if(i===1){const skA=[],skB=[];a.root.traverse(o=>{if(o.skeleton)skA.push(o.skeleton)});b.root.traverse(o=>{if(o.skeleton)skB.push(o.skeleton)});assert(skA.length);for(const sk of skA){assert(!skB.includes(sk));for(const bone of sk.bones)assert(!skB.some(t=>t.bones.includes(bone)));}}
 a.dispose();a.dispose();assert.equal(pool.stats.active,1);assert.equal(b.assertNeutral(),true);pool.dispose();await settle();zero(pool);assert.throws(()=>b.advance(0));results.push({name:'two shared '+i,result:'passed',verification:b.verification});
}
for(const scenario of ['abort-immediate','dispose-immediate','abort-one-shared']) {
 const pool=new ActorPool(),c=new AbortController();const p=pool.create(packs[1],{signal:c.signal});const q=scenario==='abort-one-shared'?pool.create(packs[1]):null;
 if(scenario==='dispose-immediate')pool.dispose();else c.abort(new Error('review abort'));
 await assert.rejects(p);if(q){const a=await q;assert(a.assertNeutral());a.dispose();}await settle();pool.dispose();await settle();zero(pool);results.push({name:scenario,result:'passed'});
}
const pool=new ActorPool({limits:{actors:1}}),pending=pool.create(packs[1]);await assert.rejects(pool.create(packs[0]),e=>e.code==='GLOBAL_BUDGET');(await pending).dispose();await settle();zero(pool);results.push({name:'pending cross-purpose admission',result:'passed'});
const limited=new ActorPool({limits:{decodedArrayBytes:packs[1].budget.decodedArrayReservation-1}});await assert.rejects(limited.create(packs[1]),e=>e.code==='GLOBAL_BUDGET');zero(limited);results.push({name:'decoded reservation before parse',result:'passed'});
const mechanical=await preparePack(localPackReader(new URL('../../fixtures/',import.meta.url).pathname));const mixed=new ActorPool({limits:{actors:2}});const [ma,na]=await Promise.all([mixed.create(mechanical),mixed.create(packs[1])]);assert.equal(mixed.stats.active,2);await assert.rejects(mixed.create(packs[0]),e=>e.code==='GLOBAL_BUDGET');mixed.dispose();await settle();zero(mixed);results.push({name:'mechanical and neutral share admission and cleanup',result:'passed'});
console.log(JSON.stringify({scenarios:results.length,results},null,2));
