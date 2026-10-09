'use strict';

function finiteRect(rect, name) {
  if (!rect || ['x', 'y', 'width', 'height'].some(key => !Number.isFinite(rect[key]))) {
    throw new TypeError(`${name} must contain finite x, y, width, and height`);
  }
  return rect;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(value, Math.max(minimum, maximum)));
}

// Places a popover on the usable side of a tray/menu-bar anchor. This is kept
// pure so top and bottom tray layouts, including secondary displays with
// negative coordinates, can be verified without launching Electron.
function placePopover({ trayBounds, popoverBounds, displayBounds, workArea, gap = 4, margin = 8 }) {
  const tray = finiteRect(trayBounds, 'trayBounds');
  const popover = finiteRect(popoverBounds, 'popoverBounds');
  const display = finiteRect(displayBounds, 'displayBounds');
  const usable = finiteRect(workArea, 'workArea');
  const safeGap = Math.max(0, Number.isFinite(gap) ? gap : 4);
  const safeMargin = Math.max(0, Number.isFinite(margin) ? margin : 8);

  const trayCenterY = tray.y + tray.height / 2;
  const displayCenterY = display.y + display.height / 2;
  const spaceAbove = tray.y - usable.y - safeGap;
  const spaceBelow = usable.y + usable.height - (tray.y + tray.height) - safeGap;
  let direction = trayCenterY >= displayCenterY ? 'above' : 'below';

  if (direction === 'above' && spaceAbove < popover.height && spaceBelow >= popover.height) direction = 'below';
  if (direction === 'below' && spaceBelow < popover.height && spaceAbove >= popover.height) direction = 'above';

  const preferredX = Math.round(tray.x + tray.width / 2 - popover.width / 2);
  const preferredY = direction === 'above'
    ? Math.round(tray.y - popover.height - safeGap)
    : Math.round(tray.y + tray.height + safeGap);
  const minX = usable.x + safeMargin;
  const maxX = usable.x + usable.width - popover.width - safeMargin;
  const minY = usable.y + safeMargin;
  const maxY = usable.y + usable.height - popover.height - safeMargin;

  return {
    x: clamp(preferredX, minX, maxX),
    y: clamp(preferredY, minY, maxY),
    direction
  };
}

function clampPopoverHeight(workArea, preferredHeight = 680, margin = 16, minimumHeight = 320) {
  const available = Math.max(0, Math.floor(Number(workArea && workArea.height) || 0) - margin);
  return Math.max(Math.min(minimumHeight, available), Math.min(preferredHeight, available));
}

function clampPopoverWidth(workArea, preferredWidth = 560, margin = 16, minimumWidth = 320) {
  const available = Math.max(0, Math.floor(Number(workArea && workArea.width) || 0) - margin);
  return Math.max(Math.min(minimumWidth, available), Math.min(preferredWidth, available));
}

function placeFloatingPanel({ bounds, workArea, remembered = null }) {
  const area = finiteRect(workArea, 'workArea');
  const panel = finiteRect(bounds, 'bounds');
  return {
    x: Math.round(clamp(remembered?.x ?? area.x + (area.width - panel.width) / 2,
      area.x + 8, area.x + area.width - panel.width - 8)),
    y: Math.round(clamp(remembered?.y ?? area.y + (area.height - panel.height) / 2,
      area.y + 8, area.y + area.height - panel.height - 8))
  };
}
module.exports = { placePopover, placeFloatingPanel, clampPopoverHeight, clampPopoverWidth };
