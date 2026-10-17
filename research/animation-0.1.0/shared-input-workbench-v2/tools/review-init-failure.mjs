// Portable import-layout adaptation only; original probe preserved in evidence/review.
import assert from 'node:assert/strict';import fs from 'node:fs';
const base=new URL('../../',import.meta.url);
const T=await import('three');
const {ActorPool}=await import(new URL('runtime-facepath05/src/actor-pool.mjs',base));
const {createD2PointerHost}=await import(new URL('shared-input-workbench-v2/src/fixture-host.mjs',base));
const profile=JSON.parse(fs.readFileSync(new URL('drag-body-prototype-v1/replay/body-poses.json',base)));
let pool;const old=ActorPool.prototype.createWeighted;ActorPool.prototype.createWeighted=function(...args){pool=this;return old.apply(this,args);};
class Target extends EventTarget{constructor(){super();this.listeners=0;}addEventListener(...a){this.listeners++;return super.addEventListener(...a)}removeEventListener(...a){this.listeners--;return super.removeEventListener(...a)}getBoundingClientRect(){return {left:0,top:0,width:400,height:400};}}
const target=new Target(),win=new Target(),doc=new Target(),camera=new T.OrthographicCamera(-2,2,3,-1,.01,100);camera.position.set(0,0,8);camera.lookAt(0,0,0);camera.updateProjectionMatrix();
try{await assert.rejects(createD2PointerHost({target,windowTarget:win,documentTarget:doc,camera,profile,scheduler:{now:()=>0,request(){throw Error('injected initial RAF error')},cancel(){}}}),/initial RAF/);const out={stats:pool.stats,listeners:[target.listeners,win.listeners,doc.listeners]};console.log(JSON.stringify(out));assert.equal(pool.stats.active,0,'failed initialization leaked actor');assert.equal(pool.stats.cache.live,0);assert.deepEqual(out.listeners,[0,0,0]);}finally{ActorPool.prototype.createWeighted=old;pool?.dispose();}
