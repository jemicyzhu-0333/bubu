/** Browser lifecycle policy, testable with EventTargets but not a GPU mock.
 * Canonical time keeps advancing during loss/hidden; resume samples current now.
 * No simulation catch-up or Three/GPU restoration success is implied.
 */
export class ContextLifecycle {
  constructor({canvas,visibilityTarget}) {
    this.canvas=canvas;
    this.visibilityTarget=visibilityTarget;
    this.hidden=Boolean(visibilityTarget.hidden);
    this.lost=false;
    this.disposed=false;
    this.loop=null;
    this.stats={losses:0,restores:0};
    this.onLost=event=>{
      if(this.disposed)return;
      event.preventDefault(); // Standard WebGL opt-in to restoration.
      if(!this.lost)this.stats.losses++;
      this.lost=true;
      this.sync();
    };
    this.onRestored=()=>{
      if(this.disposed||!this.lost)return;
      this.lost=false;
      this.stats.restores++;
      this.sync();
    };
    this.onVisibility=()=>{
      if(this.disposed)return;
      this.hidden=Boolean(visibilityTarget.hidden);
      this.sync();
    };
    canvas.addEventListener('webglcontextlost',this.onLost);
    canvas.addEventListener('webglcontextrestored',this.onRestored);
    visibilityTarget.addEventListener('visibilitychange',this.onVisibility);
  }
  bind(loop) {
    if(this.disposed)throw new Error('ContextLifecycle disposed');
    if(this.loop!==loop)this.loop?.pause();
    this.loop=loop;
    this.sync();
  }
  sync() {
    if(this.disposed||!this.loop)return;
    if(this.hidden||this.lost)this.loop.pause();
    else {
      this.loop.resume();
      // Explicit invalidation also handles an already-idle demand loop.
      this.loop.invalidate();
    }
  }
  dispose() {
    if(this.disposed)return;
    this.disposed=true;
    this.canvas.removeEventListener('webglcontextlost',this.onLost);
    this.canvas.removeEventListener('webglcontextrestored',this.onRestored);
    this.visibilityTarget.removeEventListener('visibilitychange',this.onVisibility);
    this.loop?.dispose();
    this.loop=null;
  }
}
