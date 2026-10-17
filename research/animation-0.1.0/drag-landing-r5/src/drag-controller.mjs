import {APPROVED_STRUGGLE_R2} from './approved-struggle-r2.mjs';
import {InputIntent} from './input-intent.mjs';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const smooth=u=>{u=clamp(u,0,1);return u*u*u*(10+u*(-15+6*u));};
const mix=(a,b,u)=>{const o={body:{},joints:{}};for(const k of ['x','y','z'])o.body[k]=(a.body?.[k]??0)*(1-u)+(b.body?.[k]??0)*u;for(const n of ['Shoulder_L','Shoulder_R','Hip_L','Hip_R']){o.joints[n]={};for(const k of ['x','y','z'])o.joints[n][k]=(a.joints?.[n]?.[k]??0)*(1-u)+(b.joints?.[n]?.[k]??0)*u;}return o;};
const finitePoint=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&Math.max(Math.abs(p.x),Math.abs(p.y))<=1e5;
/** Pure seconds/DIP input controller. One bounded spring, no face timeline.
 * Pointer positioning is independent of the protected pickup acting track. */
export class DragController {
 constructor(profile,{struggleCycleSeconds=.82}={}){if(!Number.isFinite(struggleCycleSeconds)||struggleCycleSeconds<.65||struggleCycleSeconds>1)throw RangeError('Struggle cadence must be within .65–1 seconds');this.struggleCycleSeconds=struggleCycleSeconds;this.profile=profile;this.time=0;this.mode='rest';this.held=false;this.disposed=false;this.hidden=false;this.intent=new InputIntent();this.pickupAt=null;this.lastMove=0;this.velocity={x:0,y:0};this.lag={x:0,y:0};this.lagV={x:0,y:0};this.events=[];this.releaseAt=0;this.releaseDuration=.5;this.releasePose=null;this.landingFaceUntil=-Infinity;}
 live(){if(this.disposed)throw Error('Drag controller disposed');}
 advance(t){this.live();if(!Number.isFinite(t)||t<this.time)throw RangeError('Monotonic finite time');const delta=t-this.time;if(this.hidden){this.time=t;return this.snapshot();}if(delta>60){this.lag={x:0,y:0};this.lagV={x:0,y:0};}
 else {let cursor=this.time;while(cursor<t-1e-12){const dt=Math.min(1/240,t-cursor);cursor+=dt;const moving=this.held&&cursor-this.lastMove<.10;for(const k of ['x','y']){const target=moving?clamp(this.velocity[k]/180,-1,1):0;const w=12;this.lagV[k]+=(w*w*(target-this.lag[k])-2*.70*w*this.lagV[k])*dt;this.lag[k]+=this.lagV[k]*dt;}}}
 this.time=t;if(this.mode==='pickup'&&t-this.pickupAt>=1.075){this.mode='hover';this.events.push({t:this.pickupAt+1.075,type:'pickup-complete'});}if(this.mode==='descending'&&t>=this.releaseAt+this.releaseDuration)this.mode='settle';if(this.mode==='settle'&&t>=this.releaseAt+this.releaseDuration+.48){this.mode='rest';this.lag={x:0,y:0};this.lagV={x:0,y:0};}if(this.held&&!['pending','pickup'].includes(this.mode))this.mode=t-this.lastMove<.12&&Math.hypot(this.velocity.x,this.velocity.y)>70?'drag':Math.hypot(this.lag.x,this.lag.y)>.15?'recover':'hover';return this.snapshot();}
 begin(t,p){if(!finitePoint(p))throw RangeError('Finite bounded DIP point');this.advance(t);if(this.hidden)throw Error('Hidden');this.held=true;this.mode='pending';this.pickupAt=null;this.takeoverPose=null;this.landingFaceUntil=-Infinity;this.intent.reset(t,p);this.lastMove=t;this.velocity={x:0,y:0};this.events.push({t,type:'begin'});}
 move(t,p){if(!finitePoint(p))throw RangeError('Finite bounded DIP point');this.advance(t);if(!this.held||this.hidden)return;const motion=this.intent.observe(t,p);this.lastMove=t;this.velocity=motion.velocityDIP;if(this.mode==='pending'&&motion.distanceDIP>=1){this.pickupAt=t;this.mode='pickup';this.events.push({t,type:'pickup-start'});}if(this.mode==='pickup'&&motion.fast){this.takeoverPose=this.pose();this.takeoverAt=t;this.mode='drag';this.events.push({t,type:'fast-takeover'});}return this.snapshot();}
 release(t,{duration=.6,cancel=false}={}){if(!Number.isFinite(duration)||duration<.12||duration>3)throw RangeError('Bounded release duration');this.advance(t);if(!this.held)return;this.releasePose=this.pose();this.held=false;this.mode='descending';this.releaseAt=t;this.releaseDuration=duration;this.cancelledRelease=!!cancel;this.landingFaceUntil=cancel?-Infinity:t+duration+.9;this.velocity={x:0,y:0};this.events.push({t,type:'release'});}
 cancel(t){this.release(t,{cancel:true});this.landingFaceUntil=-Infinity;this.events.push({t,type:'cancel'});}
 interrupt(t){this.advance(t);this.landingFaceUntil=-Infinity;this.held=false;this.mode='rest';this.releasePose=null;this.takeoverPose=null;this.velocity={x:0,y:0};this.lag={x:0,y:0};this.lagV={x:0,y:0};this.events.push({t,type:'interrupt'});}
 suspend(t){this.advance(t);this.landingFaceUntil=-Infinity;this.hidden=true;this.held=false;this.mode='rest';this.lag={x:0,y:0};this.lagV={x:0,y:0};this.events.push({t,type:'hidden'});}
 resume(t){this.advance(t);this.hidden=false;this.mode='rest';}
 pose(){const p=this.profile.poses;if(this.mode==='rest'||this.mode==='pending'||this.hidden)return mix(p.rest,p.rest,0);if(this.mode==='settle'){const age=this.time-(this.releaseAt+this.releaseDuration),u=clamp(age/.48,0,1);const compression=Math.sin(Math.PI*u)**2*Math.sin(2*Math.PI*u);const settle=mix(p.rest,p.rest,0);if(compression===0)return settle;settle.body.x=.025*compression;for(const name of ['Hip_L','Hip_R'])settle.joints[name].x=.045*compression;settle.joints.Shoulder_L.z=-.035*compression;settle.joints.Shoulder_R.z=.035*compression;return settle;}if(this.mode==='descending')return mix(this.releasePose,p.rest,smooth((this.time-this.releaseAt)/this.releaseDuration));
 const age=this.time-this.pickupAt;let pose;
 if(this.mode==='pickup'){const u=age/1.075;const keys=this.profile.pickupTrack;let i=1;while(i<keys.length-1&&keys[i].seconds<u)i++;const a=keys[i-1],b=keys[i];pose=mix(p[a.pose],p[b.pose],smooth((u-a.seconds)/(b.seconds-a.seconds)));}
 else pose=mix(p.drag_alert,p.drag_alert,0);
 // Cadence is only for airborne idle struggle. Pickup, input velocity window,
 // inertial spring and release retain their independent real-time durations.
 if(this.mode!=='pickup'){
  // Continuous airborne loop: persistent phase, staggered limbs, curved paths.
  // No endpoint holds and no shared all-limb sine. Second harmonic shapes the
  // stroke without stopping at its extrema; the orthogonal channel keeps moving.
  const phase=Math.max(0,age-1.075)/this.struggleCycleSeconds;
  const authored={body:{x:0,y:0,z:0},joints:{}};
  const offsets={Shoulder_L:0,Shoulder_R:.055,Hip_L:.16,Hip_R:.215};
  for(const name of Object.keys(offsets)){
   const theta=2*Math.PI*(phase+offsets[name]);
   const stroke=Math.sin(theta+.12*Math.sin(theta));
   const u=(stroke+1)/2;
   const a=APPROVED_STRUGGLE_R2.beat_A.joints[name],b=APPROVED_STRUGGLE_R2.beat_B.joints[name];
   authored.joints[name]=Object.fromEntries(['x','y','z'].map(k=>[k,a[k]*(1-u)+b[k]*u]));
   if(name.startsWith('Shoulder'))authored.joints[name].x=.022*Math.cos(theta)*(name.endsWith('L')?1:-1);
   else authored.joints[name].y=.012*Math.cos(theta)*(name.endsWith('L')?1:-1);
  }
  const entry=smooth((age-1.075)/.22);
  pose=mix(p.drag_alert,authored,entry);
  const magnitude=Math.hypot(this.lag.x,this.lag.y),strength=smooth(magnitude/.75),sum=Math.abs(this.lag.x)+Math.abs(this.lag.y);
  // At brisk speed the actual signed inertial response fully owns the pose,
  // so fast dragging is not another cadence-driven wobble.
  if(sum>1e-8){const direction=mix(p['lag_'+(this.lag.y<0?'down':'up')],p['lag_'+(this.lag.x<0?'left':'right')],Math.abs(this.lag.x)/sum);pose=mix(pose,direction,strength);}
 }
 if(this.takeoverPose&&this.time-this.takeoverAt<.14)pose=mix(this.takeoverPose,pose,smooth((this.time-this.takeoverAt)/.14));
 return pose;
 }
 snapshot(){return {time:this.time,mode:this.mode,held:this.held,pose:this.pose(),lag:{...this.lag},faceIntent:(this.mode==='settle'||this.mode==='rest')?(!this.hidden&&this.time<this.landingFaceUntil?'landingP2':null):this.mode==='pending'||this.mode==='rest'||this.mode==='descending'?null:this.mode==='pickup'?'N3':Math.hypot(this.velocity.x,this.velocity.y)>70&&this.time-this.lastMove<.12?'T05':'01'};}
 dispose(){if(this.disposed)return;this.landingFaceUntil=-Infinity;this.held=false;this.mode='rest';this.disposed=true;}
}
export {smooth};
