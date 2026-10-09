'use strict';

// A shared cocoa contour and small rounded motifs for native vector clothes.
const INK = '#351710';
const MINT = '#a4d5c0';
const GOLD = '#edd18b';
const BLUE = '#a4bad7';
const LAVENDER = '#c5add9';

function shape(ctx, fill, draw, width = 1.1) {
  ctx.beginPath();
  draw();
  ctx.fillStyle = fill;
  ctx.strokeStyle = INK;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (fill) ctx.fill();
  if (width > 0) ctx.stroke();
}

function oval(ctx, x, y, rx, ry, fill, width = 1.1) {
  const k = 0.55228475;
  shape(ctx, fill, () => {
    ctx.moveTo(x + rx, y);
    ctx.bezierCurveTo(x + rx, y + ry * k, x + rx * k, y + ry, x, y + ry);
    ctx.bezierCurveTo(x - rx * k, y + ry, x - rx, y + ry * k, x - rx, y);
    ctx.bezierCurveTo(x - rx, y - ry * k, x - rx * k, y - ry, x, y - ry);
    ctx.bezierCurveTo(x + rx * k, y - ry, x + rx, y - ry * k, x + rx, y);
  }, width);
}

function star(ctx, x, y, radius, fill = GOLD) {
  shape(ctx, fill, () => {
    ctx.moveTo(x, y - radius);
    ctx.quadraticCurveTo(x + radius * 0.2, y - radius * 0.2, x + radius, y);
    ctx.quadraticCurveTo(x + radius * 0.2, y + radius * 0.2, x, y + radius);
    ctx.quadraticCurveTo(x - radius * 0.2, y + radius * 0.2, x - radius, y);
    ctx.quadraticCurveTo(x - radius * 0.2, y - radius * 0.2, x, y - radius);
  }, 0.75);
}

export { INK, MINT, GOLD, BLUE, LAVENDER, shape, oval, star };
