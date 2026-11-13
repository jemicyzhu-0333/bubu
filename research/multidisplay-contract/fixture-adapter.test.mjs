import test from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';
import {createFixtureTopologyAdapter} from './fixture-adapter.mjs';
const displays=()=>[{id:1,rotation:0,scaleFactor:1.25,bounds:{x:0,y:0,width:2048,height:1152}}];
function fixture(ready=false){const app=new EventEmitter(),screen=new EventEmitter(),powerMonitor=new EventEmitter(),rows=[];let reads=0;
 app.isReady=()=>ready;screen.getAllDisplays=()=>{reads++;return displays();};
 const adapter=createFixtureTopologyAdapter({app,screen,powerMonitor,readBarrierState:()=>({locked:false,suspended:false}),onSnapshot:s=>rows.push(s)});
 return{app,screen,powerMonitor,rows,adapter,reads:()=>reads};}
test('no enumeration or admission before app ready; listeners exist before first read',()=>{
 const f=fixture();assert.equal(f.reads(),0);assert.equal(f.adapter.snapshot().reason,'app-not-ready');
 f.screen.getAllDisplays=()=>{assert.equal(f.screen.listenerCount('display-added'),1);assert.equal(f.powerMonitor.listenerCount('suspend'),1);return displays();};
 f.app.emit('ready');assert.equal(f.adapter.snapshot().reason,null);
});
test('already-ready app starts once; duplicate ready does not add listeners',()=>{const f=fixture(true);f.app.emit('ready');assert.equal(f.reads(),1);assert.equal(f.screen.listenerCount('display-added'),1);});
test('event revokes before enumeration and old epoch cannot commit',()=>{const f=fixture(true),old=f.adapter.snapshot();
 f.screen.getAllDisplays=()=>{assert.equal(f.adapter.snapshot().reason,'revoked-awaiting-enumeration');return displays();};
 f.screen.emit('display-metrics-changed');assert.ok(f.adapter.snapshot().epoch>old.epoch);
 assert.equal(f.adapter.commitSegment({x:1,y:1},{x:2,y:2},old.revision,old.epoch).reason,'stale-epoch');
});
for(const [off,on]of [['suspend','resume'],['lock-screen','unlock-screen']])test(`${off} blocks reads until ${on}`,()=>{
 const f=fixture(true),n=f.reads();f.powerMonitor.emit(off);f.adapter.refresh();assert.equal(f.reads(),n);
 assert.equal(f.adapter.commitSegment({x:1,y:1},{x:2,y:2},1,1).accepted,false);f.powerMonitor.emit(on);assert.equal(f.reads(),n+1);
});
test('lock and suspend are independent barriers',()=>{const f=fixture(true),n=f.reads();f.powerMonitor.emit('lock-screen');f.powerMonitor.emit('suspend');f.powerMonitor.emit('resume');assert.equal(f.reads(),n);f.powerMonitor.emit('unlock-screen');assert.equal(f.reads(),n+1);});
test('event reentry during enumeration discards old ticket then reads again',()=>{const f=fixture(true);let n=0;
 f.screen.getAllDisplays=()=>{if(++n===1)f.screen.emit('display-removed');return displays();};f.adapter.refresh();assert.equal(n,2);assert.equal(f.adapter.snapshot().reason,null);
});
test('repeated reentry is bounded and leaves revoked state',()=>{const f=fixture(true);let n=0;f.screen.getAllDisplays=()=>{n++;f.screen.emit('display-added');return displays();};f.adapter.refresh();assert.equal(n,4);assert.equal(f.adapter.snapshot().reason,'revoked-awaiting-enumeration');});
test('enumeration exception publishes invalid fail-closed state',()=>{const f=fixture(true);f.screen.getAllDisplays=()=>{throw Error('private error')};f.adapter.refresh();assert.equal(f.adapter.snapshot().reason,'invalid-topology');});
test('dispose removes all listeners, late ready/events cannot read',()=>{const f=fixture(),n=f.reads();f.adapter.dispose();f.app.emit('ready');assert.equal(f.reads(),n);assert.equal(f.adapter.snapshot().reason,'adapter-disposed');const g=fixture(true);g.adapter.dispose();assert.equal(g.screen.listenerCount('display-added'),0);assert.equal(g.powerMonitor.listenerCount('suspend'),0);});
test('failed subscription cannot refresh/admit; explicit retry installs all listeners first',()=>{
 const f=fixture();const original=f.powerMonitor.on;f.powerMonitor.on=()=>{throw Error('subscription failed');};
 assert.doesNotThrow(()=>f.app.emit('ready'));assert.equal(f.adapter.snapshot().reason,'subscription-failed');
 f.adapter.refresh();assert.equal(f.reads(),0);assert.equal(f.screen.listenerCount('display-added'),0);
 assert.equal(f.adapter.commitSegment({x:1,y:1},{x:2,y:2},1,1).accepted,false);
 f.powerMonitor.on=original;f.adapter.retryStart();assert.equal(f.reads(),1);assert.equal(f.powerMonitor.listenerCount('suspend'),1);
});
test('subscription-time event reentry cannot read before all listeners are installed',()=>{
 const f=fixture();const original=f.screen.on;f.screen.on=function(e,h){const result=original.call(this,e,h);if(e==='display-added')this.emit(e);return result;};
 let reads=0;f.screen.getAllDisplays=()=>{reads++;assert.equal(f.powerMonitor.listenerCount('unlock-screen'),1);return displays();};
 f.app.emit('ready');assert.equal(reads,1);assert.equal(f.adapter.snapshot().reason,null);
});
test('subscribe-then-throw is rolled back, without duplicate callbacks on retry',()=>{
 const f=fixture();const original=f.powerMonitor.on;f.powerMonitor.on=function(e,h){original.call(this,e,h);throw Error('after subscribe');};
 f.app.emit('ready');assert.equal(f.powerMonitor.listenerCount('suspend'),0);f.powerMonitor.on=original;
 f.adapter.retryStart();assert.equal(f.powerMonitor.listenerCount('suspend'),1);
});
test('dispose publishes closed before isolated cleanup; failed cleanup is retryable',()=>{
 const f=fixture(true),remove=f.screen.removeListener;let fail=true;
 f.screen.removeListener=function(e,h){assert.equal(f.adapter.snapshot().reason,'adapter-disposed');if(fail)throw Error('cleanup failed');return remove.call(this,e,h);};
 assert.doesNotThrow(()=>f.adapter.dispose());assert.equal(f.adapter.snapshot().reason,'adapter-disposed-cleanup-unverified');
 assert.equal(f.powerMonitor.listenerCount('suspend'),0);assert.equal(f.adapter.commitSegment({x:1,y:1},{x:2,y:2},1,1).accepted,false);
 const n=f.reads();f.screen.emit('display-added');assert.equal(f.reads(),n);
 fail=false;f.adapter.dispose();assert.equal(f.screen.listenerCount('display-added'),0);assert.equal(f.adapter.snapshot().reason,'adapter-disposed');
});
test('failed rollback blocks retry until dangling subscriptions are removed',()=>{
 const f=fixture(),on=f.powerMonitor.on,remove=f.screen.removeListener;f.powerMonitor.on=()=>{throw Error('subscribe');};f.screen.removeListener=()=>{throw Error('cleanup');};
 f.app.emit('ready');f.powerMonitor.on=on;f.adapter.retryStart();assert.equal(f.reads(),0);assert.equal(f.adapter.snapshot().reason,'subscription-cleanup-unverified');
 f.screen.removeListener=remove;f.adapter.retryStart();assert.equal(f.reads(),1);assert.equal(f.screen.listenerCount('display-added'),1);
});
test('retry cleanup reentrant dispose cannot resurrect a closed adapter',()=>{
 const f=fixture(),on=f.powerMonitor.on,remove=f.screen.removeListener;
 f.powerMonitor.on=()=>{throw Error('subscribe');};f.screen.removeListener=()=>{throw Error('cleanup');};f.app.emit('ready');
 f.powerMonitor.on=on;let once=false;
 f.screen.removeListener=function(e,h){if(!once){once=true;f.adapter.dispose();}return remove.call(this,e,h);};
 f.adapter.retryStart();assert.equal(f.adapter.snapshot().reason,'adapter-disposed');assert.equal(f.reads(),0);
 assert.equal(f.adapter.commitSegment({x:1,y:1},{x:2,y:2},1,1).accepted,false);
 assert.equal(f.screen.listenerCount('display-added'),0);assert.equal(f.powerMonitor.listenerCount('suspend'),0);
 f.adapter.retryStart();assert.equal(f.reads(),0);
});
test('cleanup reentrant retry cannot duplicate initialization or lose failed listener entries',()=>{
 const f=fixture(),on=f.powerMonitor.on,remove=f.screen.removeListener;
 f.powerMonitor.on=()=>{throw Error('subscribe');};f.screen.removeListener=()=>{throw Error('cleanup');};f.app.emit('ready');f.powerMonitor.on=on;
 let once=false;f.screen.removeListener=function(e,h){if(!once){once=true;f.adapter.retryStart();throw Error('still fails');}return remove.call(this,e,h);};
 f.adapter.retryStart();assert.equal(f.reads(),0);assert.equal(f.adapter.snapshot().reason,'subscription-cleanup-unverified');
 f.screen.removeListener=remove;f.adapter.retryStart();assert.equal(f.reads(),1);assert.equal(f.screen.listenerCount('display-added'),1);
});
test('catch rollback cannot activate through reentrant retry or duplicate listeners',()=>{
 const f=fixture(),on=f.powerMonitor.on,remove=f.screen.removeListener;let once=false;
 f.powerMonitor.on=()=>{throw Error('subscription failure');};
 f.screen.removeListener=function(e,h){if(!once){once=true;f.powerMonitor.on=on;f.adapter.retryStart();throw Error('old removal failed');}return remove.call(this,e,h);};
 f.app.emit('ready');assert.equal(f.reads(),0);assert.equal(f.adapter.snapshot().reason,'subscription-cleanup-unverified');
 assert.equal(f.screen.listenerCount('display-added'),1);assert.equal(f.powerMonitor.listenerCount('suspend'),0);
 assert.equal(f.adapter.commitSegment({x:1,y:1},{x:2,y:2},1,1).accepted,false);
 f.screen.removeListener=remove;f.adapter.retryStart();assert.equal(f.reads(),1);assert.equal(f.screen.listenerCount('display-added'),1);
});
test('catch rollback reentrant disposal stays terminal, never overwritten by failed state',()=>{
 const f=fixture(),remove=f.screen.removeListener;let once=false;f.powerMonitor.on=()=>{throw Error('subscription failure');};
 f.screen.removeListener=function(e,h){if(!once){once=true;f.adapter.dispose();}return remove.call(this,e,h);};
 f.app.emit('ready');assert.equal(f.adapter.snapshot().reason,'adapter-disposed');f.adapter.retryStart();assert.equal(f.reads(),0);
});
test('point getter disposing adapter cannot return accepted after terminal transition',()=>{
 const f=fixture(true),s=f.adapter.snapshot(),point={get x(){f.adapter.dispose();return 1;},y:1};
 assert.equal(f.adapter.commitSegment(point,{x:2,y:2},s.revision,s.epoch).accepted,false);
 assert.equal(f.adapter.snapshot().reason,'adapter-disposed');
});
test('point getter display event and fresh enumeration invalidates in-flight commit',()=>{
 const f=fixture(true),s=f.adapter.snapshot();let once=false;
 const point={get x(){if(!once){once=true;f.screen.emit('display-metrics-changed');}return 1;},y:1};
 const result=f.adapter.commitSegment(point,{x:2,y:2},s.revision,s.epoch);
 assert.equal(result.accepted,false);assert.equal(result.reason,'adapter-context-changed');assert.ok(f.adapter.snapshot().epoch>s.epoch);
});
test('point getter power revocation blocks in-flight commit',()=>{
 const f=fixture(true),s=f.adapter.snapshot(),point={get x(){f.powerMonitor.emit('lock-screen');return 1;},y:1};
 assert.equal(f.adapter.commitSegment(point,{x:2,y:2},s.revision,s.epoch).accepted,false);
});
test('point getter exception returns closed result and point fields are read once',()=>{
 const f=fixture(true),s=f.adapter.snapshot();
 assert.equal(f.adapter.commitSegment({get x(){throw Error('private error')},y:1},{x:2,y:2},s.revision,s.epoch).reason,'invalid-point-read');
 let reads=0;assert.equal(f.adapter.commitSegment({get x(){reads++;return 1},y:1},{x:2,y:2},s.revision,s.epoch).accepted,true);assert.equal(reads,1);
});
function barrierFixture(readBarrierState){const app=new EventEmitter(),screen=new EventEmitter(),powerMonitor=new EventEmitter();let reads=0;
 app.isReady=()=>false;screen.getAllDisplays=()=>{reads++;return displays();};
 const adapter=createFixtureTopologyAdapter({app,screen,powerMonitor,readBarrierState});return{app,screen,powerMonitor,adapter,reads:()=>reads};}
