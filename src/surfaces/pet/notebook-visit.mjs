// Presentation-only visit. The platform host owns travel coordinates; this
// module owns portal visuals and delegates the pen, paper and limbs to the rig.
function createNotebookVisit({ document, startAction, stopAction, calm, setInterval, clearInterval, setTimeout, clearTimeout }) {
  const stage = document.querySelector('#stage');
  let repeat = null;
  let timer = null;
  let active = false;
  let disposed = false;
  let generation = 0;
  const portal = document.createElement('div');
  portal.className = 'notebook-portal'; portal.setAttribute('aria-hidden', 'true');
  stage?.appendChild(portal);
  function clearTimers() {
    if (repeat !== null) clearInterval(repeat);
    if (timer !== null) clearTimeout(timer);
    repeat = timer = null;
  }
  function current(owner) { return !disposed && active && owner === generation; }
  function pose(owner) { if (current(owner)) startAction('take-note', '', { speak: false }); }
  function ready(owner) {
    pose(owner);
    if (current(owner)) repeat = setInterval(() => pose(owner), 9000);
  }
  function handle(cue) {
    if (disposed || !cue || !Number.isFinite(cue.at) || !cue.id?.startsWith('system.notebook-')) return false;
    const phase = cue.id.slice('system.notebook-'.length);
    if (!['depart', 'arrive', 'ready', 'saved', 'completed', 'step', 'reset'].includes(phase)) return false;
    const owner = ++generation;
    clearTimers();
    if (phase === 'reset') { active = false; stopAction(); delete document.body.dataset.notebook; return true; }
    active = true;
    document.body.dataset.notebook = phase;
    if (phase === 'ready') {
      ready(owner);
    }
    if (['saved', 'completed', 'step'].includes(phase)) {
      startAction(phase === 'completed' ? 'dance' : 'take-note', phase === 'completed' ? '完成啦！' : phase === 'saved' ? '记好了。' : '又完成一步。');
      if (current(owner)) timer = setTimeout(() => {
        if (!current(owner)) return;
        timer = null;
        document.body.dataset.notebook = 'ready';
        ready(owner);
      }, calm() ? 500 : 1300);
    }
    return true;
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    generation += 1;
    const wasActive = active;
    active = false;
    clearTimers();
    document.defaultView?.removeEventListener('pagehide', dispose);
    portal.remove?.();
    delete document.body.dataset.notebook;
    if (wasActive) stopAction();
  }
  document.defaultView?.addEventListener('pagehide', dispose, { once: true });
  return { handle, dispose };
}
export { createNotebookVisit };
