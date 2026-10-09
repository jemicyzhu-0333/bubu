'use strict';

const visits = new WeakMap();
// Temporary coordinates only: never write settings.petPosition. A drag is a
// newer user decision. Rapid reopen cancels timers and keeps the true origin.
function borrowPetForQuickPanel({ petWindow, display, panelBounds, settings = {},
  readRuntime = () => ({}), now = Date.now, schedule = setTimeout, cancel = clearTimeout } = {}) {
  if (!petWindow?.isAlive() || !petWindow.isVisible() || !display?.workArea) return null;
  const previous = visits.get(petWindow);
  const current = petWindow.getBounds();
  const oldTarget = previous?.target();
  const retainsOrigin = oldTarget && current.x === oldTarget.x && current.y === oldTarget.y;
  const original = retainsOrigin ? previous.original : current;
  previous?.cancel();
  const timers = new Set();
  let borrowed = retainsOrigin ? current : null, released = false;
  const calm = settings.motionMode === 'reduced' || settings.stimulationMode === 'low' || readRuntime().prefersReducedMotion;
  const interrupted = () => readRuntime().dragging || readRuntime().menuOpen;
  const send = id => petWindow.isAlive() && petWindow.send('pet:sync', { cue: { id: 'system.notebook-' + id, at: now() } });
  const later = (fn, ms) => { const timer = schedule(() => { timers.delete(timer); fn(); }, ms); timers.add(timer); };
  const unchanged = bounds => {
    const current = petWindow.getBounds();
    return current.x === bounds.x && current.y === bounds.y;
  };
  const cancelVisit = () => { for (const timer of timers) cancel(timer); timers.clear(); send('reset'); };
  const record = { original, cancel: cancelVisit, target: () => borrowed };
  visits.set(petWindow, record);
  if (calm || !panelBounds) send('ready');
  else {
    const area = display.workArea;
    const target = {
      x: Math.round(Math.max(area.x, Math.min(area.x + area.width - original.width, panelBounds.x + panelBounds.width - 30))),
      y: Math.round(Math.max(area.y, Math.min(area.y + area.height - original.height, panelBounds.y - 30)))
    };
    const departure = petWindow.getBounds();
    send('depart');
    later(() => {
      if (released || !petWindow.isAlive() || interrupted() || !unchanged(departure)) { send('reset'); return; }
      petWindow.setPosition(target.x, target.y, false);
      borrowed = target;
      send('arrive');
      later(() => { if (!released) send('ready'); }, 380);
    }, 280);
  }
  function release() {
    if (released) return;
    released = true;
    for (const timer of timers) cancel(timer);
    timers.clear();
    if (!borrowed || !petWindow.isAlive() || interrupted() || !unchanged(borrowed)) {
      send('reset');
      if (visits.get(petWindow) === record) visits.delete(petWindow);
      return;
    }
    send('depart');
    later(() => {
      if (petWindow.isAlive() && !interrupted() && unchanged(borrowed)) { petWindow.setPosition(original.x, original.y, false); send('arrive'); }
      later(() => { send('reset'); if (visits.get(petWindow) === record) visits.delete(petWindow); }, 380);
    }, 280);
  }
  release.feedback = kind => { if (!released && ['saved', 'completed', 'step'].includes(kind)) send(kind); };
  return release;
}
module.exports = { borrowPetForQuickPanel };
