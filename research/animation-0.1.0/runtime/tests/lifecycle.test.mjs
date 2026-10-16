import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ResourceCache
}
from '../src/resource-cache.mjs';
import {
  DemandLoop
}
from '../src/demand-loop.mjs';
import {
  pack
}
from './helpers.mjs';
import {
  createSuite
}
from '../src/suite.mjs';
test('pending load dedup, cancel one waiter, late final release exactly once', async()=> {
  const cache=new ResourceCache(), a=new AbortController();
  let resolve, loads=0, disposed=0;
  const load=()=> {
    loads++;
    return new Promise(r=>resolve=r);
  };
  const x=cache.acquire('x', load, {
    signal:a.signal
  }), y=cache.acquire('x', load);
  await Promise.resolve();
  a.abort();
  await assert.rejects(x);
  resolve({
    dispose() {
      disposed++;
    }
  });
  const l=await y;
  assert.equal(loads, 1);
  assert.equal(disposed, 0);
  l.release();
  l.release();
  assert.equal(disposed, 1);
  assert.equal(cache.retainedReferences, 0);
});
test('all waiters cancelled before late completion dispose once', async()=> {
  const c=new ResourceCache(), a=new AbortController();
  let resolve, disposed=0;
  const p=c.acquire('x', ()=>new Promise(r=>resolve=r), {
    signal:a.signal
  });
  await Promise.resolve();
  a.abort();
  await assert.rejects(p);
  resolve({
    dispose() {
      disposed++;
    }
  });
  await new Promise(r=>setImmediate(r));
  assert.equal(disposed, 1);
  assert.equal(c.stats.live, 0);
});
test('failed load evicts and can retry without leaked ownership', async()=> {
  const c=new ResourceCache();
  await assert.rejects(c.acquire('x', async()=> {
    throw Error('load failed');
  }));
  const l=await c.acquire('x', async()=>({
    dispose() {
    }
  }));
  l.release();
  assert.equal(c.stats.loads, 2);
  assert.equal(c.retainedReferences, 0);
});
test('two actors share assets but not skeleton/morph state', async()=> {
  const p=await pack(), c=new ResourceCache(), a=await createSuite(p, c), b=await createSuite(p, c);
  assert.equal(c.stats.loads, 2);
  assert.notEqual(a.model.getObjectByName('FixtureSkin').skeleton, b.model.getObjectByName('FixtureSkin').skeleton);
  a.enqueue({
    time:0, type:'play', segment:'raise'
  });
  a.advance(.2);
  assert.equal(b.face.value, 0);
  a.dispose();
  assert.equal(c.stats.live, 2);
  b.dispose();
  assert.equal(c.stats.live, 0);
});
test('demand loop sleeps with zero RAF and wakes for canonical future event', async()=> {
  const s=await createSuite(await pack(), new ResourceCache());
  let time=0, id=0, draws=0;
  const frames=new Map(), timers=new Map();
  const loop=new DemandLoop({
    runtime:s, draw:()=>draws++, now:()=>time, requestFrame:fn=> {
      frames.set(++id, fn);
      return id;
    }, cancelFrame:n=>frames.delete(n), setTimer:(fn, ms)=> {
      timers.set(++id, {
        fn, at:time+ms/1000
      });
      return id;
    }, clearTimer:n=>timers.delete(n)
  });
  const frame=()=> {
    const jobs=[...frames.values()];
    frames.clear();
    jobs.forEach(fn=>fn());
  };
  loop.invalidate();
  frame();
  assert.equal(draws, 1);
  assert.equal(frames.size, 0);
  assert.equal(timers.size, 0);
  s.enqueue({
    time:1, type:'play', segment:'raise'
  });
  loop.invalidate();
  frame();
  assert.equal(frames.size, 0);
  assert.equal(timers.size, 1);
  time=1;
  const timer=[...timers.values()][0];
  timers.clear();
  timer.fn();
  frame();
  assert.equal(frames.size, 1);
  for(time=1.1;
  time<1.6;
  time+=.1)frame();
  assert.equal(frames.size, 0);
  loop.dispose();
  s.dispose();
});
test('draw callback disposal schedules no trailing RAF or timer', ()=> {
  let frames=0, fn, loop;
  const runtime= {
    advance:()=>true, isAnimating:()=>true, nextDeadline:()=>Infinity
  };
  loop=new DemandLoop({
    runtime, draw:()=>loop.dispose(), now:()=>0, requestFrame:f=> {
      frames++;
      fn=f;
      return frames;
    }, cancelFrame() {
    }, setTimer() {
      throw Error('unexpected timer');
    }, clearTimer() {
    }
  });
  loop.invalidate();
  fn();
  assert.equal(frames, 1);
  assert.equal(loop.frame, null);
});
test('paused scheduler preserves queued events and resumes at current canonical time', async()=> {
  const s=await createSuite(await pack(), new ResourceCache());
  let time=0, id=0, draws=0;
  const frames=new Map(), timers=new Map();
  const loop=new DemandLoop({
    runtime:s, draw:()=>draws++, now:()=>time, requestFrame:fn=> {
      frames.set(++id, fn);
      return id;
    }, cancelFrame:id=>frames.delete(id), setTimer:(fn, ms)=> {
      timers.set(++id, fn);
      return id;
    }, clearTimer:id=>timers.delete(id)
  });
  s.enqueue({
    time:.3, type:'play', segment:'raise'
  });
  loop.invalidate();
  loop.pause();
  assert.equal(frames.size, 0);
  time=1;
  loop.resume();
  const f=[...frames.values()][0];
  frames.clear();
  f();
  assert.equal(s.face.value, 1);
  assert.equal(s.timeline.time, 1);
  assert.equal(frames.size, 0);
  assert.equal(draws, 1);
  loop.dispose();
  s.dispose();
});
test('invalid resource result rejects and evicts its cache entry', async()=> {
  const c=new ResourceCache();
  await assert.rejects(c.acquire('bad', async()=>undefined));
  assert.equal(c.entries.size, 0);
  assert.equal(c.retainedReferences, 0);
});
