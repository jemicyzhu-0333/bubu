import test from 'node:test';
import assert from 'node:assert/strict';
import {ContextLifecycle} from '../src/context-lifecycle.mjs';
import {DemandLoop} from '../src/demand-loop.mjs';
import {ActorPool} from '../src/actor-pool.mjs';
import {pack} from './helpers.mjs';

function harness(runtime){
  const canvas=new EventTarget(), document=new EventTarget();document.hidden=false;
  const gate=new ContextLifecycle({canvas,visibilityTarget:document});
  let time=0,id=0,draws=0;const frames=new Map(),timers=new Map();
  const loop=new DemandLoop({runtime,draw:()=>draws++,now:()=>time,requestFrame:fn=>{frames.set(++id,fn);return id;},cancelFrame:n=>frames.delete(n),setTimer:fn=>{timers.set(++id,fn);return id;},clearTimer:n=>timers.delete(n)});
  const frame=()=>{const f=[...frames.values()];frames.clear();f.forEach(fn=>fn());};
  const loss=()=>{const event=new Event('webglcontextlost',{cancelable:true});canvas.dispatchEvent(event);return event;};
  return {canvas,document,gate,loop,frames,timers,frame,loss,time:t=>time=t,draws:()=>draws,restore:()=>canvas.dispatchEvent(new Event('webglcontextrestored')),hidden:v=>{document.hidden=v;document.dispatchEvent(new Event('visibilitychange'));}};
}
const idle={advance:()=>false,isAnimating:()=>false,nextDeadline:()=>Infinity};
test('simulated idle context restoration explicitly redraws once without restarting clock',()=>{
  const h=harness(idle);h.gate.bind(h.loop);h.frame();assert.equal(h.frames.size,0);
  assert(h.loss().defaultPrevented);assert(h.loop.paused);
  h.time(2);h.restore();assert.equal(h.frames.size,1);h.frame();
  assert.equal(h.draws(),2);assert.equal(h.frames.size,0);
  h.restore();assert.equal(h.frames.size,0);h.gate.dispose();
});
test('hidden and lost states compose; restoration while hidden does not resume',()=>{
  const h=harness(idle);h.gate.bind(h.loop);h.frame();h.hidden(true);h.loss();h.restore();
  assert(h.loop.paused);assert.equal(h.frames.size,0);
  h.hidden(false);assert.equal(h.frames.size,1);h.frame();
  h.loss();h.hidden(true);h.hidden(false);assert.equal(h.frames.size,0);
  h.restore();assert.equal(h.frames.size,1);h.gate.dispose();assert.equal(h.frames.size,0);
});
test('loss before actor load binds paused; disposed lifecycle ignores late restore',()=>{
  const h=harness(idle);h.loss();h.gate.bind(h.loop);assert(h.loop.paused);assert.equal(h.frames.size,0);
  h.gate.dispose();h.restore();h.hidden(false);assert.equal(h.frames.size,0);assert(h.loop.stopped);
  assert.throws(()=>h.gate.bind(h.loop));
});
test('simulated restoration samples canonical events at current time rather than replaying animation start',async()=>{
  const pool=new ActorPool(), suite=await pool.create(await pack()), h=harness(suite);
  suite.enqueue({time:.2,type:'play',segment:'raise'});
  h.gate.bind(h.loop);h.frame();h.loss();assert.equal(h.timers.size,0);
  h.time(2);h.restore();h.frame();
  assert.equal(suite.timeline.time,2);assert.equal(suite.face.value,1);assert.equal(h.frames.size,0);
  h.gate.dispose();pool.dispose();
});
test('loss during draw does not schedule a trailing animation RAF',()=>{
  const h=harness({advance:()=>true,isAnimating:()=>true,nextDeadline:()=>Infinity});
  h.loop.draw=()=>h.loss();h.gate.bind(h.loop);h.frame();
  assert(h.loop.paused);assert.equal(h.frames.size,0);assert.equal(h.timers.size,0);h.gate.dispose();
});
