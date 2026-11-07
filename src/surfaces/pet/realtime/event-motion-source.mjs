const finite = value => Number.isFinite(value) && Math.abs(value) <= 100000;
const RUNTIME = { platform: 'win32', electron: '44.10.1', chromium: '152.0.7977.169' };
const closed = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype
  && Object.keys(value).every(key => keys.includes(key));
function readSpace(value) {
  if (!closed(value, ['schemaVersion', 'revision', 'kind', 'reason', 'runtime', 'bounds', 'scaleFactor']) || value.schemaVersion !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 1) return null;
  if (value.kind === 'client' && closed(value, ['schemaVersion', 'revision', 'kind', 'reason'])) return { schemaVersion: 1, kind: 'client', revision: value.revision,
    reason: ['runtime-unverified', 'display-topology-unverified', 'display-context-unavailable'].includes(value.reason) ? value.reason : 'unspecified' };
  const b = value.bounds;
  if (!closed(value, ['schemaVersion', 'revision', 'kind', 'runtime', 'bounds', 'scaleFactor']) || value.kind !== 'event-screen-dip' || !closed(value.runtime, Object.keys(RUNTIME)) || Object.keys(RUNTIME).some(key => value.runtime[key] !== RUNTIME[key])
      || !closed(b, ['x', 'y', 'width', 'height']) || !['x', 'y', 'width', 'height'].every(key => Number.isSafeInteger(b[key]) && finite(b[key]))
      || b.width <= 0 || b.height <= 0 || !Number.isFinite(value.scaleFactor) || value.scaleFactor < .5 || value.scaleFactor > 4) return null;
  return { schemaVersion: 1, kind: value.kind, revision: value.revision, runtime: { ...RUNTIME },
    bounds: { x: b.x, y: b.y, width: b.width, height: b.height }, scaleFactor: value.scaleFactor };
}
/** One delivered DOM event supplies both contact and motion. No current cursor,
 * FIFO join, DPR arithmetic, window.screen position or claim of hardware origin.
 * The caller must cancel the sole actor before applying a changed space.
 */
export function createEventMotionSource({ document, target }) {
  let space = null, notBefore = 0, total = 0, rejected = 0, activated = false, revoked = false;
  let viewAvailable = true, viewBarrier = false;
  const rows = [];
  function audit(event, motion, reason) {
    total++; if (reason) rejected++;
    if (rows.length === 32) rows.shift();
    rows.push({ sequence: total, type: ['pointerdown', 'pointermove', 'pointerup'].includes(event.type) ? event.type : 'other',
      atMs: Number.isFinite(event.timeStamp) ? event.timeStamp : null,
      pointerId: Number.isSafeInteger(event.pointerId) ? event.pointerId : null,
      trusted: event.isTrusted === true, source: revoked ? 'revoked' : space?.kind ?? 'client', revision: space?.revision ?? null,
      domCaptured: Number.isSafeInteger(event.pointerId) ? target.hasPointerCapture(event.pointerId) : false,
      client: finite(event.clientX) && finite(event.clientY) ? { x: event.clientX, y: event.clientY } : null,
      motion: motion ? { ...motion } : null, reason });
  }
  return Object.freeze({
    setSpace(value, receivedAtMs, cancelContact) {
      const next = readSpace(value);
      if (next && space && next.revision < space.revision) return false;
      if (JSON.stringify(next) === JSON.stringify(space)) return false;
      // Cancel pending/captured work before changing reference space. Missing or
      // malformed context cannot mix client coordinates into an old screen gesture.
      cancelContact();
      if (activated) revoked = true;
      space = next;
      if (next?.kind === 'event-screen-dip') { activated = true; if (document.pointerLockElement !== null) revoked = true; }
      notBefore = Number.isFinite(receivedAtMs) && receivedAtMs >= 0 ? Math.max(notBefore, receivedAtMs) : Infinity;
      return true;
    },
    observeView(receivedAtMs, available, cancelContact) {
      cancelContact(); viewAvailable = available === true; viewBarrier = true;
      notBefore = Number.isFinite(receivedAtMs) && receivedAtMs >= 0 ? Math.max(notBefore, receivedAtMs) : Infinity;
    },
    revoke(cancelContact) {
      if (!activated || revoked) return false;
      cancelContact(); revoked = true; return true;
    },
    read(event) {
      let reason = null, motion = null;
      if (revoked) reason = 'revoked-space';
      else if (!viewAvailable) reason = 'view-unavailable';
      else if (viewBarrier && (!Number.isFinite(event.timeStamp) || event.timeStamp < notBefore)) reason = 'prior-view-event';
      else if (space?.kind !== 'event-screen-dip') motion = { x: event.clientX, y: event.clientY };
      else {
        const b = space.bounds;
        if (document.pointerLockElement !== null) { revoked = true; reason = 'pointer-lock'; }
        else if (event.isTrusted !== true || event.pointerType !== 'mouse' || event.isPrimary !== true
          || !['pointerdown', 'pointermove', 'pointerup'].includes(event.type)) reason = 'event-route-unverified';
        else if (!Number.isFinite(event.timeStamp) || event.timeStamp < notBefore) reason = 'prior-space-event';
        else if (!finite(event.screenX) || !finite(event.screenY) || event.screenX < b.x || event.screenY < b.y
          || event.screenX >= b.x + b.width || event.screenY >= b.y + b.height) reason = 'screen-point-outside-space';
        else motion = { x: event.screenX, y: event.screenY };
      }
      audit(event, motion, reason); return motion;
    },
    snapshot: () => ({ scope: 'same-delivered-DOM-event-not-OS-provenance', mode: revoked ? 'revoked' : space?.kind ?? 'client',
      revision: space?.revision ?? null, viewAvailable, capability: space ? structuredClone(space) : null, total, rejected, dropped: Math.max(0, total - rows.length), rows: structuredClone(rows) })
  });
}
