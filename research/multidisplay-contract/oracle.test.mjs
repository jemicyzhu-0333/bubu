import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createTopologyOracle } from './oracle.mjs';
const require = createRequire(import.meta.url);
const sample = (oracle, displays) => oracle.observe(displays, oracle.beginEnumeration());
const { createPetPointerSpace } = require('../../src/platform/electron/windows/pet-pointer-space');
// Observed Windows logical layout; both 1.25 scales here are synthetic, not a second-panel measurement.
const fixture = () => [{ id: 1, rotation: 0, scaleFactor: 1.25, bounds: { x: 0, y: 0, width: 2048, height: 1152 } },
 { id: 2, rotation: 0, scaleFactor: 1.25, bounds: { x: 2048, y: -252, width: 2048, height: 1152 } }];
test('production remains fail-closed for actual-layout-shaped two-display fixture', () => {
 const read = createPetPointerSpace({ screen: { getAllDisplays: fixture }, platform: 'win32', versions: { electron: '44.10.1', chrome: '152.0.7977.169' } });
 assert.equal(read().reason, 'display-topology-unverified'); assert.equal(read().kind, 'client');
});
test('DIP delta is not multiplied by display scale or DPR', () => {
 const o = createTopologyOracle(), s = sample(o, fixture());
 assert.deepEqual(o.segment({ x: 2100, y: -100 }, { x: 2110, y: -90 }, s.revision).delta, { x: 10, y: 10 });
 assert.equal(s.productionCapability, false);
});
test('shared edge ownership is half-open but crossing is not admitted', () => {
 const o = createTopologyOracle(), s = sample(o, fixture());
 assert.equal(o.segment({ x: 2047, y: 10 }, { x: 2048, y: 10 }, s.revision).reason, 'cross-display-unverified');
 assert.equal(o.segment({ x: 2048, y: 10 }, { x: 2049, y: 10 }, s.revision).accepted, true);
 assert.equal(o.segment({ x: 4096, y: 0 }, { x: 4095, y: 0 }, s.revision).accepted, false);
 assert.equal(o.segment({ x: 2047, y: -1 }, { x: 2048, y: -1 }, s.revision).accepted, false);
});
for (const change of ['scale', 'rotation', 'bounds', 'id', 'remove', 'invalid']) test(`topology ${change} invalidates prior revision`, () => {
 const o = createTopologyOracle(), d = fixture(), before = sample(o, d);
 if (change === 'scale') d[1].scaleFactor = 1.5;
 if (change === 'rotation') d[1].rotation = 90;
 if (change === 'bounds') d[1].bounds.y--;
 if (change === 'id') d[1].id++;
 if (change === 'remove') d.pop();
 if (change === 'invalid') d[1].bounds.width = NaN;
 assert.ok(sample(o, d).revision > before.revision);
 assert.equal(o.segment({ x: 10, y: 10 }, { x: 20, y: 20 }, before.revision).reason, 'stale-topology');
});
test('enumeration order does not change revision; output mutation cannot alter ownership', () => {
 const o = createTopologyOracle(), s = sample(o, fixture()); s.displays[0].bounds.width = 99999;
 assert.equal(sample(o, fixture().reverse()).revision, s.revision);
 assert.equal(o.segment({ x: 10, y: 10 }, { x: 5000, y: 10 }, s.revision).accepted, false);
});
for (const kind of ['mixed-DPI', 'rotation', 'overlap', 'duplicate-id', 'invalid-number']) test(`reject ${kind}`, () => {
 const o = createTopologyOracle(), d = fixture();
 if (kind === 'mixed-DPI') d[1].scaleFactor = 2;
 if (kind === 'rotation') d[1].rotation = 90;
 if (kind === 'overlap') d[1].bounds.x = 100;
 if (kind === 'duplicate-id') d[1].id = 1;
 if (kind === 'invalid-number') d[1].bounds.x = Infinity;
 const s = sample(o, d); assert.ok(s.reason); assert.equal(o.segment({ x: 10, y: 10 }, { x: 20, y: 20 }, s.revision).accepted, false);
});
for (const event of ['display-added', 'display-removed', 'display-metrics-changed', 'resume', 'unlock-screen', 'suspend', 'lock-screen']) test(`same snapshot cannot preserve authority across ${event}`, () => {
 const o = createTopologyOracle(), a = sample(o, fixture()), from = { x: 10, y: 10 }, to = { x: 20, y: 20 };
 assert.equal(o.commitSegment(from, to, a.revision, a.epoch).accepted, true);
 const revoked = o.invalidateEvent(event);
 assert.equal(o.commitSegment(from, to, a.revision, a.epoch).reason, 'stale-epoch');
 assert.equal(o.commitSegment(from, to, revoked.revision, revoked.epoch).accepted, false, 'no grant before re-enumeration');
 const b = sample(o, fixture()); assert.ok(b.epoch > a.epoch); assert.ok(b.revision > a.revision);
 assert.equal(o.commitSegment(from, to, b.revision, a.epoch).reason, 'stale-epoch');
 assert.equal(o.commitSegment(from, to, b.revision, b.epoch).accepted, true);
});
test('queued proposal must recheck epoch at commit; no observed event means unknowable gap', () => {
 const o = createTopologyOracle(), a = sample(o, fixture()), from = { x: 10, y: 10 }, to = { x: 20, y: 20 };
 const queued = { revision: a.revision, epoch: a.epoch };
 assert.equal(sample(o, fixture()).epoch, a.epoch, 'content alone cannot detect unobserved removal+addition');
 o.invalidateEvent('display-removed'); o.invalidateEvent('display-added'); sample(o, fixture());
 assert.equal(o.commitSegment(from, to, queued.revision, queued.epoch).reason, 'stale-epoch');
});
test('gap points fail but valid same-screen segments do not reject whole gapped topology', () => {
 const o = createTopologyOracle(), d = fixture(); d[1].bounds.x = 3000; const s = sample(o, d);
 assert.equal(s.reason, null);
 assert.equal(o.segment({ x: 2500, y: 10 }, { x: 2501, y: 10 }, s.revision).accepted, false);
 assert.equal(o.segment({ x: 10, y: 10 }, { x: 20, y: 10 }, s.revision).accepted, true);
});
test('bounds attribution does not implement workArea placement clamp', () => {
 const o = createTopologyOracle(), d = fixture(); d[0].workArea = { ...d[0].bounds, height: 1100 }; const s = sample(o, d);
 assert.equal(o.segment({ x: 10, y: 1120 }, { x: 20, y: 1120 }, s.revision).accepted, true);
});
test('pre-revocation enumeration cannot publish under the new epoch', () => {
 const o = createTopologyOracle(), ticket = o.beginEnumeration(), old = fixture();
 const revoked = o.invalidateEvent('display-removed');
 assert.equal(o.observe(old, ticket).reason, 'stale-enumeration');
 assert.equal(o.commitSegment({x:1,y:1}, {x:2,y:2}, revoked.revision, revoked.epoch).reason, 'revoked-awaiting-enumeration');
});
test('out-of-order and replayed tickets cannot replace a newer snapshot', () => {
 const o = createTopologyOracle(), first = o.beginEnumeration(), second = o.beginEnumeration();
 const s = o.observe(fixture(), second);
 const d = fixture(); d[1].scaleFactor=2;
 assert.equal(o.observe(d, first).reason, 'stale-enumeration');
 assert.equal(o.observe(d, second).reason, 'stale-enumeration');
 assert.equal(o.commitSegment({x:1,y:1}, {x:2,y:2}, s.revision,s.epoch).accepted,true);
});
test('missing, forged and foreign-oracle enumeration tickets fail closed', () => {
 const o = createTopologyOracle(), other = createTopologyOracle(), ticket = o.beginEnumeration();
 for (const t of [undefined, {...ticket}, other.beginEnumeration()]) assert.equal(o.observe(fixture(),t).reason,'stale-enumeration');
 assert.equal(o.observe(fixture(),ticket).reason,null);
});
for (const cause of ['event', 'new-enumeration']) test(`normalization reentry cannot publish after ${cause}`, () => {
 const o = createTopologyOracle(), ticket=o.beginEnumeration(), d=fixture();
 Object.defineProperty(d[0], 'id', {get() { if(cause==='event') o.invalidateEvent('lock-screen'); else o.beginEnumeration(); return 1; }});
 assert.equal(o.observe(d,ticket).reason,'stale-enumeration');
});
test('throwing getter consumes ticket and produces a classified fail-closed snapshot', () => {
 const o=createTopologyOracle(), t=o.beginEnumeration();
 const bad=[{get id(){throw new Error('private diagnostic must not escape');}}];
 const s=o.observe(bad,t); assert.equal(s.reason,'enumeration-failed'); assert.equal(s.displays,null);
 assert.equal(o.observe(fixture(),t).reason,'stale-enumeration');
 assert.equal(o.commitSegment({x:1,y:1},{x:2,y:2},s.revision,s.epoch).reason,'enumeration-failed');
});
test('invalid function or object values return cloneable failure state, never a partial publication exception', () => {
 for(const id of [()=>1, {toJSON(){throw Error('must not serialize caller object');}}]) {
  const o=createTopologyOracle(),d=fixture();d[0].id=id;
  const s=o.observe(d,o.beginEnumeration());assert.equal(s.reason,'invalid-topology');assert.equal(s.displays,null);
  assert.doesNotThrow(()=>structuredClone(s));
 }
});
test('reentrant replay during normalization cannot reuse a consumed ticket', () => {
 const o=createTopologyOracle(),t=o.beginEnumeration(),d=fixture();let nested;
 Object.defineProperty(d[0],'id',{get(){nested=o.observe(fixture(),t);return 1;}});
 assert.equal(o.observe(d,t).reason,null);assert.equal(nested.reason,'stale-enumeration');
});
test('exception after reentrant newer publication cannot clobber newer snapshot', () => {
 const o=createTopologyOracle(),t=o.beginEnumeration(),d=fixture();let newer;
 Object.defineProperty(d[0],'id',{get(){newer=o.observe(fixture(),o.beginEnumeration());throw Error('old read failed');}});
 assert.equal(o.observe(d,t).reason,'stale-enumeration');
 assert.equal(o.commitSegment({x:1,y:1},{x:2,y:2},newer.revision,newer.epoch).accepted,true);
});
test('exception after revocation leaves oracle awaiting enumeration', () => {
 const o=createTopologyOracle(),t=o.beginEnumeration();let revoked;
 const d=[{get id(){revoked=o.invalidateEvent('suspend');throw Error('old read failed');}}];
 assert.equal(o.observe(d,t).reason,'stale-enumeration');
 assert.equal(o.commitSegment({x:1,y:1},{x:2,y:2},revoked.revision,revoked.epoch).reason,'revoked-awaiting-enumeration');
});
test('sparse topology slots fail closed, even when an inherited entry fills a hole', () => {
 for (const d of [new Array(1), new Array(2), [fixture()[0], , fixture()[1]]]) {
  const o=createTopologyOracle(),s=o.observe(d,o.beginEnumeration());
  assert.equal(s.reason,'enumeration-failed');assert.equal(s.displays,null);
 }
 const d=new Array(1),proto=Object.create(Array.prototype);proto[0]=fixture()[0];Object.setPrototypeOf(d,proto);
 const o=createTopologyOracle();assert.equal(o.observe(d,o.beginEnumeration()).reason,'enumeration-failed');
});
test('proxy slot-presence reentry cannot publish after revocation', () => {
 const o=createTopologyOracle(),ticket=o.beginEnumeration();
 const d=new Proxy(fixture(),{getOwnPropertyDescriptor(target,key){if(key==='0')o.invalidateEvent('lock-screen');return Reflect.getOwnPropertyDescriptor(target,key);}});
 assert.equal(o.observe(d,ticket).reason,'stale-enumeration');
});
test('a getter deleting a later display slot cannot publish a partial topology', () => {
 const o=createTopologyOracle(),d=fixture();Object.defineProperty(d[0],'id',{get(){delete d[1];return 1;}});
 assert.equal(o.observe(d,o.beginEnumeration()).reason,'enumeration-failed');
});
test('proxy length is captured once so changes cannot fabricate an empty accepted topology', () => {
 let reads=0;const d=new Proxy(fixture(),{get(target,key,receiver){if(key==='length')return ++reads===1?2:0;return Reflect.get(target,key,receiver);}});
 const o=createTopologyOracle(),s=o.observe(d,o.beginEnumeration());assert.equal(reads,1);assert.equal(s.displays.length,2);
});
