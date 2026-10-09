'use strict';

// Small status marks live beside the long ears and face. They use injected
// monotonic time and become a held illustration in low-stimulation mode.
const INK = '#6f6567';

function line(ctx, color, draw, width = 1.2) {
  ctx.beginPath();
  draw();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function shape(ctx, color, draw) {
  line(ctx, INK, draw, 0.9);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.stroke();
}

function oval(ctx, x, y, rx, ry, color) {
  const k = 0.55228475;
  shape(ctx, color, () => {
    ctx.moveTo(x + rx, y);
    ctx.bezierCurveTo(x + rx, y + ry * k, x + rx * k, y + ry, x, y + ry);
    ctx.bezierCurveTo(x - rx * k, y + ry, x - rx, y + ry * k, x - rx, y);
    ctx.bezierCurveTo(x - rx, y - ry * k, x - rx * k, y - ry, x, y - ry);
    ctx.bezierCurveTo(x + rx * k, y - ry, x + rx, y - ry * k, x + rx, y);
  });
}

function phaseAt(elapsedMs, calmVisual) {
  return calmVisual ? 0 : Math.sin((Number(elapsedMs) || 0) / 2200 * Math.PI * 2);
}

function zed(ctx, x, y, size) {
  line(ctx, '#809baa', () => {
    ctx.moveTo(x, y); ctx.lineTo(x + size, y);
    ctx.lineTo(x, y + size); ctx.lineTo(x + size, y + size);
  }, 1.25);
}

function expressionAccent(ctx, accent, { elapsedMs = 0, calmVisual = false } = {}) {
  if (accent !== 'sleep-zzz' && accent !== 'drowsy-zzz') return 0;
  const drift = phaseAt(elapsedMs, calmVisual);
  const count = accent === 'sleep-zzz' && !calmVisual ? 2 : 1;
  ctx.save();
  zed(ctx, 59, -10 - drift, 4);
  if (count > 1) zed(ctx, 69, -19 - drift * 1.4, 5.5);
  ctx.restore();
  return count;
}

function hungry(ctx, drift) {
  oval(ctx, 66, 15, 1.5, 1.5, '#fffaf1');
  oval(ctx, 70, 10, 2.1, 2, '#fffaf1');
  oval(ctx, 80, drift, 11, 8.5, '#fffaf1');
  shape(ctx, '#e5ad79', () => {
    ctx.moveTo(77, drift - 3); ctx.quadraticCurveTo(82, drift - 6, 84, drift - 1);
    ctx.lineTo(77, drift + 5); ctx.quadraticCurveTo(75, drift + 5, 77, drift - 3);
  });
  line(ctx, '#79a995', () => {
    ctx.moveTo(82, drift - 3); ctx.lineTo(82, drift - 6);
    ctx.moveTo(82, drift - 3); ctx.lineTo(85, drift - 5);
  }, 1.5);
  line(ctx, '#be865e', () => {
    ctx.moveTo(78, drift); ctx.lineTo(80, drift + 1);
  }, 0.75);
}

function coffee(ctx, drift, calmVisual) {
  oval(ctx, 78, 57, 9, 1.6, '#e9e2d7');
  shape(ctx, '#b7d8ce', () => {
    ctx.moveTo(71, 44); ctx.lineTo(82, 44); ctx.lineTo(82, 52);
    ctx.quadraticCurveTo(77, 59, 71, 52); ctx.closePath();
  });
  line(ctx, INK, () => {
    ctx.moveTo(82, 46); ctx.bezierCurveTo(90, 43, 90, 54, 82, 52);
  }, 1.2);
  oval(ctx, 76.5, 44, 5.4, 1.3, '#ac876f');
  line(ctx, '#a1aeb0', () => {
    ctx.moveTo(75, 40); ctx.bezierCurveTo(71 + drift, 37, 78 + drift, 37, 75, 34);
    if (!calmVisual) {
      ctx.moveTo(80, 40); ctx.bezierCurveTo(76 - drift, 37, 83 - drift, 37, 80, 34);
    }
  }, 1);
}

function statusEffect(ctx, status, { elapsedMs = 0, calmVisual = false } = {}) {
  if (status !== 'hungry' && status !== 'coffee') return false;
  const drift = phaseAt(elapsedMs, calmVisual) * 0.8;
  ctx.save();
  if (status === 'hungry') hungry(ctx, drift);
  else coffee(ctx, drift, calmVisual);
  ctx.restore();
  return true;
}

export { expressionAccent, statusEffect };
