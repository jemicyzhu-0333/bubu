/** Pure deterministic input/acting controller. Seconds from the host's single logical clock.
 * No geometry, morph writes, timers, Math.random, or independent animation clock. */
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const finite=(v)=>typeof v==='number'&&Number.isFinite(v);
const zero=()=>({x:0,y:0,z:0,left:0,right:0});
const hash=n=>{let x=(n+1)*2654435761>>>0;x^=x>>>16;x=Math.imul(x,2246822507);x^=x>>>13;return (x>>>0)/4294967296;};
export class PettingController {
 constructor({qualifySec=.4,dragPixels=8}={}) {
  if(!finite(qualifySec)||qualifySec<.25||qualifySec>1||!finite(dragPixels)||dragPixels<=0)throw Error('recognition bounds');
  this.qualifySec=qualifySec;this.dragPixels=dragPixels;this.time=0;this.phase='idle';this.pointer=null;this.session=0;this.deadline=Infinity;this.held=false;this.side=0;this.pose=zero();this.velocity=zero();this.target=zero();this.face=null;this.outputs=[];this.response=0;this.responseKind=null;this.enterStep=0;this.qualifiedAt=null;this.nextLookAt=Infinity;this.disposed=false;
 }
 #emit(type,extra={}) {this.outputs.push({type,time:this.time,session:this.session,...extra});if(this.outputs.length>128)throw Error('drain outputs before continuing');}
 #face(face) {if(face!==this.face){this.face=face;this.#emit('face',{face});}}
 #base() {
  // One torso and four approved limbs. No scale/shear, neck, or fabricated fingers.
  const quiet=this.responseKind==='quiet',peek=this.responseKind==='peek',shift=this.responseKind==='settle';
  this.target={x:quiet?.016:peek?.006:.011,y:this.side*(shift?.029:.022),z:-this.side*(shift?.018:.014),
   left:(quiet?.072:peek?.025:.042)+Math.max(0,this.side)*(shift?.016:.009),
   right:(quiet?.072:peek?.025:.042)+Math.max(0,-this.side)*(shift?.016:.009)};
 }
 #settle() {
  this.phase='sustain';this.responseKind=null;this.#base();this.#face('petEnjoy');
  // Whole quiet intervals, not a looping idle animation. One authored decision per boundary.
  const microAt=this.time+10+hash(this.response+this.session*31)*5;
  this.deadline=microAt+5>=this.nextLookAt?this.nextLookAt:microAt;
 }
 #boundary() {
  if(this.phase==='pending'){
   this.phase='enter';this.held=true;this.enterStep=0;this.qualifiedAt=this.time;this.nextLookAt=this.time+32+hash(this.session*43)*6;this.responseKind=null;
   this.#base();this.#face('petNotice');this.#emit('qualified');this.deadline=this.time+.35;
  }else if(this.phase==='enter'){
   if(this.enterStep++===0){this.#face('petRelax');this.deadline=this.time+.9;}
   else this.#settle();
  }else if(this.phase==='sustain'){
   this.phase='response';this.response++;
   this.responseKind=this.time>=this.nextLookAt?'peek':this.response%2?'quiet':'settle';
   if(this.responseKind==='peek')this.nextLookAt=this.time+33+hash(this.response+this.session*71)*5;
   this.#base();
   if(this.responseKind==='quiet')this.#face('petQuiet');
   if(this.responseKind==='peek')this.#face('petLook');
   this.#emit('micro-start',{kind:this.responseKind});
   this.deadline=this.time+(this.responseKind==='peek'?3.6:3.2);
  }else if(this.phase==='response'){this.#emit('micro-end',{kind:this.responseKind});this.#settle();}
  else if(this.phase==='release'){
   this.phase='idle';this.pose=zero();this.velocity=zero();this.target=zero();this.responseKind=null;
   this.#emit('finished');this.deadline=Infinity;
  }
 }
 #integrate(dt){const omega=this.phase==='release'?11:7;for(const k of Object.keys(this.pose)){const x=this.pose[k]-this.target[k],j=this.velocity[k]+omega*x,e=Math.exp(-omega*dt);this.pose[k]=this.target[k]+(x+j*dt)*e;this.velocity[k]=(this.velocity[k]-omega*j*dt)*e;}}
 advance(time){if(this.disposed)throw Error('disposed');if(!finite(time)||time<this.time)throw Error('monotonic finite time required');let count=0;while(this.deadline<=time){if(++count>100000)throw Error('advance budget');this.#integrate(this.deadline-this.time);this.time=this.deadline;this.#boundary();}this.#integrate(time-this.time);this.time=time;return this.snapshot();}
 input(e){
  if(!e||!finite(e.time))throw Error('event time');
  if(!['down','move','up','cancel','lostcapture','hidden','interrupt'].includes(e.type))throw Error('event type');
  if(['down','move'].includes(e.type)&&(!finite(e.x)||!finite(e.y)))throw Error('pointer coordinates');
  if(!['hidden','interrupt'].includes(e.type)&&(!Number.isSafeInteger(e.pointerId)||e.pointerId<0))throw Error('pointer identifier');
  if(e.side!==undefined&&!finite(e.side))throw Error('contact side');
  this.advance(e.time);
  if(e.type==='hidden'||e.type==='interrupt'){this.#release(e.type);return this.snapshot();}
  if(e.type==='down'){
   if(this.pointer!==null)return this.snapshot();
   if(!e.eligible)return this.snapshot();
   this.pointer=e.pointerId;this.session++;this.qualifiedAt=null;this.nextLookAt=Infinity;this.enterStep=0;this.responseKind=null;this.down={x:e.x,y:e.y};this.side=clamp(e.side??0,-1,1);this.phase='pending';this.deadline=this.time+this.qualifySec;this.held=false;this.#emit('pending');
  }else if(e.pointerId===this.pointer&&this.pointer!==null){
   if(e.type==='move'){
    const distance=Math.hypot(e.x-this.down.x,e.y-this.down.y);
    if((this.phase==='pending'||this.phase==='enter')&&distance>this.dragPixels){this.#release('drag');this.#emit('drag-handoff',{x:e.x,y:e.y});}
    else if(this.held&&e.eligible){this.side=clamp(e.side??this.side,-1,1);this.#base();}
    else if((this.held||this.phase==='pending')&&!e.eligible)this.#release('contact-lost');
   }else this.#release(e.type);
  }
  return this.snapshot();
 }
 #release(reason){if(this.pointer===null&&!this.held&&this.phase!=='pending')return;const active=this.held||Object.values(this.pose).some(v=>Math.abs(v)>1e-10);this.pointer=null;this.held=false;this.target=zero();this.phase=active?'release':'idle';this.deadline=active?this.time+1.8:Infinity;if(active&&!['petNotice','petRelax','petLook'].includes(this.face))this.#face('petRelease');this.#emit('released',{reason,active});}
 drain(){const out=this.outputs;this.outputs=[];return out;}
 snapshot(){return {time:this.time,phase:this.phase,session:this.session,held:this.held,qualifiedAt:this.qualifiedAt,holdAge:this.qualifiedAt===null?0:this.time-this.qualifiedAt,responseIndex:this.response,responseKind:this.responseKind,interactionOwned:this.phase!=='idle',face:this.face,body:{x:this.pose.x,y:this.pose.y,z:this.pose.z},joints:{Shoulder_L:{x:0,y:0,z:this.pose.left},Shoulder_R:{x:0,y:0,z:-this.pose.right},Hip_L:{x:0,y:0,z:0},Hip_R:{x:0,y:0,z:0}}};}
 dispose(){this.pointer=null;this.held=false;this.outputs=[];this.pose=zero();this.velocity=zero();this.target=zero();this.deadline=Infinity;this.disposed=true;}
}
