import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,gate} from './fixtures.mjs';

test('focus base + coffee attach, environment only; idempotent refresh has no extra load/commit',async()=>{
 const f=fixture(),h=f.makeHost(),actorBefore=structuredClone(f.actor);f.fact('routine',600000);
 const result=await h.reconcile();assert.deepEqual(result.ids,['focused','coffee-decoration']);assert.equal(result.performing,false);assert.equal(result.visible,false);
 const count=f.attached.length;await h.reconcile();assert.equal(f.attached.length,count);assert.equal(f.loaded.length,2);
 h.dispose();assert.deepEqual(f.actor,actorBefore);assert.equal(f.pool.stats().leases,0);assert.equal(f.disposed.length,2);
});
test('two actors share resource; first dispose cannot destroy second environment or actor resources',async()=>{
 const f=fixture(),a=f.makeHost(),b=f.makeHost();await Promise.all([a.reconcile(),b.reconcile()]);
 assert.equal(f.loaded.length,1);assert.equal(f.pool.stats().leases,2);
 a.dispose();a.dispose();assert.deepEqual(f.surfaces[0].mounted,[]);assert.deepEqual(f.surfaces[1].mounted,['focused']);assert.equal(f.disposed.length,0);assert.equal(f.pool.stats().leases,1);
 b.dispose();assert.equal(f.disposed.length,1);assert.equal(f.pool.stats().entries,0);assert.equal(f.actor.prop.id,'cup');
});
for(const action of ['cancel','dispose','suspend']) test(`${action} before prepare completion releases late result exactly once`,async()=>{
 const g=gate(),f=fixture({load:()=>g.promise}),h=f.makeHost();const pending=h.reconcile();await Promise.resolve();
 h[action]();g.resolve({id:'late'});assert.equal((await pending).state,'stale');
 assert.equal(f.disposed.length,1);assert.equal(f.pool.stats().leases,0);assert.equal(f.attached.some(x=>x.length),false);h.dispose();
});
test('stale old session with reused session id rejected by selectionToken',async()=>{
 const g=gate(),f=fixture({load:()=>g.promise}),h=f.makeHost();const pending=h.reconcile();await Promise.resolve();
 const p=f.coordinator.plan(0);f.coordinator.endFocus('focus-1',p.base.selectionToken,0);f.start('focus-1');
 g.resolve({id:'old'});const r=await pending;assert.equal(r.state,'stale');assert.equal(f.disposed.length,1);assert.equal(f.selected,2);
 assert.equal(f.attached.some(x=>x.length),false);h.dispose();
});
test('same-display source revision invalidates async result through validityGeneration',async()=>{
 const g=gate(),f=fixture({load:()=>g.promise}),h=f.makeHost();const pending=h.reconcile();await Promise.resolve();
 f.coordinator.applySnapshots([{sourceId:'detection',generation:1,revision:1,facts:[]}],0);
 g.resolve({id:'old-validity'});assert.equal((await pending).state,'stale');assert.equal(f.disposed.length,1);h.dispose();
});
test('coffee expires between load and commit; no overlay resurrected',async()=>{
 const g=gate(),f=fixture({load:()=>g.promise}),h=f.makeHost();f.fact('feed',30000);
 const pending=h.reconcile();await Promise.resolve();f.setNow(30000);g.resolve({id:'loaded'});
 assert.equal((await pending).state,'stale');assert.equal(f.attached.some(x=>x.length),false);
 const r=await h.reconcile();assert.deepEqual(r.ids,['focused']);h.dispose();
});
test('hidden/context lost resume re-plans TTL before attaching; no actor reset',async()=>{
 const f=fixture(),h=f.makeHost();f.fact('feed',30000);await h.reconcile();h.suspend();f.setNow(30000);
 const r=await h.resume();assert.deepEqual(r.ids,['focused']);assert.equal(f.actor.clock,37);h.dispose();
});
test('resource rejection is blocked, selected identity retained, no fallback',async()=>{
 const f=fixture({load:()=>Promise.reject(Error('decode'))}),h=f.makeHost();
 const r=await h.reconcile();assert.equal(r.state,'blocked');assert.equal(r.selectionToken,1);assert.equal(f.selected,1);assert.equal(f.pool.stats().entries,0);h.dispose();
});
test('atomic commit failure releases environment resources and does not touch actor',async()=>{
 const f=fixture();f.surface.commit=()=>{throw Error('commit-failed');};const h=f.makeHost();
 assert.equal((await h.reconcile()).state,'blocked');assert.equal(f.disposed.length,1);assert.equal(f.actor.clock,37);h.dispose();
});
test('100 mount/unmount cycles return to baseline; no timer or idle redraw',async()=>{
 const f=fixture();for(let i=0;i<100;i++){const h=f.makeHost();await h.reconcile();await h.reconcile();h.dispose();}
 assert.deepEqual(f.pool.stats(),{entries:0,leases:0});assert.equal(f.loaded.length,100);assert.equal(f.disposed.length,100);
});
test('old generation completion cannot dispose newer same-resource generation',async()=>{
 const old=gate(),newer=gate();let n=0;const f=fixture({load:()=>++n===1?old.promise:newer.promise}),h=f.makeHost();
 const p=h.reconcile();await Promise.resolve();h.cancel();const q=h.reconcile();await Promise.resolve();
 newer.resolve({id:'new'});assert.equal((await q).state,'attached');old.resolve({id:'old'});assert.equal((await p).state,'stale');
 assert.deepEqual(f.disposed.map(x=>x.id),['old']);assert.equal(f.pool.stats().leases,1);h.dispose();assert.deepEqual(f.disposed.map(x=>x.id),['old','new']);
});
test('one failed parallel load releases another late successful resource',async()=>{
 const g=gate(),f=fixture({load:d=>d.id==='focused'?Promise.reject(Error('base-failed')):g.promise}),h=f.makeHost();
 f.fact('routine',600000);assert.equal((await h.reconcile()).state,'blocked');assert.equal(f.pool.stats().leases,0);
 g.resolve({id:'coffee-late'});await new Promise(resolve=>setImmediate(resolve));assert.equal(f.disposed.length,1);h.dispose();
});
test('disposed host cannot be revived by cancel, suspend, resume or reconcile',async()=>{
 const f=fixture(),h=f.makeHost();await h.reconcile();h.dispose();h.cancel();h.suspend();await h.resume();await h.reconcile();
 assert.equal(h.snapshot().state,'disposed');assert.equal(f.loaded.length,1);assert.equal(f.disposed.length,1);
});
test('identical overlapping refreshes share one pending preparation and cannot starve decode',async()=>{
 const g=gate(),f=fixture({load:()=>g.promise}),h=f.makeHost();const first=h.reconcile();
 await Promise.resolve();const others=Array.from({length:100},()=>h.reconcile());
 assert.equal(f.loaded.length,1);assert.equal(f.pool.stats().leases,1);
 g.resolve({id:'shared-preparation'});const results=await Promise.all([first,...others]);
 assert.ok(results.every(r=>r.state==='attached'));assert.equal(f.attached.filter(x=>x.length).length,1);h.dispose();
});
