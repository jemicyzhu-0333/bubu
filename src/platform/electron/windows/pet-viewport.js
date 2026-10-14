'use strict';
const { planOpen } = require('../pet-menu-expansion');

// Windows and macOS transparent surfaces keep a stable backing store across menu toggles.
// Public bounds remain the 220 DIP pet anchor, including persisted positions.
function createPetViewport({ bounds, screen, size = { w: 520, h: 360 }, interval = setInterval, cancelInterval = clearInterval }) {
  let anchor = { ...bounds };
  let expanded = false;
  let native = null;
  let ignored = null;
  let timer = null;
  function layout() {
    const center = { x: Math.round(anchor.x + anchor.width / 2), y: Math.round(anchor.y + anchor.height / 2) };
    return planOpen({ bounds: anchor, size, workArea: screen.getDisplayNearestPoint(center).workArea });
  }
  function geometry() {
    const plan = layout();
    const viewport = native ? native.getBounds() : plan.bounds;
    return { side: plan.side, width: viewport.width, height: viewport.height,
      stageOffset: { x: anchor.x + anchor.width / 2 - viewport.x - viewport.width / 2,
        y: anchor.y + anchor.height / 2 - viewport.y - viewport.height / 2 } };
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
    if (native && !native.isDestroyed()) native.webContents.send('pet:viewport', geometry());
  }
  function move(x, y) {
    anchor = { ...anchor, x, y };
    const plan = layout();
    const current = native.getBounds();
    // Only moving to a display too small for the backing store can resize it.
    // Opening/closing a menu never takes this path.
    if (current.width !== plan.bounds.width || current.height !== plan.bounds.height) native.setBounds(plan.bounds, false);
    else native.setPosition(plan.bounds.x, plan.bounds.y, false);
    publish(); hitTest();
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
    const plan = layout(), current = native.getBounds();
    if (current.width !== plan.bounds.width || current.height !== plan.bounds.height
      || current.x !== plan.bounds.x || current.y !== plan.bounds.y) native.setBounds(plan.bounds, false);
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
    setPosition: move,
    setBounds: next => move(next.x ?? anchor.x, next.y ?? anchor.y),
    setMenuOpen(open) { expanded = Boolean(open); hitTest(); return geometry(); },
    resync
  };
}
module.exports = { createPetViewport };
