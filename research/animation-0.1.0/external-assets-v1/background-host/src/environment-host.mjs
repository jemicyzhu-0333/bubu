const stamp = p => JSON.stringify([p.policyVersion,p.base?.sessionId,p.base?.selectionToken,p.planGeneration,p.validityGeneration]);
const release = leases => leases.forEach(l => l.release());

/** Consumes the EXISTING SceneCoordinator's plan(now). Does not choose backgrounds or recreate TTL policy.
 * Surface is environment-only: commit(resources, descriptors) and clear(). Both synchronous/atomic.
 * clock() is trusted UTC milliseconds, never an animation-loop clock.
 */
export function createEnvironmentHost({plan, clock, descriptors, pool, surface}) {
  let active = [], activeStamp = null, pending = null, epoch = 0, closed = false, suspended = false;
  let status = {kind:'environment_host',state:'empty',performing:false,visible:false};
  function cancelPending() {
    epoch++;
    if (pending) { release(pending.leases); pending = null; }
  }
  function clear() { surface.clear(); release(active); active = []; activeStamp = null; }
  async function reconcile() {
    if (closed) return {state:'disposed',performing:false,visible:false};
    if (suspended) return status;
    let requested;
    try { requested = plan(clock()); }
    catch (error) {
      cancelPending(); clear();
      return status = {state:'blocked',reason:'plan-unavailable',detail:String(error.message),performing:false,visible:false};
    }
    const token = stamp(requested);
    if (pending?.token === token) return pending.promise;
    if (activeStamp === token) return status;
    cancelPending();
    const mine = epoch;
    const ids = requested.base?.selectedId ? [requested.base.selectedId,...requested.overlays] : [];
    if (!ids.length) {
      clear();
      return status = {state:'empty',performing:false,visible:false,selectionToken:requested.base?.selectionToken};
    }
    const selected = ids.map(id => descriptors[id]);
    if (selected.some(d => !d)) {
      clear();
      return status = {state:'blocked',reason:'unknown-descriptor',performing:false,visible:false,selectionToken:requested.base.selectionToken};
    }
    const leases = [];
    try { for (const descriptor of selected) leases.push(pool.acquire(descriptor)); }
    catch (error) {
      release(leases); clear();
      return status = {state:'blocked',reason:'acquire-failed',detail:String(error.message),performing:false,visible:false};
    }
    // Acquire before releasing the old display so unchanged resources retain their lease.
    // Clear stale display before awaiting load, so expired overlays do not survive refresh.
    clear();
    status = {state:'preparing',performing:false,visible:false,selectionToken:requested.base.selectionToken};
    pending = {leases,token,promise:null};
    pending.promise = prepare();
    return pending.promise;

    async function prepare() {
      try {
        const resources = await Promise.all(leases.map(l => l.ready));
        if (closed || suspended || mine !== epoch) { release(leases); return {state:'stale',performing:false,visible:false}; }
        const current = plan(clock());
        if (stamp(current) !== token) {
          release(leases); pending = null;
          return status = {state:'stale',reason:'plan-changed-before-commit',performing:false,visible:false};
        }
        surface.commit(resources, selected);
        active = leases; activeStamp = token; pending = null;
        // An attached environment is not evidence of a rendered frame or performed action.
        return status = {state:'attached',performing:false,visible:false,frameVerified:false,
          selectionToken:current.base.selectionToken,planGeneration:current.planGeneration,validityGeneration:current.validityGeneration,ids};
      } catch (error) {
        release(leases);
        if (mine !== epoch || closed || suspended) return {state:'stale',performing:false,visible:false};
        pending = null;
        return status = {state:'blocked',reason:'environment-prepare-or-commit-failed',detail:String(error.message),
          selectionToken:requested.base.selectionToken,performing:false,visible:false};
      }
    }
  }
  return Object.freeze({reconcile, snapshot:() => structuredClone(status),
    cancel() { if (closed) return; cancelPending(); clear(); status={state:'cancelled',performing:false,visible:false}; },
    suspend() { if (closed) return; suspended=true; cancelPending(); clear(); status={state:'suspended',performing:false,visible:false}; },
    resume() { if (closed) return Promise.resolve({state:'disposed'}); suspended=false; return reconcile(); },
    dispose() { if (closed) return; closed=true; cancelPending(); clear(); status={state:'disposed',performing:false,visible:false}; }
  });
}