for(const state of [null,{locked:true,suspended:false},{locked:false,suspended:true},{locked:'unknown',suspended:false},{locked:false},{locked:false,suspended:'unknown'}])test(`initial barrier is closed for ${JSON.stringify(state)}`,()=>{
 const f=barrierFixture(()=>state);f.app.emit('ready');assert.equal(f.reads(),0);assert.equal(f.adapter.snapshot().reason,'barrier-state-unverified');assert.equal(f.adapter.commitSegment({x:1,y:1},{x:2,y:2},1,1).accepted,false);
});
test('missing sampler does not interpret idle API active as unlock proof',()=>{const f=barrierFixture(undefined);f.powerMonitor.getSystemIdleState=()=> 'active';f.app.emit('ready');assert.equal(f.reads(),0);});
test('failed subscription then missed lock is recovered by retry sampling',()=>{let locked=false;const f=barrierFixture(()=>({locked,suspended:false})),on=f.powerMonitor.on;
 f.powerMonitor.on=()=>{throw Error('subscribe')};f.app.emit('ready');locked=true;f.powerMonitor.emit('lock-screen');f.powerMonitor.on=on;f.adapter.retryStart();assert.equal(f.reads(),0);
 locked=false;f.powerMonitor.emit('unlock-screen');assert.equal(f.reads(),1);
});
test('unknown or throwing sampler remains closed after unlock until positive fresh sample',()=>{let mode=0;const f=barrierFixture(()=>{if(mode===0)throw Error('private');return mode===1?null:{locked:false,suspended:false}});
 f.app.emit('ready');mode=1;f.powerMonitor.emit('unlock-screen');assert.equal(f.reads(),0);mode=2;f.adapter.refresh();assert.equal(f.reads(),1);
});
test('sampler reentry disposal cannot publish a clear result',()=>{let f;f=barrierFixture(()=>{f.adapter.dispose();return{locked:false,suspended:false}});f.app.emit('ready');assert.equal(f.reads(),0);assert.equal(f.adapter.snapshot().reason,'adapter-disposed');});
test('sampler event ABA discards old result and uses new sample',()=>{let f,n=0;f=barrierFixture(()=>{if(++n===1){f.powerMonitor.emit('lock-screen');f.powerMonitor.emit('unlock-screen');return{locked:false,suspended:false}}return null});f.app.emit('ready');assert.equal(n,2);assert.equal(f.reads(),0);assert.equal(f.adapter.snapshot().reason,'barrier-state-unverified');});
test('newListener dispose before registration leaves no ghost listener',()=>{const f=fixture();f.screen.on('newListener',e=>{if(e==='display-removed')f.adapter.dispose()});f.app.emit('ready');assert.equal(f.screen.listenerCount('display-removed'),0);assert.equal(f.adapter.snapshot().reason,'adapter-disposed');});
test('newListener dispose with failed late cleanup reports unverified then retries',()=>{const f=fixture(),remove=f.screen.removeListener;f.screen.on('newListener',e=>{if(e==='display-removed'){f.adapter.dispose();f.screen.removeListener=()=>{throw Error('remove')}}});f.app.emit('ready');assert.equal(f.screen.listenerCount('display-removed'),1);assert.equal(f.adapter.snapshot().reason,'adapter-disposed-cleanup-unverified');f.screen.removeListener=remove;f.adapter.dispose();assert.equal(f.screen.listenerCount('display-removed'),0);});
test('isReady exception returns terminal adapter and removes ready callback',()=>{const app=new EventEmitter(),screen=new EventEmitter(),powerMonitor=new EventEmitter();let reads=0;app.isReady=()=>{throw Error('private')};screen.getAllDisplays=()=>{reads++;return displays()};const a=createFixtureTopologyAdapter({app,screen,powerMonitor});assert.equal(a.snapshot().reason,'app-readiness-unverified');assert.equal(app.listenerCount('ready'),0);app.emit('ready');a.retryStart();assert.equal(reads,0);assert.equal(powerMonitor.listenerCount('suspend'),0);});
test('isReady exception plus failed ready removal still cannot activate',()=>{const app=new EventEmitter(),screen=new EventEmitter(),powerMonitor=new EventEmitter();let reads=0;app.isReady=()=>{throw Error('private')};const remove=app.removeListener;app.removeListener=()=>{throw Error('remove')};screen.getAllDisplays=()=>{reads++;return displays()};const a=createFixtureTopologyAdapter({app,screen,powerMonitor});app.removeListener=remove;app.emit('ready');assert.equal(reads,0);a.dispose();});
