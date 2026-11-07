'use strict';
const { planOpen } = require('../pet-menu-expansion');
const { createPresentationViewTracker } = require('../../../core/pet-presentation-view.mjs');

// Windows and macOS transparent surfaces keep a stable backing store across menu toggles.
// Public bounds remain the 220 DIP pet anchor, including persisted positions.
function createPetViewport({ bounds, screen, readPointerSpace = null, size = { w: 520, h: 360 }, interval = setInterval, cancelInterval = clearInterval }) {
  let anchor = { ...bounds };
  const views = createPresentationViewTracker();
  let expanded = false;
  let native = null;
  let ignored = null;
  let timer = null;
  function layout(logical = anchor) {
    const center = { x: Math.round(logical.x + logical.width / 2), y: Math.round(logical.y + logical.height / 2) };
    return planOpen({ bounds: logical, size, workArea: screen.getDisplayNearestPoint(center).workArea });
  }
  function geometry() {
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
    return value;
  }
  function hitTest() {
    if (!native || native.isDestroyed()) return;
    const cursor = screen.getCursorScreenPoint();
    const area = expanded ? native.getBounds() : anchor;
    const outside = cursor.x < area.x || cursor.y < area.y || cursor.x >= area.x + area.width || cursor.y >= area.y + area.height;
    if (ignored === outside) return;
    ignored = outside;
    native.setIgnoreMouseEvents(outside, { forward: true });
  }
  function publish() {
    if (native && !native.isDestroyed()) {
      const value = geometry(); native.webContents.send('pet:viewport', value); return value;
    }
    return null;
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
  // Unified resume path (unlock-screen, resume, display change, show): the
  // native pass-through state is not trusted after the OS took the screen.
  // Forget the cached value and re-assert it, restart polling if it was
  // stopped by a 'hide' that had no matching 'show', re-apply the floating
  // level, and re-layout/publish for a possibly changed display.
  function resync(reason = 'resync') {
    if (!native || native.isDestroyed()) return false;
    const visible = typeof native.isVisible === 'function' ? native.isVisible() : true;
    if (visible && timer === null) timer = interval(hitTest, 24);
    native.setAlwaysOnTop?.(true, 'floating');
    native.setVisibleOnAllWorkspaces?.(true, { visibleOnFullScreen: false });
    // A late native 'show' must not fight the small OS position nudge macOS
    // applies after showInactive (no frame writes while visible); only a size
    // mismatch is corrected there. Explicit resumes also re-position.
    const plan = layout(), current = native.getBounds();
    const sized = current.width !== plan.bounds.width || current.height !== plan.bounds.height;
    const moved = current.x !== plan.bounds.x || current.y !== plan.bounds.y;
    if (sized || (moved && reason !== 'show')) native.setBounds(plan.bounds, false);
    ignored = null;
    publish(); hitTest();
    return true;
  }
  return {
    initialBounds: layout().bounds,
    attach(window) {
      native = window;
      native.webContents.on('did-finish-load', publish);
      native.webContents.on('input-event', hitTest);
      native.on('show', () => resync('show'));
      native.on('hide', () => { if (timer !== null) cancelInterval(timer); timer = null; });
      native.on('closed', () => { if (timer !== null) cancelInterval(timer); timer = null; native = null; });
    },
    getBounds: () => ({ ...anchor }),
    readPresentationView: () => readPointerSpace ? geometry().presentationView : null,
    setPosition: move,
    setBounds: next => move(next.x ?? anchor.x, next.y ?? anchor.y),
    setMenuOpen(open) { expanded = Boolean(open); hitTest(); return geometry(); },
    resync
  };
}
module.exports = { createPetViewport };
