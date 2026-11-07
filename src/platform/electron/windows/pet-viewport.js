'use strict';
const { planOpen } = require('../pet-menu-expansion');
const { createPresentationViewTracker } = require('../../../core/pet-presentation-view.mjs');
const { readInputLeaseRequest } = require('../../../core/pet-input-lease.mjs');
const { createPetInputLease } = require('./pet-input-lease');
const { createPetInputDocument } = require('./pet-input-document');
const { createPetFixtureTransport } = require('./pet-fixture-transport');
const { readActiveFixtureIsolation } = require('../dev/fixture-isolation');
const { FIXTURE_TRANSPORT_SCOPE } = require('../../../core/pet-fixture-transport.mjs');

// Windows and macOS transparent surfaces keep a stable backing store across menu toggles.
// Public bounds remain the 220 DIP pet anchor, including persisted positions.
function createPetViewport({ bounds, screen, readPointerSpace = null, selectedPage = null,
  onDeliveryError = () => {}, now, newEpoch, readFixtureActive = readActiveFixtureIsolation, size = { w: 520, h: 360 }, interval = setInterval, cancelInterval = clearInterval }) {
  let anchor = { ...bounds };
  const views = createPresentationViewTracker();
  const fixtureAuthority = Object.freeze({});
  const lease = readPointerSpace && selectedPage ? createPetInputLease({ now, newEpoch, fixtureAuthority }) : null;
  let expanded = false, native = null, document = null, ignored = null, timer = null;
  let hidden = false, nativeUnknown = false, lastPublishedEpoch = null, fixturePortInstalled = false;
  function report(error) {
    try { onDeliveryError(error, { channel: 'pet:input-lease', reason: 'native-state-unknown' }); } catch { /* Reporting is best effort. */ }
  }
  function nativeError(error) {
    ignored = null;
    if (!nativeUnknown) { lease?.fail(); report(error); }
    nativeUnknown = true;
  }
  function layout(logical = anchor) {
    const center = { x: Math.round(logical.x + logical.width / 2), y: Math.round(logical.y + logical.height / 2) };
    return planOpen({ bounds: logical, size, workArea: screen.getDisplayNearestPoint(center).workArea });
  }
  function visible() { return !hidden && (typeof native?.isVisible !== 'function' || native.isVisible()); }
  function ready() { return Boolean(document?.isReady() && visible()); }
  function fixtureActive() {
    try { return Boolean(lease && readFixtureActive()); } catch { return false; }
  }
  function geometry(observeLease = true) {
    const plan = layout();
    let viewport = native ? native.getBounds() : plan.bounds;
    let content = null, stableNativeRead = false;
    if (native && readPointerSpace) {
      const before = { ...viewport };
      try { content = native.getContentBounds(); } catch { /* Never guess content from backing. */ }
      viewport = native.getBounds();
      stableNativeRead = ['x', 'y', 'width', 'height'].every(key => before[key] === viewport[key]);
    }
    const value = { side: plan.side, width: viewport.width, height: viewport.height,
      ...(readPointerSpace ? { pointerSpace: readPointerSpace() } : {}),
      stageOffset: { x: anchor.x + anchor.width / 2 - viewport.x - viewport.width / 2,
        y: anchor.y + anchor.height / 2 - viewport.y - viewport.height / 2 } };
    if (readPointerSpace) value.presentationView = views.record({ logicalAnchor: anchor,
      backingBounds: native ? viewport : null, contentBounds: content, stableNativeRead,
      geometry: { width: value.width, height: value.height, stageOffset: value.stageOffset } });
    if (fixturePortInstalled && fixtureActive() && ready()) value.fixtureTransport = Object.freeze({ schemaVersion: 1, scope: FIXTURE_TRANSPORT_SCOPE, available: true });
    if (lease && observeLease) value.inputLease = lease.observe(value.presentationView, value.pointerSpace, ready() && !nativeUnknown);
    return value;
  }
  function deliver(value) {
    if (!native || native.isDestroyed() || native.webContents.isDestroyed?.()) return false;
    try {
      native.webContents.send('pet:viewport', value);
      lastPublishedEpoch = value.inputLease?.epoch ?? null;
      return true;
    } catch (error) { report(error); return false; }
  }
  function writeIgnored(value) {
    if (ignored === value) return true;
    try {
      native.setIgnoreMouseEvents(value, { forward: true });
      // This caches an API return, not independent readback of the OS flag.
      ignored = value; nativeUnknown = false; return true;
    } catch (error) { nativeError(error); return false; }
  }
  function hitTest() {
    if (!native) return false;
    try {
      if (native.isDestroyed()) return false;
      const value = lease ? geometry() : null;
      const cursor = screen.getCursorScreenPoint();
      const area = expanded ? native.getBounds() : anchor;
      const outside = cursor.x < area.x || cursor.y < area.y || cursor.x >= area.x + area.width || cursor.y >= area.y + area.height;
      const ignore = lease ? (!ready() || nativeUnknown || !value.presentationView.available ? true : lease.isActive() ? false : outside) : outside;
      const success = writeIgnored(ignore);
      // A successful recovery must first restore pass-through, then issue a
      // fresh capability. A failed write never leaves a cached success/grant.
      if (lease) {
        value.inputLease = lease.observe(value.presentationView, value.pointerSpace, ready() && !nativeUnknown);
        if (value.inputLease.epoch !== lastPublishedEpoch) deliver(value);
      }
      return success;
    } catch (error) {
      nativeError(error);
      // Geometry/cursor failures must not leave a previously interactive dead
      // anchor as the intentional policy. The OS outcome remains unverified.
      try { native.setIgnoreMouseEvents(true, { forward: true }); } catch { /* Unknown native state. */ }
      return false;
    }
  }
  function publish() {
    if (native && !native.isDestroyed()) {
      const value = geometry(); deliver(value); return value;
    }
    return null;
  }
  function revoke() { lease?.revoke(); ignored = null; }
  function applyInputLease(event, value) {
    const request = readInputLeaseRequest(value);
    let reason = null, result = null;
    try {
      // Re-read native bounds and source context even when publication has not
      // caught up. A queued command cannot renew a last-published stale view.
      const observation = geometry();
      if (!request) reason = 'invalid-request';
      else if (!ready() || event?.sender !== native.webContents || event?.senderFrame !== native.webContents.mainFrame) reason = 'foreign-document';
      else result = lease.apply(request);
      const success = hitTest();
      if (!success) reason = 'native-state-unknown';
      else if (result?.ok && request.phase !== 'end' && result.capability.epoch !== lease.capability().epoch) reason = 'context-changed';
      if (observation.inputLease.epoch !== lastPublishedEpoch) publish();
    } catch (error) { nativeError(error); reason = 'native-state-unknown'; }
    return Object.freeze({ ok: !reason && Boolean(result?.ok), request,
      capability: lease.capability(), reason: reason || result?.reason || null });
  }
  function move(x, y) {
    const nextAnchor = { ...anchor, x, y };
    const plan = layout(nextAnchor);
    const current = native.getBounds();
    // Only moving to a display too small for the backing store can resize it.
    // Opening/closing a menu never takes this path.
    if (current.width !== plan.bounds.width || current.height !== plan.bounds.height) native.setBounds(plan.bounds, false);
    else native.setPosition(plan.bounds.x, plan.bounds.y, false);
    // Commit logical intent only after the native command returns. A throw can
    // still have moved the OS window: readPresentationView observes that fact,
    // and no implicit rollback/retry is issued here.
    anchor = nextAnchor;
    const published = publish(); hitTest();
    return readPointerSpace ? Object.freeze({ requestedLogicalAnchor: Object.freeze({ ...nextAnchor }),
      view: published?.presentationView ?? null }) : undefined;
  }
  // Unified resume path (unlock-screen, resume, display change, show). Native
  // pass-through is not trusted after the OS took the screen.
  function resync(reason = 'resync') {
    if (!native || native.isDestroyed()) return false;
    try {
      const isVisible = typeof native.isVisible === 'function' ? native.isVisible() : true;
      if (isVisible) hidden = false;
      if (isVisible && timer === null) timer = interval(hitTest, 24);
      native.setAlwaysOnTop?.(true, 'floating');
      native.setVisibleOnAllWorkspaces?.(true, { visibleOnFullScreen: false });
      // A late native show must not fight the OS position nudge after showInactive.
      const plan = layout(), current = native.getBounds();
      const sized = current.width !== plan.bounds.width || current.height !== plan.bounds.height;
      const moved = current.x !== plan.bounds.x || current.y !== plan.bounds.y;
      if (sized || (moved && reason !== 'show')) native.setBounds(plan.bounds, false);
      revoke();
      publish(); return hitTest();
    } catch (error) { nativeError(error); return false; }
  }
  return {
    initialBounds: layout().bounds,
    attach(window) {
      native = window;
      if (lease) {
        document = createPetInputDocument({ window, selectedPage,
          onInvalidate: () => { revoke(); hitTest(); },
          onReady: newDocument => { if (newDocument) lease.revoke({ newDocument }); publish(); hitTest(); } });
        native.on('blur', () => { revoke(); hitTest(); });
        hitTest();
      } else native.webContents.on('did-finish-load', publish);
      native.webContents.on('input-event', hitTest);
      native.on('show', () => resync('show'));
      native.on('hide', () => { hidden = true; revoke(); hitTest(); if (timer !== null) cancelInterval(timer); timer = null; });
      native.on('closed', () => { revoke(); if (timer !== null) cancelInterval(timer); timer = null; native = null; });
      if (!fixtureActive()) return null;
      fixturePortInstalled = true;
      const fixtureDocument = document;
      return createPetFixtureTransport({ isActive: fixtureActive,
        captureDocument: () => native === window && document === fixtureDocument && ready() ? fixtureDocument.capture() : null,
        observe: geometry, observeRaw: () => geometry(false),
        leaseSnapshot: () => lease.fixtureSnapshot(fixtureAuthority),
        migrateLease: (expected, value) => lease.migrateFixture(fixtureAuthority, expected,
          value.presentationView, value.pointerSpace, ready() && fixtureActive() && !nativeUnknown),
        moveNative: (x, y) => window.setPosition(x, y, false),
        commitAnchor: value => { anchor = { ...value }; },
        publish: (value, receipt = null) => {
          value.inputLease = lease.observe(value.presentationView, value.pointerSpace, ready() && !nativeUnknown);
          if (receipt) value.fixtureTranslation = receipt;
          return deliver(value);
        },
        revoke, displayAt: point => screen.getDisplayNearestPoint(point) });
    },
    getBounds: () => ({ ...anchor }),
    readPresentationView: () => readPointerSpace ? geometry().presentationView : null,
    ...(lease ? { applyInputLease } : {}),
    setPosition: move,
    setBounds: next => move(next.x ?? anchor.x, next.y ?? anchor.y),
    setMenuOpen(open) { expanded = Boolean(open); hitTest(); return geometry(); },
    resync
  };
}
module.exports = { createPetViewport };
