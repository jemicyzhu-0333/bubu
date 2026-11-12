import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DragController } from '../src/drag-controller.mjs';
const profile=JSON.parse(fs.readFileSync(new URL('../../drag-body-prototype-v1/replay/body-poses.json',import.meta.url)));
function gesture(){
 const controller=new DragController(profile);controller.begin(0,{x:0,y:0});
 let time=.02,x=10;controller.move(time,{x,y:0});
 return {controller,step(speed){time+=.1;x+=speed*.1;return controller.move(time,{x,y:0});}};
}
test('face intent preserves immediate first fast takeover and protected slow pickup',()=>{
 const f=gesture();assert.equal(f.controller.snapshot().faceIntent,'T05');
 const c=new DragController(profile);c.begin(0,{x:0,y:0});c.move(.1,{x:1,y:0});assert.equal(c.snapshot().faceIntent,'N3');
});
test('69/71 DIP jitter does not restart either established airborne face',()=>{
 for(const initial of [50,100]){const f=gesture();const expected=f.step(initial).faceIntent;
 for(let i=0;i<160;i++)assert.equal(f.step(i%2?71:69).faceIntent,expected);}
});
test('clear acceleration/deceleration switches immediately outside hysteresis band',()=>{
 const f=gesture();assert.equal(f.step(50).faceIntent,'01');assert.equal(f.step(75.9).faceIntent,'01');
 assert.equal(f.step(76.1).faceIntent,'T05');assert.equal(f.step(64.1).faceIntent,'T05');assert.equal(f.step(63.9).faceIntent,'01');
});
test('stationary timeout clears active expression without a new move',()=>{
 const f=gesture();f.step(100);assert.equal(f.controller.advance(f.controller.time+.121).faceIntent,'01');
});
test('release and cancellation take priority over airborne expression',()=>{
 for(const cancel of [false,true]){const f=gesture(),c=f.controller;c.release(c.time+.01,{duration:.6,cancel});
 assert.equal(c.snapshot().faceIntent,null);assert.equal(c.advance(c.time+.61).faceIntent,cancel?null:'landingP2');}
});
test('interrupt, suspend and new begin cannot inherit an old fast face',()=>{
 for(const action of ['interrupt','suspend']){const f=gesture(),c=f.controller;c[action](.03);if(action==='suspend')c.resume(.04);
 assert.equal(c.snapshot().faceIntent,null);c.begin(.05,{x:0,y:0});assert.equal(c.snapshot().faceIntent,null);
 c.move(.15,{x:1,y:0});assert.equal(c.snapshot().faceIntent,'N3');}
});
test('snapshot reads are pure and repeated frames preserve face intent',()=>{
 const f=gesture();f.step(100);const c=f.controller,one=c.snapshot();assert.deepEqual(c.snapshot(),one);
 for(let i=0;i<10;i++)assert.deepEqual(c.advance(c.time),one);
});
test('frame schedules do not introduce near-threshold face restarts',()=>{
 for(const fps of [30,60,120]){const f=gesture();f.step(100);const c=f.controller;
 let x=c.intent.points.at(-1).x,t=c.time;
 for(let i=0;i<60;i++){const end=t+.1;for(let frame=1;t+frame/fps<end-1e-9;frame++)assert.equal(c.advance(t+frame/fps).faceIntent,'T05');
 x+=(i%2?71:69)*.1;assert.equal(c.move(end,{x,y:0}).faceIntent,'T05');t=end;}}
});
test('after stationary timeout, resumed steady 72 DIP/s reaches fast face',()=>{
 const f=gesture(),c=f.controller;f.step(100);let t=c.time+.3,x=c.intent.points.at(-1).x;c.advance(t);
 const faces=[];for(let i=0;i<40;i++){t+=1/60;x+=72/60;faces.push(c.move(t,{x,y:0}).faceIntent);if(Math.hypot(c.velocity.x,c.velocity.y)>70)assert.equal(faces.at(-1),'T05');}
 assert.ok(faces.indexOf('T05')>=0&&faces.indexOf('T05')<12,'entry must not wait for a 76 DIP/s crossing');
 assert.equal(faces.at(-1),'T05');
});
test('after stationary timeout, 69/71 jitter settles without repeated switches',()=>{
 const f=gesture(),c=f.controller;f.step(100);let t=c.time+.3,x=c.intent.points.at(-1).x;c.advance(t);
 const faces=[];for(let i=0;i<160;i++){t+=1/60;x+=(i%2?71:69)/60;faces.push(c.move(t,{x,y:0}).faceIntent);}
 assert(faces.slice(12).every(face=>face===faces[12]));
});
