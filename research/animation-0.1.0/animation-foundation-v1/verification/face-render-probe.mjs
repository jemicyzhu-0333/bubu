import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {bindFacePaths} from '../../runtime-facepath05/src/face-binding.mjs';
import {bindSparseFaceRendering} from '../../runtime-facepath05/src/sparse-face-rendering.mjs';
import {prepareD2SourceGeometry,bindD2FaceStyle} from '../../runtime-facepath05/src/d2-face-style.mjs';
import {createSparseSkinningLease} from './sparse-skinning.mjs';

const renderer=new T.WebGLRenderer({canvas:document.querySelector('canvas'),antialias:true});
renderer.setSize(512,512);renderer.setClearColor(0xcbd6cc);
const errors=[];
renderer.debug.onShaderError=(gl,program,vertex,fragment)=>errors.push({program:gl.getProgramInfoLog(program),vertex:gl.getShaderInfoLog(vertex),fragment:gl.getShaderInfoLog(fragment)});
const profile=await fetch('../../runtime-facepath05/fixtures/face-d2/profile.json').then(r=>r.json());
const source=(await new GLTFLoader().loadAsync('../../runtime-facepath05/fixtures/face-d2/asset.glb')).scene;
prepareD2SourceGeometry(source);
const scene=new T.Scene(),camera=new T.OrthographicCamera(-2.5,2.5,4,-1,.01,100);
camera.position.set(0,0,8);camera.lookAt(0,0,0);
scene.add(new T.HemisphereLight(0xfff9e6,0x718778,2.1));
const key=new T.DirectionalLight(0xfff9ed,2.4);key.position.set(3,5,8);scene.add(key);
const models=[clone(source),clone(source),clone(source)],bindings=models.map(m=>bindFacePaths(m,profile));
const styles=models.map(bindD2FaceStyle),sparse=bindSparseFaceRendering(models[1],profile);
const skinned=[];models[2].traverse(o=>{if(o.isSkinnedMesh)skinned.push(o);});
const skinLease=createSparseSkinningLease(skinned);
scene.add(...models);
const target=new T.WebGLRenderTarget(512,512,{depthBuffer:true});
const pixels=models.map(()=>new Uint8Array(512*512*4));
function draw(mode,read=false){
  models.forEach((m,i)=>m.visible=i===mode);
  renderer.setRenderTarget(read?target:null);renderer.render(scene,camera);
  if(read)renderer.readRenderTargetPixels(target,0,0,512,512,pixels[mode]);
}
export function sample(path,amount,angle=0,mode=1){
  const radians=angle*Math.PI/180;camera.position.set(8*Math.sin(radians),0,8*Math.cos(radians));camera.lookAt(0,0,0);
  bindings.forEach(b=>b.apply(path,amount));styles.forEach(s=>s.apply(path,amount));sparse.update();
  draw(0,true);draw(mode,true);
  let different=0,maxDelta=0;
  for(let i=0;i<pixels[0].length;i++)if(pixels[0][i]!==pixels[mode][i]){different++;maxDelta=Math.max(maxDelta,Math.abs(pixels[0][i]-pixels[mode][i]));}
  return {path,amount,angle,different,maxDelta};
}
export async function timing(mode,frames=90){
  const intervals=[],cpu=[],gl=renderer.getContext();let previous;
  for(let i=0;i<frames+10;i++){
    const now=await new Promise(requestAnimationFrame);
    if(i>=10)intervals.push(now-previous);previous=now;
    const start=performance.now(),amount=(i%17)/16;
    bindings[mode].apply('N3',amount);styles[mode].apply('N3',amount);if(mode===1)sparse.update();
    draw(mode);gl.finish();if(i>=10)cpu.push(performance.now()-start);
  }
  const stats=a=>{a.sort((x,y)=>x-y);return {p50:a[Math.floor(a.length*.5)],p95:a[Math.floor(a.length*.95)],max:a.at(-1)};};
  return {mode,frames,intervalMs:stats(intervals),completedRenderMs:stats(cpu)};
}
export function status(){const gl=renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');return {errors,graphics:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):null,resources:renderer.info.memory,paths:profile.paths.map(p=>p.id)};}
/** Isolated controls, never enabled in the demo or used as quality reductions. */
export async function control(name,frames=40){
  if(!['raf-only','empty','body-only','faces-only','static-neutral','static-face','animated-face','sparse-face','sparse-skin'].includes(name))throw Error('Unknown rendering control');
  const mode=name==='sparse-face'?1:name==='sparse-skin'?2:0,model=models[mode],changed=[];
  camera.position.set(0,0,8);camera.lookAt(0,0,0);renderer.setRenderTarget(null);
  for(const object of [model.getObjectByName('A_mochi_skin'),...profile.faceMeshes.map(n=>model.getObjectByName(n))]){
    changed.push([object,object.visible]);
    object.visible=name==='body-only'?object.name==='A_mochi_skin':name==='faces-only'?object.name!=='A_mochi_skin':true;
  }
  const gl=renderer.getContext(),intervals=[],submit=[],readback=[];let previous;
  const pixel=new Uint8Array(4);
  const configure=i=>{const amount=name==='static-neutral'?0:['animated-face','sparse-face','sparse-skin'].includes(name)?(i%17)/16:.4375;bindings[mode].apply('N3',amount);styles[mode].apply('N3',amount);if(mode===1)sparse.update();};
  function render(){
    models.forEach((m,i)=>m.visible=name!=='empty'&&i===mode);
    renderer.render(scene,camera);
  }
  try{
    for(let i=0;i<frames+10;i++){
      const now=await new Promise(requestAnimationFrame);if(i>=10)intervals.push(now-previous);previous=now;
      const begin=performance.now();configure(i);if(name!=='raf-only')render();
      if(i>=10)submit.push(performance.now()-begin);
    }
    const drawCounts={...renderer.info.render};
    if(name!=='raf-only')for(let i=0;i<12;i++){
      configure(i);const start=performance.now();render();gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
      if(i>=2)readback.push(performance.now()-start);
    }
    const stats=a=>{if(!a.length)return null;a.sort((x,y)=>x-y);return {n:a.length,p50:a[Math.floor(a.length*.5)],p95:a[Math.floor(a.length*.95)],max:a.at(-1)};};
    return {name,intervalMs:stats(intervals),clientSubmitMs:stats(submit),drawAndSyncReadbackMs:stats(readback),drawCounts,gpuTimerAvailable:Boolean(gl.getExtension('EXT_disjoint_timer_query_webgl2')),glError:gl.getError()};
  }finally{for(const [object,visible] of changed)object.visible=visible;}
}
export function dispose(){skinLease.dispose();sparse.dispose();styles.forEach(s=>s.dispose());bindings.forEach(b=>b.dispose());target.dispose();renderer.dispose();}
draw(0);draw(1);document.documentElement.dataset.ready='true';
