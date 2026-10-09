import { TOOL_SPRITES } from '../content/companion/dango-tools.mjs';

// Pixel runs are compiled from editable SVG. Painting and contacts use the
// exact same instance translation; no second per-motion grip coordinates.
function drawContactTools(rect, contact, palette) {
  const outline = palette[1];
  for (const item of contact.tools) {
    const sprite = TOOL_SPRITES[item.key];
    for (const [fill, x, y, width] of sprite.runs) {
      rect(fill === '#1a1b26' ? outline : fill,
        item.x + (item.flip ? sprite.width - x - width : x), item.y + y, width, 1);
    }
  }
  for (const detail of contact.details) {
    const [x, y] = detail.at, amount = detail.amount;
    if (detail.type === 'keypress' && amount > .6) rect('#fff1d7', x - 1, y + 4, 4, 1);
    else if (detail.type === 'steam') {
      const drift = Math.sin(contact.phase * Math.PI * 4) * 2;
      rect('#f1e9da', x + drift, y - 4, 2, 3); rect('#e6dbcc', x + 5 - drift, y - 9, 2, 3);
    } else if (detail.type === 'page' && amount > .05) {
      const width = Math.max(1, detail.width * Math.sin(amount * Math.PI));
      rect('#b5a075', x - width, y - amount * 3, width + 1, 12);
      rect('#fff7e9', x - width + 1, y - amount * 3, Math.max(1, width - 1), 10);
    } else if (detail.type === 'ink') {
      rect('#54749b', x, y, 2 + Math.floor(amount * 14), 1);
    } else if (detail.type === 'scroll') {
      rect('#edf7f8', x, y - (Math.floor(amount * 4) % 3), 24, 3);
      rect('#7c9cad', x + 1, y - (Math.floor(amount * 4) % 3), 15, 1);
    } else if (detail.type === 'reflection') {
      // A bounded reflection inside the held glass, never another full body.
      rect(palette[3], x + 2, y + 1, 7, 10);
      rect(palette[2], x + 1, y + 2, 9, 7);
      rect(palette[2], x + 2, y, 2, 3); rect(palette[2], x + 7, y, 2, 3);
      const blink = amount > .35 && amount < .41;
      rect(outline, x + 3, y + 4, 1, blink ? 1 : 2);
      rect(outline, x + 7, y + 4, 1, blink ? 1 : 2);
      rect(outline, x + 5, y + 7, 1, 1);
    } else if (detail.type === 'water' && amount > .05) {
      for (let i = 0; i < 4; i += 1) {
        const t = ((i / 4 + contact.phase * 3) % 1) * amount;
        rect('#87cde1', x + (detail.end[0] - x) * t, y + (detail.end[1] - y) * t + Math.sin(t * Math.PI) * 3, 2, 2);
      }
    } else if (detail.type === 'thread') {
      const rows = 3 + Math.floor(contact.phase * 7);
      rect('#659b8c', x - 7, y - 2, 10, rows);
      for (let row = 0; row < rows; row += 2) rect('#b6e5d3', x - 6, y - 2 + row, 8, 1);
      const steps = Math.ceil(Math.hypot(detail.end[0] - x, detail.end[1] - y));
      for (let i = 0; i <= steps; i += 1) {
        const t = i / steps; rect('#bd648b', x + (detail.end[0] - x) * t, y + (detail.end[1] - y) * t + Math.sin(t * Math.PI) * 3, 1, 1);
      }
    } else if (detail.type === 'food') {
      rect(outline, x - 1, y - 1, 8, 4); rect('#f4df9b', x, y, 6, 2); rect('#f77668', x + 1, y - 3, 3, 3);
    } else if (detail.type === 'flash' && amount) {
      rect('#fff1d7', x - 4, y, 9, 1); rect('#fff1d7', x, y - 4, 1, 9);
    }
  }
}

export { drawContactTools };
