const test = require('node:test');
const assert = require('node:assert/strict');
const { createSurfaceMotion } = require('../src/surfaces/shared/motion.mjs');

function harness(loadOverride) {
  const events = new Map(), calls = [], contexts = [];
  const query = { matches: false, addEventListener: (key, fn) => events.set(key, fn), removeEventListener: key => events.delete(key) };
  const doc = { hidden: false, body: { dataset: { motion: 'full', stimulation: 'balanced' } },
    defaultView: { matchMedia: () => query },
    addEventListener: (key, fn) => events.set(key, fn), removeEventListener: key => events.delete(key) };
  const tweens = [];
  const runtime = { gsap: { context(fn) { fn(); const ctx = { reverted: false, revert() { this.reverted = true; } }; contexts.push(ctx); return ctx; }, fromTo: (...args) => {
    calls.push(args); const tween = { speed: 1, timeScale(value) { this.speed = value; } }; tweens.push(tween); return tween;
  } } };
  const motion = createSurfaceMotion(doc, { load: loadOverride || (() => Promise.resolve(runtime)) });
  return { doc, query, motion, calls, contexts, events, runtime, tweens };
}

test('hover, focus and click share the live tween without resetting; a completed gesture can replay', async () => {
  const h=harness(), a={isConnected:true}, b={isConnected:true};
  await h.motion.feedback(a,'bell'); await h.motion.enter(b);
  await h.motion.feedback(a,'bell',true);
  await h.motion.feedback(a,'bell');
  assert.equal(h.contexts[0].reverted,false);
  assert.equal(h.contexts[1].reverted,false);
  assert.equal(h.calls.length,2);
  assert.equal(h.tweens[0].speed,1.3);
  h.calls[0][2].onComplete();
  await h.motion.feedback(a,'bell');
  assert.equal(h.contexts[0].reverted,true);
  h.query.matches=true; h.events.get('change')();
  assert.ok(h.contexts.every(context=>context.reverted));
  await h.motion.feedback(b);
  assert.equal(h.calls.length,3);
  h.motion.dispose(); assert.equal(h.events.size,0);
});

test('click during lazy loading is coalesced, and load failure can be retried', async () => {
  let resolve;
  const ready=new Promise(r=>{resolve=r;});
  const h=harness(()=>ready), target={isConnected:true};
  const hover=h.motion.feedback(target,'review');
  await h.motion.feedback(target,'review'); await h.motion.feedback(target,'review',true);
  resolve(h.runtime); await hover;
  assert.equal(h.calls.length,1); assert.equal(h.tweens[0].speed,1.3);
  h.motion.dispose();
  let attempts=0;
  const retry=harness(()=> ++attempts === 1 ? Promise.reject(new Error('offline')) : Promise.resolve(h.runtime));
  await retry.motion.feedback(target); await retry.motion.feedback(target);
  assert.equal(attempts,2); retry.motion.dispose();
});

test('late GSAP load cannot replay a superseded or disposed interaction', async () => {
  let resolve;
  const ready=new Promise(r=>{resolve=r;});
  const h=harness(()=>ready), target={isConnected:true};
  const first=h.motion.enter(target), second=h.motion.feedback(target);
  resolve(h.runtime); await Promise.all([first,second]);
  assert.equal(h.calls.length,1);
  h.motion.dispose(); await h.motion.enter(target);
  assert.equal(h.calls.length,1);
});

test('hidden or low-stimulation surfaces stay static and a load failure never hides content', async () => {
  const h=harness(), node={isConnected:true};
  await h.motion.enter(node);
  h.doc.hidden=true; h.events.get('visibilitychange')();
  assert.equal(h.contexts[0].reverted,true);
  h.doc.hidden=false;h.doc.body.dataset.stimulation='low';
  await h.motion.enter(node);assert.equal(h.calls.length,1);
  const failed=harness(()=>Promise.reject(new Error('unavailable')));
  await failed.motion.enter(node); assert.equal(failed.calls.length,0);
  h.motion.dispose();failed.motion.dispose();
});
