import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pack
}
from './helpers.mjs';
import {
  ResourceCache
}
from '../src/resource-cache.mjs';
import {
  createSuite
}
from '../src/suite.mjs';
const snapshot=s=>[...Array.from(s.lanes.values()).flatMap(x=>Array.from(x.value)), s.face.path, s.face.value];
test('30/60/120 Hz produce equal event-time state and exact canonical neutral bridges', async()=> {
  const p=await pack(), results=[];
  for(const hz of [30, 60, 120]) {
    const c=new ResourceCache(), s=await createSuite(p, c);
    for(const e of [{
      time:0, type:'play', segment:'raise'
    }, {
      time:.233, type:'play', segment:'turn'
    }, {
      time:.271, type:'play', segment:'raise'
    }, {
      time:.71, type:'cancel'
    }])s.enqueue(e);
    const samples=[];
    let t=0;
    for(const goal of [.1, .233, .271, .313, .5, .71, .9]) {
      for(;
      t+1/hz<goal-1e-10;
      t+=1/hz)s.advance(t+1/hz);
      s.advance(goal);
      t=goal;
      samples.push(snapshot(s));
    }
    results.push(samples);
    s.dispose();
  }
  assert.deepEqual(results[0], results[1]);
  assert.deepEqual(results[1], results[2]);
});
test('interrupt starts at actual current quaternion, facial state and full world matrix', async()=> {
  const s=await createSuite(await pack(), new ResourceCache());
  s.enqueue({
    time:0, type:'play', segment:'raise'
  });
  s.advance(.083);
  s.root.updateMatrixWorld(true);
  const before=snapshot(s), world=[];
  s.root.traverse(n=>world.push(...n.matrixWorld.elements));
  s.enqueue({
    time:.083, type:'play', segment:'turn'
  });
  s.advance(.083);
  s.root.updateMatrixWorld(true);
  const after=[];
  s.root.traverse(n=>after.push(...n.matrixWorld.elements));
  assert.deepEqual(snapshot(s), before);
  assert.deepEqual(after, world);
  s.dispose();
});
test('many face interrupts never overlap semantic paths or exceed morph simplex', async()=> {
  const s=await createSuite(await pack(), new ResourceCache());
  for(let i=0;
  i<100;
  i++)s.enqueue({
    time:i*.017, type:'play', segment:i%2?'turn':'raise'
  });
  const mesh=s.model.getObjectByName('FacePanel');
  for(let i=0;
  i<240;
  i++) {
    s.advance(i/120);
    const w=mesh.morphTargetInfluences;
    assert(w.every(x=>x>=-1e-12&&x<=1+1e-12));
    assert(w.reduce((a, b)=>a+b, 0)<=1+1e-12);
    assert(!((w[0]+w[1]>1e-12)&&(w[2]+w[3]>1e-12)));
  }
  s.dispose();
});
test('cancel wins same timestamp and invalidates previously queued future plays', async()=> {
  const s=await createSuite(await pack(), new ResourceCache());
  s.enqueue({
    time:0, type:'play', segment:'raise'
  });
  s.enqueue({
    time:.2, type:'play', segment:'turn'
  });
  s.enqueue({
    time:.2, type:'cancel'
  });
  s.enqueue({
    time:.3, type:'play', segment:'raise'
  });
  s.advance(1);
  assert.equal(s.face.value, 0);
  for(const q of s.lanes.values())assert.deepEqual(Array.from(q.value), [0, 0, 0, 1]);
  assert.equal(s.nextDeadline(), Infinity);
  assert.throws(()=>s.enqueue({
    time:.9, type:'play', segment:'raise'
  }));
  s.dispose();
});
test('rigid accessory inherits slot world transform once, with independent local rotation', async()=> {
  const s=await createSuite(await pack(), new ResourceCache());
  const socket=s.model.getObjectByName('AccessorySocket'), fit=socket.getObjectByName('Fit_testCap');
  s.enqueue({
    time:0, type:'play', segment:'raise'
  });
  s.advance(.2);
  assert.equal(fit.parent, socket);
  assert(fit.children[0].quaternion.z>0);
  assert.equal(fit.position.length(), 0);
  s.dispose();
});
