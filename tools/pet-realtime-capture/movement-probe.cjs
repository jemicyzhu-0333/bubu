'use strict';
const same = (a, b) => ['x', 'y', 'width', 'height'].every(key => a[key] === b[key]);
function bounds(value) {
  if (!value || !['x', 'y', 'width', 'height'].every(key => Number.isSafeInteger(value[key]) && Math.abs(value[key]) <= 1000000)
      || value.width <= 0 || value.height <= 0) throw new Error('movement-bounds-invalid');
  return Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, value[key]]));
}
function targetFor(origin, workArea) {
  const area = bounds(workArea);
  const fits = point => point.x >= area.x && point.y >= area.y
    && point.x + origin.width <= area.x + area.width && point.y + origin.height <= area.y + area.height;
  if (!fits(origin)) throw new Error('movement-origin-outside-work-area');
  for (const [dx, dy] of [[24, 16], [-24, 16], [24, -16], [-24, -16], [24, 0], [-24, 0], [0, 16], [0, -16]]) {
    const point = { ...origin, x: origin.x + dx, y: origin.y + dy };
    if (fits(point)) return point;
  }
  throw new Error('movement-safe-target-unavailable');
}

/** Fixed fixture-only round trip. A readback is not OS input, compositor acknowledgement or actor motion. */
async function probeOwnedMovement({ assertCurrent, readNative, readWorkArea, move, readRenderer, delay, identity }) {
  const result = { schemaVersion: 1, ...identity, status: 'not-started',
    semantics: 'native-bounds-readback-and-independent-renderer-observation',
    eventMatched: false, compositorAcknowledged: false, actorMotionConnected: false,
    receipts: [], restoration: { attempted: false, confirmed: false } };
  let origin = null, attempted = false;
  try {
    assertCurrent();
    const before = await readRenderer(); assertCurrent();
    if (!before.ready || before.closed || before.paused !== true || before.pointerId !== null
        || before.captured !== false || before.domPointerCapture !== false || before.pendingCount !== 0) throw new Error('movement-renderer-not-quiescent');
    origin = bounds(readNative()); const requested = targetFor(origin, readWorkArea(origin));
    const receipt = { sequence: 1, requested, before: origin, afterCommand: null, afterDelay: null, renderer: null, afterRenderer: null };
    result.receipts.push(receipt);
    assertCurrent(); attempted = true; move(requested.x, requested.y);
    receipt.afterCommand = bounds(readNative());
    await delay(100); assertCurrent(); receipt.afterDelay = bounds(readNative());
    receipt.renderer = await readRenderer(); assertCurrent();
    if (receipt.renderer.closed || receipt.renderer.paused !== true || receipt.renderer.pointerId !== null
        || receipt.renderer.captured !== false || receipt.renderer.domPointerCapture !== false || receipt.renderer.pendingCount !== 0)
      throw new Error('movement-renderer-not-quiescent');
    receipt.afterRenderer = bounds(readNative());
    receipt.sameBoundsAcrossRendererRead = same(receipt.afterDelay, receipt.afterRenderer);
    receipt.requestedBoundsObserved = same(requested, receipt.afterRenderer);
    receipt.actualDisplacement = { x: receipt.afterRenderer.x - origin.x, y: receipt.afterRenderer.y - origin.y };
    result.status = same(origin, receipt.afterRenderer) ? 'no-movement-observed' : 'movement-observed';
  } catch (error) {
    result.status = 'incomplete';
    result.error = ['movement-bounds-invalid', 'movement-origin-outside-work-area', 'movement-safe-target-unavailable',
      'movement-renderer-not-quiescent'].includes(error.message) ? error.message : 'movement-operation-failed-or-invalidated';
  } finally {
    if (attempted) {
      // Never restore through a closed, navigated, replaced or foreign owner. Abort may
      // permit this synchronous cleanup only; the caller separately enforces ownership.
      try {
        assertCurrent({ cleanup: true }); result.restoration.attempted = true;
        move(origin.x, origin.y); result.restoration.afterCommand = bounds(readNative());
        try { await delay(100); } catch { /* Preserve immediate readback on aborted cleanup. */ }
        assertCurrent({ cleanup: true }); result.restoration.actual = bounds(readNative());
        result.restoration.confirmed = same(origin, result.restoration.actual);
      } catch { result.restoration.error = 'movement-restoration-unverified'; }
    }
  }
  return result;
}
module.exports = { probeOwnedMovement, bounds, targetFor };
