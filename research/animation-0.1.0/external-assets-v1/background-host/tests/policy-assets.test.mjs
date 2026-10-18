import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fixture,calibration} from './fixtures.mjs';
import {backgrounds,validateBackground} from '../src/background-descriptors.mjs';
import {createTableProxy} from '../src/contact-proxy.mjs';
import {screenComposition} from '../src/screen-composition.mjs';
import {stageMetrics} from '../src/stage-metrics.mjs';

test('existing coordinator keeps focus across midnight, detection/coffee changes; selection invoked once',async()=>{
 const f=fixture(),h=f.makeHost();const initial=f.coordinator.plan(0).base;await h.reconcile();
 for(const t of [1,30000,600000,900000,86400000,86400001]) {
   f.setNow(t);f.fact('detection',t+1000,t+1,['detection:AI','detection:coding','detection:music'][t%3]);
   f.fact('routine',t+600000,t+1);const r=await h.reconcile();
   assert.equal(r.selectionToken,initial.selectionToken);assert.deepEqual(f.coordinator.plan(t).base,initial);
 }
 f.coordinator.setSourceGeneration('detection',2,false,86400001);await h.reconcile();
 assert.equal(f.selected,1);assert.deepEqual(f.coordinator.plan(86400001).base,initial);h.dispose();
});
for(const ttl of [30000,600000,900000]) test(`external fact TTL ${ttl} is exact; duplicates don't extend`,async()=>{
 const f=fixture(),h=f.makeHost();f.fact('routine',ttl);await h.reconcile();f.setNow(ttl-1);
 f.coordinator.applySnapshots([{sourceId:'routine',generation:1,revision:1,facts:[{id:'routine',key:'theme:coffee',observedAt:0,expiresAt:ttl}]}],ttl-1);
 assert.deepEqual((await h.reconcile()).ids,['focused','coffee-decoration']);
 f.setNow(ttl);assert.deepEqual((await h.reconcile()).ids,['focused']);h.dispose();
});
test('independent feed/routine origins: expiry and revocation do not erase another origin',async()=>{
 const f=fixture(),h=f.makeHost();f.fact('feed',30000);f.fact('routine',900000);await h.reconcile();
 f.setNow(30000);assert.deepEqual((await h.reconcile()).ids,['focused','coffee-decoration']);
 f.coordinator.applySnapshots([{sourceId:'feed',generation:1,revision:2,facts:[]}],30000);
 assert.deepEqual((await h.reconcile()).ids,['focused','coffee-decoration']);
 f.coordinator.applySnapshots([{sourceId:'routine',generation:1,revision:2,facts:[]}],30000);
 assert.deepEqual((await h.reconcile()).ids,['focused']);h.dispose();
});
test('asset hashes match source copies and screen descriptor admits no contact depth',async()=>{
 for(const d of Object.values(backgrounds)) {
  const bytes=await readFile(new URL('../'+d.asset.path,import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),d.asset.sha256);assert.equal(bytes.toString('hex',1,4),'504e47');
  assert.equal(validateBackground(d),true);assert.equal(d.space,'screen');assert.deepEqual(d.supportSurfaces,[]);
 }
 assert.throws(()=>validateBackground({...backgrounds.focused,interactive:true}));
 assert.throws(()=>validateBackground({...backgrounds.focused,cssShadow:true}));
});
test('separate proxy top is real indexed geometry with explicit calibration; not imported PNG depth',()=>{
 const p=createTableProxy({center:[1,.4,2],width:2,depth:1,thickness:.1});
 assert.equal(p.vertices.length,24);assert.equal(p.indices.length,36);assert.equal(p.contact.constant,-.4);assert.equal(p.visualApproval,false);
 assert.deepEqual(p.contact.bounds,{minX:0,maxX:2,minZ:1.5,maxZ:2.5});assert.equal(p.actorAttachment,null);
 assert.throws(()=>createTableProxy({center:[0,0,0],width:0,depth:1,thickness:.1}));
});
test('composition uses back layers only and one V1 mask, no CSS+3D shadows or hit growth',()=>{
 const c=screenComposition(Object.values(backgrounds),stageMetrics(calibration));
 assert.equal(c.layers.length,2);assert.deepEqual(c.layers[1].imageRect,[20,30,180,142]);
 assert.equal(c.mask.frameOpacity,.56);assert.equal(c.affectsHitTesting,false);assert.deepEqual(c.contactSurfaces,[]);
 assert.deepEqual(c.frame,{x:18,y:27,width:184,height:148});assert.equal(c.performing,false);
});
