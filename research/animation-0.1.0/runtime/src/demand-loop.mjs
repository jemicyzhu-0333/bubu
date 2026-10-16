/** Scheduler is injectable for deterministic tests. No RAF while idle and no active future timer unless needed. */
export class DemandLoop {
  constructor({
    runtime, draw, now, requestFrame, cancelFrame, setTimer, clearTimer
  }) {
    Object.assign(this, {
      runtime, draw, now, requestFrame, cancelFrame, setTimer, clearTimer
    });
    this.frame=null;
    this.timer=null;
    this.stopped=false;
    this.paused=false;
    this.stats= {
      frames:0, draws:0, timers:0
    };
    this.run=()=> {
      this.frame=null;
      if(this.stopped||this.paused)return;
      const t=this.now();
      const changed=this.runtime.advance(t);
      this.stats.frames++;
      const dirty=this.dirty;
      this.dirty=false;
      if(changed||dirty) {
        this.draw();
        this.stats.draws++;
      }
      if(this.stopped||this.paused||this.frame!==null)return;
      if(this.runtime.isAnimating(t))this.frame=this.requestFrame(this.run);
      else {
        const due=this.runtime.nextDeadline();
        if(Number.isFinite(due)) {
          this.stats.timers++;
          this.timer=this.setTimer(()=> {
            this.timer=null;
            this.invalidate();
          }, Math.max(0, (due-t)*1000));
        }
      }
    };
  }
  invalidate() {
    if(this.stopped)return;
    this.dirty=true;
    if(this.paused)return;
    if(this.timer!==null) {
      this.clearTimer(this.timer);
      this.timer=null;
    }
    if(this.frame===null)this.frame=this.requestFrame(this.run);
  }
  pause() {
    if(this.stopped||this.paused)return;
    this.paused=true;
    if(this.frame!==null)this.cancelFrame(this.frame);
    if(this.timer!==null)this.clearTimer(this.timer);
    this.frame=this.timer=null;
  }
  resume() {
    if(this.stopped||!this.paused)return;
    this.paused=false;
    this.invalidate();
  }
  dispose() {
    if(this.stopped)return;
    this.stopped=true;
    if(this.frame!==null)this.cancelFrame(this.frame);
    if(this.timer!==null)this.clearTimer(this.timer);
    this.frame=this.timer=null;
  }
}
