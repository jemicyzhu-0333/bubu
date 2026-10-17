/** Pure deterministic input/acting controller. Seconds from the host's single logical clock.
 * No geometry, morph writes, timers, Math.random, or independent animation clock. */
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const finite=(v)=>typeof v==='number'&&Number.isFinite(v);
const zero=()=>({x:0,y:0,z:0,left:0,right:0});
const hash=n=>{let x=(n+1)*2654435761>>>0;x^=x>>>16;x=Math.imul(x,2246822507);x^=x>>>13;return (x>>>0)/4294967296;};
export class PettingController {
 constructor({qualifySec=.4,dragPixels=8}={}) {
  if(!finite(qualifySec)||qualifySec<.25||qualifySec>1||!finite(dragPixels)||dragPixels<=0)throw Error('recognition bounds');
  this.qualifySec=qualifySec;this.dragPixels=dragPixels;this.time=0;this.phase='idle';this.pointer=null;this.session=0;this.deadline=Infinity;this.held=false;this.side=0;this.pose=zero();this.velocity=zero();this.target=zero();this.face=null;this.outputs=[];this.response=0;this.disposed=false;
 }
 #emit(type,extra={}) {this.outputs.push({type,time:this.time,session:this.session,...extra});if(this.outputs.length>128)throw Error('drain outputs before continuing');}
 #face(face) {if(face!==this.face){this.face=face;this.#emit('face',{face});}}
 #base() {this.target={x:.011,y:this.side*.022,z:-this.side*.015,left:.012+Math.max(0,this.side)*.01,right:.012+Math.max(0,-this.side)*.01};}
 #settle() {this.phase='sustain';this.#base();this.#face('P2');this.deadline=this.time+14+hash(this.response+this.session*31)*11;}
 #boundary() {
  if(this.phase==='pending'){this.phase='enter';this.held=true;this.#base();this.#face('08');this.#emit('qualified');this.deadline=this.time+1.25;}
  else if(this.phase==='enter')this.#settle();
  else if(this.phase==='sustain'){this.phase='response';this.response++;this.#base();this.target.y+=this.side*.003;this.target.x=.007;this.#face(this.response%3===0?'S2':'07');this.deadline=this.time+2.1;}
  else if(this.phase==='response')this.#settle();
  else if(this.phase==='release'){this.phase='idle';this.pose=zero();this.velocity=zero();this.target=zero();this.#emit('finished');this.deadline=Infinity;}
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
   this.pointer=e.pointerId;this.session++;this.down={x:e.x,y:e.y};this.side=clamp(e.side??0,-1,1);this.phase='pending';this.deadline=this.time+this.qualifySec;this.held=false;this.#emit('pending');
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
 #release(reason){if(this.pointer===null&&!this.held&&this.phase!=='pending')return;const active=this.held||Object.values(this.pose).some(v=>Math.abs(v)>1e-10);this.pointer=null;this.held=false;this.target=zero();this.phase=active?'release':'idle';this.deadline=active?this.time+1.8:Infinity;if(active)this.#face('R0');this.#emit('released',{reason,active});}
 drain(){const out=this.outputs;this.outputs=[];return out;}
 snapshot(){return {time:this.time,phase:this.phase,session:this.session,held:this.held,interactionOwned:this.phase!=='idle',face:this.face,body:{x:this.pose.x,y:this.pose.y,z:this.pose.z},joints:{Shoulder_L:{x:0,y:0,z:this.pose.left},Shoulder_R:{x:0,y:0,z:-this.pose.right},Hip_L:{x:0,y:0,z:0},Hip_R:{x:0,y:0,z:0}}};}
 dispose(){this.pointer=null;this.held=false;this.outputs=[];this.pose=zero();this.velocity=zero();this.target=zero();this.deadline=Infinity;this.disposed=true;}
}
