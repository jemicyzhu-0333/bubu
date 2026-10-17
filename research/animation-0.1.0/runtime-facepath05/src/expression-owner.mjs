import {validatePolicy,assertDataRecord,assertDenseDataArray} from './director.mjs';

const finite=t=>{if(typeof t!=='number'||!Number.isFinite(t)||t<0)throw new RangeError('wall time must be nonnegative finite seconds');return t;};
const stopped=()=>new Error('ExpressionOwner closed or faulted');
/** Trusted rendering host boundary. Every mutation enters here; root is render-only.
 * Explicit freeze policy, wall times in seconds from one monotonic source.
 * completeBatch submits the entire timestamp before advancing it. */
export class ExpressionOwner {
  #actor=null;#abort=new AbortController();#status='loading';#busy=false;#epoch=1;#lifetime=0;
  #wall;#logical=0;#origin=0;#paused=false;#fault=null;#scheduler;#draw;#frame=null;#timer=null;#ticket=0;
  #record;#pool;#ready;#cleanups=[];#observerStopped=null;
  constructor({pool,pack,policy,visibilityPolicy,wallTime=0,onRecord=()=>{},scheduler=null,draw=()=>{}}) {
    if(visibilityPolicy!=='freeze')throw new TypeError('Explicit visibilityPolicy: freeze required');
    this.#wall=finite(wallTime);policy=validatePolicy(policy);
    if(typeof onRecord!=='function'||typeof draw!=='function')throw new TypeError('callbacks');
    if(scheduler)for(const k of ['now','requestFrame','cancelFrame','setTimer','clearTimer'])if(typeof scheduler[k]!=='function')throw new TypeError('scheduler '+k);
    this.#pool=pool;this.#scheduler=scheduler;this.#draw=draw;this.#record=onRecord;
    this.#ready=pool.createDirected(pack,policy,{signal:this.#abort.signal,onDispose:()=>{if(this.#actor)this.#stop('closed',null);},onRecord:r=>this.#record(Object.freeze({...r,time:r.time+this.#origin,...(r.logicalArrival!==undefined?{logicalArrival:r.logicalArrival+this.#origin}:{}),...(r.clockActualArrival!==undefined?{clockActualArrival:r.clockActualArrival+this.#origin}:{}),epoch:this.#epoch}))}).then(actor=>{
      if(this.#status!=='loading'){actor.dispose();throw stopped();}
      this.#actor=actor;this.#status='ready';return this;
    },error=>{if(this.#status==='loading')this.#stop('faulted','load');throw error;});
  }
  get ready(){return this.#ready;}
  get status(){return this.#status;}
  get epoch(){return this.#epoch;}
  get maxAdmittedLifetime(){return this.#lifetime;}
  get paused(){return this.#paused;}
  get logicalTime(){return this.#logical;}
  get fault(){return this.#fault;}
  get root(){return this.#actor?.root??null;}
  get state(){this.#live();const s=this.#actor.state;return Object.freeze({...s,time:s.time+this.#origin,deadline:s.deadline+this.#origin,logicalArrival:s.logicalArrival===null?null:s.logicalArrival+this.#origin,clockArrival:s.clockArrival===null?null:s.clockArrival+this.#origin,clockActualArrival:s.clockActualArrival===null?null:s.clockActualArrival+this.#origin,epoch:this.#epoch});}
  get observerStatus(){this.#live();return this.#observerStopped??this.#actor.observerStatus;}
  #live(){if(this.#actor?.disposed)this.#stop('closed',null);if(this.#status!=='ready'||!this.#actor)throw stopped();}
  #enter(){this.#live();if(this.#busy)throw new Error('reentrant owner mutation');this.#busy=true;}
  #time(wall){finite(wall);if(wall<this.#wall)throw new RangeError('wall time must be monotonic');return this.#logical+(this.#paused?0:wall-this.#wall);}
  #commitTime(wall,logical){this.#wall=wall;this.#logical=logical;}
  #steps(n){if(!Number.isInteger(n)||n<1||n>4096)throw new RangeError('maxSteps bounds');}
  #core(fn){try{return fn();}catch(error){this.#stop('faulted','core');throw error;}}
  #cancel(){
    this.#ticket++;const s=this.#scheduler,frame=this.#frame,timer=this.#timer;this.#frame=this.#timer=null;
    let error;try{if(frame!==null)s.cancelFrame(frame);}catch(e){error=e;}
    try{if(timer!==null)s.clearTimer(timer);}catch(e){error??=e;}
    if(error)throw error;
  }
  #stop(status,kind){
    if(this.#status==='closed'||this.#status==='faulted')return;
    this.#status=status;this.#fault=kind?Object.freeze({kind}):null;this.#epoch++;
    this.#abort.abort(stopped());
    // Clear every owned reference even if one cleanup callback fails.
    try{this.#cancel();}catch{}finally{for(const clean of this.#cleanups.splice(0)){try{clean();}catch{}}const actor=this.#actor;this.#actor=null;this.#record=()=>{};this.#draw=()=>{};this.#pool=null;try{actor?.dispose();}finally{this.#scheduler=null;}}
  }
  #advance(logical,maxSteps){return this.#core(()=>this.#actor.advance(logical-this.#origin,maxSteps));}
  completeBatch(input,maxSteps=64){
    this.#enter();try{
      assertDataRecord(input,['wallTime','epoch','events'],'owner batch');
      const {wallTime,epoch,events}=input;
      if(epoch!==this.#epoch)return Object.freeze({accepted:false,reason:'stale-epoch'});
      if(this.#paused)throw new Error('Paused: ordinary intents require a current visible batch');
      this.#steps(maxSteps);const t=this.#time(wallTime);let high=this.#lifetime;
      // Director validates the complete data record before any queue mutation.
      // Global watermark must survive retired director instances.
      assertDenseDataArray(events,1,32,'events');
      for(const e of events){const d=e&&typeof e==='object'?Object.getOwnPropertyDescriptors(e):{};
        if(d.type?.value==='request'){const n=d.lifetime?.value;if(!Number.isSafeInteger(n)||n<=high)throw new RangeError('global lifetime must increase');high=n;}}
      this.#actor.submit({time:t-this.#origin,events});
      this.#lifetime=high;this.#commitTime(wallTime,t);
      const changed=this.#advance(t,maxSteps);return Object.freeze({accepted:true,changed,progress:this.#actor.progress});
    }finally{this.#busy=false;}
  }
  advance(wallTime,maxSteps=64){
    this.#enter();try{this.#steps(maxSteps);const t=this.#time(wallTime);this.#commitTime(wallTime,t);if(this.#paused)return false;return this.#advance(t,maxSteps);}finally{this.#busy=false;}
  }
  #retire(){
    this.#core(()=>this.#cancel());this.#epoch++;this.#origin=this.#logical;
    if(!this.#actor.observerStatus.enabled){this.#observerStopped??=this.#actor.observerStatus;this.#record=()=>{};}
    this.#core(()=>this.#actor.retire());
  }
  suspend(wallTime){
    this.#enter();try{const t=this.#time(wallTime);this.#commitTime(wallTime,t);if(this.#paused)return;
      this.#paused=true;this.#core(()=>this.#cancel());
      if(this.#actor.hasInteraction)this.#retire();
      // No advance at the boundary: host must submit any same-time batch first.
    }finally{this.#busy=false;}
  }
  invalidate(epoch){
    this.#enter();try{if(epoch!==this.#epoch)return false;if(!this.#paused)throw new Error('Visible release must use completeBatch');this.#retire();return true;}finally{this.#busy=false;}
  }
  resume(wallTime){
    let resumed=false;this.#enter();try{const t=this.#time(wallTime);this.#commitTime(wallTime,t);if(!this.#paused)return;this.#paused=false;resumed=true;}finally{this.#busy=false;if(resumed)this.wake();}
  }
  assertCurrent(){this.#enter();try{return this.#core(()=>this.#actor.assertCurrent());}finally{this.#busy=false;}}
  /** Optional browser lifecycle wiring. CPU EventTarget tests do not certify WebGL.
   * now must be the same monotonic seconds source used for input and scheduler. */
  bindLifecycle({canvas,visibilityTarget,now}) {
    this.#enter();try{
      if(this.#cleanups.length)throw new Error('Lifecycle already bound');
      if(typeof now!=='function')throw new TypeError('lifecycle now');
      for(const target of [canvas,visibilityTarget])for(const key of ['addEventListener','removeEventListener'])if(typeof target?.[key]!=='function')throw new TypeError('lifecycle target');
      let lost=false;
      const sync=()=>{
        if(this.#status!=='ready')return;
        try{if(lost||visibilityTarget.hidden)this.suspend(now());else this.resume(now());}
        catch{this.#stop('faulted','lifecycle');}
      };
      const onLost=e=>{e.preventDefault();lost=true;sync();};
      const onRestored=()=>{lost=false;sync();};
      for(const [target,type,fn] of [[canvas,'webglcontextlost',onLost],[canvas,'webglcontextrestored',onRestored],[visibilityTarget,'visibilitychange',sync]]) {
        target.addEventListener(type,fn);this.#cleanups.push(()=>target.removeEventListener(type,fn));
      }
      // Finish the mutation guard before the initial synchronous lifecycle update.
      this.#busy=false;sync();
    }finally{this.#busy=false;}
  }
  /** Optional demand scheduler. The host commits input batches before waking it.
   * All callbacks are generation guarded, including callbacks already dequeued. */
  wake(){
    this.#live();if(this.#busy)throw new Error('reentrant owner mutation');
    if(this.#paused||!this.#scheduler||this.#frame!==null)return;
    if(this.#timer!==null){this.#ticket++;const timer=this.#timer;this.#timer=null;this.#core(()=>this.#scheduler.clearTimer(timer));}
    const ticket=this.#ticket;
    this.#frame=this.#core(()=>this.#scheduler.requestFrame(()=>{
      if(ticket!==this.#ticket||this.#status!=='ready'||this.#paused)return;
      this.#frame=null;
      try{
        this.advance(this.#scheduler.now());
        this.#busy=true;try{this.#draw();}finally{this.#busy=false;}
        if(this.#actor.isAnimating()){this.wake();return;}
        const due=this.#actor.nextDeadline()+this.#origin;
        if(Number.isFinite(due))this.#timer=this.#scheduler.setTimer(()=>{if(ticket!==this.#ticket||this.#status!=='ready'||this.#paused)return;this.#timer=null;this.wake();},Math.max(0,(due-this.#logical)*1000));
      }catch(error){this.#stop('faulted','scheduled');}
    }));
  }
  dispose(){if(this.#busy)throw new Error('reentrant owner mutation');this.#stop('closed',null);}
}
