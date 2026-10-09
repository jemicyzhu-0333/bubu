// Compatibility for existing focusRing-only senders; canonical sessionDisplay
// suppresses this legacy presentation, not its public projection.
function createLegacyFocusRing({ document, now }) {
let ringAnchor = null;
function ringElapsedNow(anchor) {
  return anchor.elapsedMs + (anchor.running ? now() - anchor.receivedAt : 0);
}
function setFocusRing(ring) {
  const stage = document.getElementById('stage');
  const arc = document.querySelector('#focusRing .ring-arc');
  if (!stage || !arc) return;
  if (!ring || !(ring.plannedMs > 0)) {
    ringAnchor = null;
    delete stage.dataset.ring;
    return;
  }
  const previous = ringAnchor;
  const unchanged = previous && previous.sessionId === ring.sessionId && previous.plannedMs === ring.plannedMs
    && previous.running === ring.running && previous.mode === ring.mode
    && Math.abs(ringElapsedNow(previous) - ring.elapsedMs) < 2000;
  if (unchanged) return;
  ringAnchor = { ...ring, receivedAt: now() };
  stage.dataset.ring = ring.mode === 'break' ? 'break' : 'focus';
  arc.style.animation = 'none';
  void arc.getBoundingClientRect();
  arc.style.setProperty('--ring-total', `${ring.plannedMs}ms`);
  arc.style.setProperty('--ring-delay', `${-ring.elapsedMs}ms`);
  arc.style.setProperty('--ring-steps', String(Math.max(1, Math.ceil(ring.plannedMs / 30000))));
  arc.style.setProperty('--ring-state', ring.running ? 'running' : 'paused');
  arc.style.animation = '';
}

  return Object.freeze({ sync: setFocusRing, clear: () => setFocusRing(null) });
}
export { createLegacyFocusRing };
