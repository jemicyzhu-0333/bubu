'use strict';

const { createHardenedWindow } = require('./window-host');

const CORNER_MARGIN = 20;
// The gathered L3 characters drift toward the centre but stop short of covering
// it, so the user can still see what they were working on.
const CONVERGENCE_OFFSETS = Object.freeze([
  Object.freeze({ x: 60, y: 55 }),
  Object.freeze({ x: -60, y: 55 }),
  Object.freeze({ x: 60, y: -55 }),
  Object.freeze({ x: -60, y: -55 })
]);

/**
 * Where the corner characters go on the display the user is actually looking at.
 *
 * A corner reminder holds a character beside a speech bubble, so the window has
 * to be wide enough for a whole line — a square window leaves the bubble a few
 * dozen pixels and clips the copy. The gathering level gets a little more room
 * because it carries the longer lines.
 */
function cornerLayout({ workArea, level, lowStimulation = false }) {
  const width = level === 3 ? 380 : 340;
  const height = level === 3 ? 200 : 170;
  const right = workArea.x + workArea.width - width - CORNER_MARGIN;
  const left = workArea.x + CORNER_MARGIN;
  const bottom = workArea.y + workArea.height - height - CORNER_MARGIN;
  const top = workArea.y + CORNER_MARGIN;
  const positions = [
    { corner: 'br', x: right, y: bottom },
    { corner: 'bl', x: left, y: bottom },
    { corner: 'tr', x: right, y: top },
    { corner: 'tl', x: left, y: top }
  ];
  // One character is enough to be noticed at L2, and a low-stimulation profile
  // never wants four of them arriving at once.
  const single = level === 2 || lowStimulation === true;
  return { width, height, positions: single ? positions.slice(0, 1) : positions };
}

function convergencePositions({ workArea, width, height, count }) {
  const centerX = workArea.x + workArea.width / 2 - width / 2;
  const centerY = workArea.y + workArea.height / 2 - height / 2;
  return CONVERGENCE_OFFSETS.slice(0, Math.max(0, Number(count) || 0)).map(offset => ({
    x: Math.round(centerX + offset.x),
    y: Math.round(centerY + offset.y)
  }));
}

/**
 * One corner character.
 *
 * It arrives without stealing focus and ignores the mouse, so a reminder can
 * never swallow a click meant for the work underneath. Pointer input is handed
 * over only when the renderer says the pointer is over a control, and focus only
 * when the user presses the advertised chord.
 */
function createNudgeCornerWindow({
  BrowserWindow,
  preloadPath,
  pagePath,
  corner,
  bounds,
  onDeliveryError,
  onReady
}) {
  let native = null;
  let api = null;
  const host = createHardenedWindow({
    BrowserWindow,
    preloadPath,
    pagePath,
    onDeliveryError,
    options: {
      ...bounds,
      show: false,
      frame: false,
      resizable: false,
      movable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      transparent: true,
      focusable: true
    },
    configure: nativeWindow => {
      native = nativeWindow;
      nativeWindow.setIgnoreMouseEvents(true, { forward: true });
      nativeWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      nativeWindow.webContents.on('did-finish-load', () => {
        if (api && typeof onReady === 'function') onReady(api);
      });
    }
  });

  api = Object.freeze({
    corner,
    isAlive: host.isAlive,
    isVisible: host.isVisible,
    close: host.close,
    send: host.send,
    showInactive: host.showInactive,
    ownsSender: sender => host.isAlive() && native.webContents === sender,
    setPointerInteractive: interactive => {
      if (!host.isAlive()) return false;
      native.setIgnoreMouseEvents(!interactive, { forward: true });
      return true;
    },
    focusForKeyboard: () => {
      if (!host.isAlive()) return false;
      try {
        native.setIgnoreMouseEvents(false, { forward: true });
        host.showAndFocus();
        host.send('nudge:focus-controls');
        return true;
      } catch (_) {
        return false;
      }
    },
    // Stop where you are: used when a calm profile lands mid-animation.
    haltMotion: () => {
      if (!host.isAlive()) return;
      try {
        const current = host.getBounds();
        host.setPosition(Math.round(current.x), Math.round(current.y), false);
      } catch (_) {}
    },
    moveTo: (x, y, animate = false) => {
      if (!host.isAlive()) return;
      try {
        host.setPosition(x, y, animate);
      } catch (_) {}
    }
  });
  return api;
}

// The L4 card covers the work area rather than the whole screen, so the menu bar
// stays visible and the reminder never looks like a crash.
function createNudgeFullscreenWindow({
  BrowserWindow,
  preloadPath,
  pagePath,
  workArea,
  onDeliveryError,
  onReady
}) {
  let native = null;
  let api = null;
  const host = createHardenedWindow({
    BrowserWindow,
    preloadPath,
    pagePath,
    onDeliveryError,
    options: {
      x: workArea.x,
      y: workArea.y,
      width: workArea.width,
      height: workArea.height,
      show: false,
      frame: false,
      resizable: false,
      movable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      transparent: true,
      fullscreenable: false
    },
    configure: nativeWindow => {
      native = nativeWindow;
      nativeWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      nativeWindow.webContents.on('did-finish-load', () => {
        if (api && typeof onReady === 'function') onReady(api);
      });
    }
  });

  api = Object.freeze({
    isAlive: host.isAlive,
    isVisible: host.isVisible,
    close: host.close,
    send: host.send,
    showAndFocus: host.showAndFocus,
    ownsSender: sender => host.isAlive() && native.webContents === sender
  });
  return api;
}

module.exports = { cornerLayout, convergencePositions, createNudgeCornerWindow, createNudgeFullscreenWindow };
