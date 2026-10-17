import * as T from 'three';
import {createAdmittedHost, facts} from './host-admission.mjs';
import {BodyRigAdapter} from '../../drag-body-prototype-v1/src/body-adapter.mjs';
import {DragController,smooth} from '../../drag-landing-r5/src/drag-controller.mjs';
import {PettingController} from '../../petting-prototype-v1/src/petting-controller.mjs';
const blend=(a,b,u)=>{const out={body:{},joints:{}};for(const k of ['x','y','z'])out.body[k]=(a.body?.[k]??0)*(1-u)+(b.body?.[k]??0)*u;for(const n of ['Shoulder_L','Shoulder_R','Hip_L','Hip_R']){out.joints[n]={};for(const k of ['x','y','z'])out.joints[n][k]=(a.joints?.[n]?.[k]??0)*(1-u)+(b.joints?.[n]?.[k]??0)*u;}return out;};
/** DOM pointer adapter, one actor/face owner/body writer. scheduler uses seconds,
 * while browser default maps performance.now and RAF milliseconds to seconds.
 * Admission is internal Raycaster against owned skin; no public eligible/hit input.
 * CSS client coordinates are DIP; rect maps CSS to NDC. Backbuffer/DPR never enters.
 */
export async function createPointerHost({target,windowTarget=globalThis.window,documentTarget=globalThis.document,camera,profile,readPack,modelVariant='full18',dragOptions={},bodyOptions={},scheduler={now:()=>performance.now()/1000,request:cb=>requestAnimationFrame(ms=>cb(ms/1000)),cancel:id=>cancelAnimationFrame(id)},dragPixels=8,qualifySec=.4}={}){
 if(!target?.addEventListener||!camera?.isCamera||!profile||!Number.isFinite(dragPixels)||dragPixels<=0)throw Error('DOM target, camera, profile and bounded thresholds required');
 const yawDegrees=bodyOptions?.yawDegrees===undefined?52:bodyOptions.yawDegrees;
 if(!bodyOptions||typeof bodyOptions!=='object'||Array.isArray(bodyOptions)||Object.keys(bodyOptions).some(k=>k!=='yawDegrees')||!Number.isFinite(yawDegrees)||Math.abs(yawDegrees)>180)throw RangeError('Only finite bodyOptions.yawDegrees within -180..180 is supported');
 const drag=new DragController(profile,dragOptions),pet=new PettingController({qualifySec,dragPixels});
 let admitted,body;
 try{admitted=await createAdmittedHost(readPack,{modelVariant});body=new BodyRigAdapter(admitted.owner.root,{yawDegrees});}
 catch(error){for(const clean of [()=>drag.dispose(),()=>pet.dispose(),()=>body?.dispose(),()=>admitted?.owner.dispose(),()=>admitted?.pool.dispose()]){try{clean();}catch{}}throw error;}
 const {owner,pool,pack}=admitted;
 let cleanup=()=>{for(const fn of [()=>drag.dispose(),()=>pet.dispose(),()=>body.dispose(),()=>owner.dispose(),()=>pool.dispose()]){try{fn();}catch{}}};
 try {
 const raycaster=new T.Raycaster();let queue=[],sealed=-Infinity,lastReceived=-Infinity,active=null,mode='idle',face=null,life=owner.maxAdmittedLifetime,lastFaceAt=-Infinity,closed=false,hidden=false,blurred=false,raf=null,release=null,transition=null,restContext=false,lastPose={body:{},joints:{}},last=null;
 let ground=body.minimumFoot();const listeners=[];const diagnostics={rejected:0,captureFailures:0,releaseFailures:0,commits:0,lifecycleInvalidations:0};
 function ray(x,y){const r=target.getBoundingClientRect();if(![x,y,r.left,r.top,r.width,r.height].every(Number.isFinite)||r.width<=0||r.height<=0)return null;camera.updateMatrixWorld(true);body.root.updateMatrixWorld(true);body.skin.computeBoundingSphere();raycaster.setFromCamera(new T.Vector2((x-r.left)/r.width*2-1,1-(y-r.top)/r.height*2),camera);return {ray:raycaster.ray.clone(),inside:x>=r.left&&x<=r.left+r.width&&y>=r.top&&y<=r.top+r.height};}
 function hit(x,y){const r=ray(x,y);if(!r?.inside)return null;return raycaster.intersectObject(body.skin,false)[0]??null;}
 function contact(h){if(!h)return {eligible:false,side:0};const p=body.skin.worldToLocal(h.point.clone());return {eligible:p.y>=1.2&&p.y<=1.65,side:Math.max(-1,Math.min(1,p.x/.7))};}
 function capture(){try{target.setPointerCapture(active.id);active.captured=target.hasPointerCapture?.(active.id)??true;}catch{diagnostics.captureFailures++;active.captured=false;}}
 function dropCapture(a){if(!a?.captured)return;a.captured=false;try{target.releasePointerCapture(a.id);}catch{diagnostics.releaseFailures++;}}
 function advancePet(t){while(pet.deadline<=t){pet.advance(pet.deadline);pet.drain();}pet.advance(t);pet.drain();}
 function petInput(type,t,e={},c={}){advancePet(t);pet.input({type,time:t,pointerId:active?.id??0,x:e.x??0,y:e.y??0,...c});pet.drain();}
 function updatePointer(e){const r=ray(e.x,e.y);if(r&&active){const p=r.ray.intersectPlane(active.plane,new T.Vector3());if(p)active.point.copy(p);}}
 function startDrag(t,e){const from=lastPose;petInput('interrupt',t);mode='drag';transition={from,time:t};drag.begin(t,{x:active.down.x,y:-active.down.y});drag.move(t,{x:e.x,y:-e.y});updatePointer(e);}
 function finish(t,reason){if(!active)return;const a=active;if(mode==='drag'){apply(t);const height=Math.max(0,body.minimumFoot()-ground),duration=Math.max(.35,Math.min(1.5,.35+Math.sqrt(height)*.45));release={time:t,duration,height,x:body.root.position.x,z:body.root.position.z};drag.release(t,{duration,cancel:reason!=='up'});mode='landing';}else {petInput(reason==='up'?'up':'cancel',t);mode=pet.snapshot().phase==='idle'?'idle':'petting';}active=null;dropCapture(a);}
 function process(e){const t=e.t;
  if(e.type==='down'){const regrabbing=mode==='landing'&&drag.mode==='settle';if(active||e.primary===false||e.button!==0||hidden||(mode==='landing'&&!regrabbing))return;const h=hit(e.x,e.y);if(!h)return;const c=contact(h);restContext=false;if(regrabbing||drag.snapshot().faceIntent)drag.interrupt(t);if(!regrabbing)ground=body.minimumFoot();const normal=camera.getWorldDirection(new T.Vector3());active={id:e.id,down:{x:e.x,y:e.y},latest:{x:e.x,y:e.y},anchor:body.surfaceAnchor(h),point:h.point.clone(),plane:new T.Plane().setFromNormalAndCoplanarPoint(normal,h.point),captured:false,petEligible:c.eligible};mode='pending';release=null;transition=regrabbing?{from:lastPose,time:t,duration:.12}:null;petInput('down',t,e,c);capture();return;}
  if(!active||e.id!==active.id)return;
  if(['up','cancel','lostcapture'].includes(e.type)){if(e.type==='up'&&mode==='drag'&&[e.x,e.y].every(Number.isFinite)){drag.move(t,{x:e.x,y:-e.y});updatePointer(e);}finish(t,e.type);return;}
  if(e.type==='leave'){if(mode==='pending'||!active.captured)finish(t,'cancel');return;}
  if(e.type==='move'){if(e.buttons===0){finish(t,'cancel');return;}active.latest={x:e.x,y:e.y};if(mode==='drag'){drag.move(t,{x:e.x,y:-e.y});updatePointer(e);return;}
   // Once a held gesture exceeds drag threshold, capture permits leaving skin.
   if(Math.hypot(e.x-active.down.x,e.y-active.down.y)>dragPixels){if(active.captured||hit(e.x,e.y))startDrag(t,e);else finish(t,'cancel');return;}
   const c=contact(hit(e.x,e.y));if(!c.eligible){finish(t,'cancel');return;}petInput('move',t,e,c);
  }
 }
 function advanceControllers(t){
  // Lost pending eligibility must be revoked before crossing its qualification
  // boundary. This cancellation has no emitted face/body intent to backdate.
  if(active&&mode==='pending'&&pet.phase==='pending'&&!contact(hit(active.latest.x,active.latest.y)).eligible){petInput('cancel',pet.time);const a=active;active=null;mode='idle';dropCapture(a);}
  drag.advance(t);advancePet(t);if(active&&(mode==='pending'||mode==='petting')){
   // Recheck actual current deformed surface before long-press qualification.
   if(pet.snapshot().held){if(!contact(hit(active.latest.x,active.latest.y)).eligible){finish(t,'cancel');}else mode='petting';}
  }if(mode==='landing'&&drag.mode==='rest'){restContext=true;mode='idle';release=null;transition=null;}if(mode==='petting'&&!active&&pet.phase==='idle')mode='idle';}
 function apply(t){let pose=mode==='idle'?{body:{},joints:{}}:mode==='drag'||mode==='landing'?drag.snapshot().pose:pet.snapshot();if(transition&&mode!=='idle')pose=blend(transition.from,pose,smooth((t-transition.time)/(transition.duration??.22)));lastPose=pose;body.applyPose(pose);
  if(active&&mode==='drag'){const p=body.surfacePoint(active.anchor);body.place({x:body.root.position.x+active.point.x-p.x,y:body.root.position.y+active.point.y-p.y,z:body.root.position.z+active.point.z-p.z});body.constrainGround(ground);}
  else if(release){const y=ground+release.height*(1-smooth((t-release.time)/release.duration));body.place({x:release.x,z:release.z});body.place({y:body.root.position.y+y-body.minimumFoot()});}
  else body.place({y:body.root.position.y+ground-body.minimumFoot()});
 }
 function snapshot(t){return {time:t,mode,hidden,pointerId:active?.id??null,captured:active?.captured??false,drag:drag.snapshot(),pet:pet.snapshot(),body:body.snapshot(),face:owner.state};}
 function commit(t){apply(t);const candidate=(mode==='drag'||mode==='landing'||mode==='idle')?drag.snapshot().faceIntent:mode==='petting'&&pet.phase!=='idle'?pet.snapshot().face:null,events=[];
  if(candidate!==face?.candidate||(candidate&&t-lastFaceAt>=20)){lastFaceAt=t;if(face&&candidate!==face.candidate)events.push({type:'release',owner:'interaction',requestId:face.requestId,lifetime:face.lifetime});face=null;if(candidate){face={candidate,lifetime:++life,requestId:'pointer'+life};events.push({type:'request',owner:'interaction',...face,holdMode:'restart'});}}
  owner.completeBatch({wallTime:t,epoch:owner.epoch,facts:facts(!!active||mode!=='idle'||!!candidate,{rest:mode==='idle'&&restContext&&!candidate}),events});owner.assertCurrent();sealed=t;diagnostics.commits++;last=snapshot(t);return last;
 }
 function doFrame(t){if(closed||hidden)return;if(!Number.isFinite(t)||t<sealed)throw Error('Monotonic frame time');while(queue.length&&queue[0].t<=t){const at=queue[0].t;advanceControllers(at);apply(at);while(queue.length&&queue[0].t===at)process(queue.shift());commit(at);}if(t>sealed){advanceControllers(t);commit(t);}return last;}
 function frame(t){try{return doFrame(t);}catch(error){try{dispose();}catch{}throw error;}}
 function receive(type,event){if(closed||hidden)return false;const t=scheduler.now();if(Number.isFinite(t)&&t<=sealed&&active?.id===event.pointerId&&['up','cancel','lostcapture'].includes(type)){diagnostics.lifecycleInvalidations++;suspend();resume();return true;}
  if(!Number.isFinite(t)||t<0||t<=sealed||t<lastReceived||queue.length>=1024){diagnostics.rejected++;return false;}
  const validPoint=[event.clientX,event.clientY].every(v=>Number.isFinite(v)&&Math.abs(v)<=1e5);
  if(!Number.isSafeInteger(event.pointerId)||event.pointerId<0||(['down','move'].includes(type)&&!validPoint)){diagnostics.rejected++;return false;}
  queue.push({type,t,id:event.pointerId,primary:event.isPrimary,button:event.button,buttons:event.buttons,x:validPoint?event.clientX:undefined,y:validPoint?event.clientY:undefined});lastReceived=t;return true;
 }
 // Lifecycle barriers invalidate queued input/capture synchronously, even when the
 // current clock equals a sealed frame. They do not invent epsilon timestamps.
 function suspend(){if(closed||hidden)return;const t=Math.max(sealed,drag.time,pet.time,scheduler.now());hidden=true;queue=[];const a=active;active=null;dropCapture(a);drag.suspend(t);petInput('hidden',t);face=null;release=null;transition=null;restContext=false;mode='idle';lastPose={body:{},joints:{}};body.restore();body.place({y:body.root.position.y+ground-body.minimumFoot()});owner.suspend(t);if(owner.weightedState.facts.context==='rest'||owner.state.owner==='p1_idle')owner.invalidate(owner.epoch);hidden=true;sealed=t;last=snapshot(t);}
 function resume(){if(closed||!hidden||documentTarget?.hidden||blurred)return;const t=Math.max(sealed,scheduler.now());drag.resume(t);advancePet(t);owner.resume(t);hidden=false;sealed=t;last=snapshot(t);}
 function dispose(){if(closed)return;closed=true;queue=[];last={...last,mode:'disposed',pointerId:null,captured:false,disposed:true};const a=active;active=null;dropCapture(a);const ticket=raf;raf=null;let error;for(const clean of [()=>{if(ticket!==null)scheduler.cancel(ticket);},...listeners.splice(0),()=>drag.dispose(),()=>pet.dispose(),()=>body.dispose(),()=>owner.dispose(),()=>pool.dispose()]){try{clean();}catch(e){error??=e;}}if(error)throw error;}
 cleanup=dispose;
 function listen(obj,type,fn){if(!obj?.addEventListener)return;listeners.push(()=>obj.removeEventListener(type,fn));obj.addEventListener(type,fn);}
 try {
 for(const [dom,type] of Object.entries({pointerdown:'down',pointermove:'move',pointerup:'up',pointercancel:'cancel',lostpointercapture:'lostcapture',pointerleave:'leave'}))listen(target,dom,e=>receive(type,e));
 listen(windowTarget,'blur',()=>{blurred=true;suspend();});listen(windowTarget,'focus',()=>{blurred=false;resume();});listen(documentTarget,'visibilitychange',()=>documentTarget.hidden?suspend():resume());
 // A release outside target is observed even after capture acquisition failed.
 listen(windowTarget,'pointerup',e=>{if(e.target!==target)receive('up',e);});listen(windowTarget,'pointercancel',e=>{if(e.target!==target)receive('cancel',e);});
 if(documentTarget?.hidden)suspend();
 function loop(t){raf=null;if(closed)return;try{frame(t);if(!closed)raf=scheduler.request(loop);}catch(error){try{dispose();}catch{}throw error;}}raf=scheduler.request(loop);
 }catch(error){try{dispose();}catch{}throw error;}
 return {owner,pool,pack,body,diagnostics,frame,get state(){return last;},get pendingCount(){return queue.length;},dispose,suspend,resume};
 }catch(error){try{cleanup();}catch{}throw error;}
}

// Explicit opt-in: policy and pack admission are selected together.
export const createD2PointerHost=options=>createPointerHost({...options,modelVariant:'d2'});
