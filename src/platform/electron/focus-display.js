'use strict';

// The display the user is actually looking at, resolved without any macOS
// screen-recording permission.
//
// Extracted from nudge-host (ARCHITECTURE「快捷行动面板」) so the corner reminders and the quick panel
// share one definition of "which screen" instead of each carrying a near-copy.
// The fallback ladder is: the centre of the focused window (unless it is one of
// our own surfaces, excluded via ownsSender) → the cursor's screen → the primary
// display. Every input here is permission-free on Electron 44 (verified on this
// machine: BrowserWindow bounds are ours; screen.getCursorScreenPoint,
// getDisplayNearestPoint and getPrimaryDisplay all answer with no grant and no
// prompt). Reaching for the *foreground app's* window bounds is what would need
// screen recording — so we deliberately never do that.
function resolveFocusDisplay({ screenHost, ownsSender, BrowserWindow = require('electron').BrowserWindow } = {}) {
  if (!screenHost || typeof screenHost.primaryDisplay !== 'function') {
    throw new TypeError('resolveFocusDisplay requires a screen host');
  }
  const owns = typeof ownsSender === 'function' ? ownsSender : () => false;

  function displayForPoint(point) {
    try {
      return screenHost.nearestDisplay(point);
    } catch (_) {
      return null;
    }
  }

  try {
    const focused = BrowserWindow && typeof BrowserWindow.getFocusedWindow === 'function'
      ? BrowserWindow.getFocusedWindow()
      : null;
    const alive = focused && (typeof focused.isDestroyed !== 'function' || !focused.isDestroyed());
    // A focused 小步 surface must not anchor the next one to itself; only a
    // genuinely external window contributes its position.
    const ownsFocus = focused && owns(focused.webContents);
    if (alive && !ownsFocus && typeof focused.getBounds === 'function') {
      const bounds = focused.getBounds();
      const display = displayForPoint({
        x: bounds.x + bounds.width / 2,
        y: bounds.y + bounds.height / 2
      });
      if (display) return display;
    }
  } catch (_) {}

  try {
    const display = displayForPoint(screenHost.cursorPoint());
    if (display) return display;
  } catch (_) {}

  return screenHost.primaryDisplay();
}

// The panel/reminder landing inside a display's work area: horizontally centred,
// a quarter of the way down. Matches toggleImpulseWindow's existing choice
// (ARCHITECTURE「快捷行动面板」) — visually high, not covering what the user is reading.
function focusLanding(workArea, size) {
  const width = size && Number.isFinite(size.width) ? size.width : 0;
  const height = size && Number.isFinite(size.height) ? size.height : 0;
  return {
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(Math.max(workArea.y + 8, Math.min(workArea.y + workArea.height * 0.25, workArea.y + workArea.height - height - 8)))
  };
}

module.exports = { resolveFocusDisplay, focusLanding };
