import * as T from 'three';
import {
  preparePack, browserPackReader
}
from './pack-loader.mjs';
import {
  createSuite
}
from './suite.mjs';
import {
  ResourceCache
}
from './resource-cache.mjs';
import {
  DemandLoop
}
from './demand-loop.mjs';
const viewport=document.querySelector('#viewport'), status=document.querySelector('#status'), cache=new ResourceCache(), scene=new T.Scene();
let renderer, suite, loop, pack, start, loading=false, closed=false, generation=0, loadAbort=null;
try {
  renderer=new T.WebGLRenderer({
    antialias:true, alpha:true
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0xffffff, 0);
  viewport.append(renderer.domElement);
}
catch(error) {
  status.textContent='WebGL initialization failed: '+error.message;
  throw error;
}
const camera=new T.OrthographicCamera(-1.4, 1.4, 1.4, -1.4, .01, 20);
camera.position.set(2, 1.3, 4);
camera.lookAt(0, .6, 0);
scene.add(new T.HemisphereLight(0xffffff, 0x647283, 2));
const key=new T.DirectionalLight(0xffffff, 2);
key.position.set(2, 4, 3);
scene.add(key);
const now=()=>Math.max(0, (performance.now()-start)/1000);
function draw() {
  renderer.render(scene, camera);
  status.textContent=suite?JSON.stringify({
    fixtureOnly:true, time:Number(suite.timeline.time.toFixed(3)), face: {
      path:suite.face.path, amount:Number(suite.face.value.toFixed(3))
    }, cpuBudget:suite.budget, cache:cache.stats, scheduler:loop?.stats, webglDrawCalls:renderer.info.render.calls
  }, null, 2):'Actor disposed. Shared resource leases released.';
}
function resize() {
  const w=viewport.clientWidth, h=viewport.clientHeight;
  renderer.setSize(w, h, false);
  camera.left=-1.4*w/h;
  camera.right=1.4*w/h;
  camera.updateProjectionMatrix();
  if(loop)loop.invalidate();
  else draw();
}
const observer=new ResizeObserver(resize);
observer.observe(viewport);
function stopCurrent() {
  generation++;
  loadAbort?.abort();
  loadAbort=null;
  loading=false;
  loop?.dispose();
  loop=null;
  suite?.dispose();
  suite=null;
}
async function create() {
  if(loading||closed)return;
  const mine=++generation, abort=new AbortController();
  loadAbort=abort;
  loading=true;
  loop?.dispose();
  loop=null;
  suite?.dispose();
  suite=null;
  try {
    const prepared=pack??await preparePack(browserPackReader(new URL('../fixtures/', import.meta.url)), {
      signal:abort.signal
    });
    if(closed||generation!==mine||abort.signal.aborted)return;
    pack=prepared;
    const candidate=await createSuite(pack, cache, {
      signal:abort.signal
    });
    if(closed||generation!==mine||abort.signal.aborted) {
      candidate.dispose();
      return;
    }
    suite=candidate;
    scene.add(suite.root);
    start=performance.now();
    loop=new DemandLoop({
      runtime:suite, draw, now, requestFrame:requestAnimationFrame, cancelFrame:cancelAnimationFrame, setTimer:setTimeout, clearTimer:clearTimeout
    });
    resize();
    if(document.hidden)loop.pause();
  }
  catch(error) {
    if(generation===mine&&!closed) {
      loop?.dispose();
      loop=null;
      suite?.dispose();
      suite=null;
      status.textContent=abort.signal.aborted?'Loading cancelled.':(error.code??'ERROR')+': '+error.message;
    }
  }
  finally {
    if(generation===mine) {
      loading=false;
      loadAbort=null;
    }
  }
}
function play(segment) {
  if(!suite||suite.disposed)return;
  suite.enqueue({
    time:now(), type:'play', segment
  });
  loop.invalidate();
}
document.querySelector('#raise').onclick=()=>play('raise');
document.querySelector('#turn').onclick=()=>play('turn');
document.querySelector('#cancel').onclick=()=> {
  if(suite&&!suite.disposed) {
    suite.enqueue({
      time:now(), type:'cancel'
    });
    loop.invalidate();
  }
};
document.querySelector('#front').onclick=()=> {
  camera.position.set(0, .6, 4);
  camera.lookAt(0, .6, 0);
  loop?.invalidate();
};
document.querySelector('#quarter').onclick=()=> {
  camera.position.set(2, 1.3, 4);
  camera.lookAt(0, .6, 0);
  loop?.invalidate();
};
document.querySelector('#dispose').onclick=()=> {
  stopCurrent();
  draw();
};
document.querySelector('#recreate').onclick=create;
function visibility() {
  if(document.hidden)loop?.pause();
  else loop?.resume();
}
document.addEventListener('visibilitychange', visibility);
window.addEventListener('pagehide', ()=> {
  closed=true;
  stopCurrent();
  observer.disconnect();
  document.removeEventListener('visibilitychange', visibility);
  renderer.dispose();
}, {
  once:true
});
create();
