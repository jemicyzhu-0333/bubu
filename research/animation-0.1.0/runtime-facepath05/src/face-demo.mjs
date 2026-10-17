import * as T from 'three';
import {prepareFacePack,browserPackReader} from './pack-loader.mjs';
import {ActorPool} from './actor-pool.mjs';
import {DemandLoop} from './demand-loop.mjs';
import {ContextLifecycle} from './context-lifecycle.mjs';
const viewport=document.querySelector('#viewport'),status=document.querySelector('#status'),selection=document.querySelector('#face');
const scene=new T.Scene(),pool=new ActorPool(),camera=new T.OrthographicCamera(-1.8,1.8,1.2,-1.2,.01,30);
let renderer;
try {renderer=new T.WebGLRenderer({alpha:true,antialias:true});} catch(error){status.textContent='WebGL unavailable: '+error.message;throw error;}
renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor(0xffffff,0);viewport.append(renderer.domElement);
scene.add(new T.HemisphereLight(0xffffff,0x7c8296,2));const key=new T.DirectionalLight(0xffffff,2);key.position.set(3,5,4);scene.add(key);
camera.position.set(0,1,5);camera.lookAt(0,.9,0);
const lifecycle=new ContextLifecycle({canvas:renderer.domElement,visibilityTarget:document});
let actor=null,loop=null,generation=0,pending=null,closed=false;
function draw(){if(closed||lifecycle.hidden||lifecycle.lost)return;renderer.render(scene,camera);status.textContent=actor?JSON.stringify({purpose:'single-semantic-face-path',state:actor.state,verification:actor.verification,reservation:pool.stats,drawCalls:renderer.info.render.calls},null,2):'Disposed; no actor is active.';}
function stop(){generation++;pending?.abort();pending=null;lifecycle.bind(null);loop?.dispose();loop=null;actor?.dispose();actor=null;}
function resize(){const w=viewport.clientWidth,h=viewport.clientHeight;renderer.setSize(w,h,false);camera.left=-1.2*w/h;camera.right=1.2*w/h;camera.updateProjectionMatrix();if(loop)loop.invalidate();else draw();}
async function create(){if(closed)return;stop();const mine=generation,abort=new AbortController();pending=abort;status.textContent='Checking fixed seven-slot source and all eight face layers…';
  try {const pack=await prepareFacePack(browserPackReader(new URL('../fixtures/face-slice7/',import.meta.url)),{signal:abort.signal});
    if(closed||mine!==generation||abort.signal.aborted)return;
    const candidate=await pool.create(pack,{signal:abort.signal});
    if(closed||mine!==generation||abort.signal.aborted){candidate.dispose();return;}
    actor=candidate;scene.add(actor.root);loop=new DemandLoop({runtime:actor,draw,now:()=>performance.now()/1000,requestFrame:requestAnimationFrame,cancelFrame:cancelAnimationFrame,setTimer:setTimeout,clearTimer:clearTimeout});lifecycle.bind(loop);resize();
  }catch(error){if(!closed&&mine===generation){actor?.dispose();actor=null;loop?.dispose();loop=null;status.textContent=abort.signal.aborted?'Cancelled.':(error.code??'ERROR')+': '+error.message;}}
  finally{if(mine===generation)pending=null;}
}
const observer=new ResizeObserver(resize);observer.observe(viewport);
document.querySelector('#load').onclick=create;
function cue(cancel=false){if(!actor)return;const time=performance.now()/1000;actor.advance(time);actor.enqueue(cancel?{type:'cancel',time,fadeOutSec:.3}:{type:'face',time,id:selection.value,amount:Number(document.querySelector('#intensity').value),fadeInSec:.42,fadeOutSec:.28});loop?.invalidate();}
document.querySelector('#cue').onclick=()=>cue();document.querySelector('#basis').onclick=()=>cue(true);
document.querySelector('#dispose').onclick=()=>{stop();draw();};
document.querySelector('#front').onclick=()=>{camera.position.set(0,1,5);camera.lookAt(0,.9,0);loop?.invalidate();};
document.querySelector('#quarter').onclick=()=>{camera.position.set(4,1,4);camera.lookAt(0,.9,0);loop?.invalidate();};
window.addEventListener('pagehide',()=>{closed=true;stop();observer.disconnect();lifecycle.dispose();pool.dispose();renderer.dispose();},{once:true});
create();
