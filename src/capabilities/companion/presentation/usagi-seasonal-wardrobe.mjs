'use strict';

import { MINT, GOLD, LAVENDER, shape, oval, star } from './usagi-wardrobe-shapes.mjs';

// Coordinated clothes stay small enough to mix across all seven original
// slots. Local coordinates are relative to the rig-owned attachment point.
const CREAM = '#fff1d3';
const SAGE = '#abc6a1';

function leaf(ctx, x, y, size = 1) {
  shape(ctx, SAGE, () => {
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x - 4 * size, y - 6 * size, x - 5 * size, y - 2 * size);
    ctx.quadraticCurveTo(x - 4 * size, y + size, x, y);
    ctx.quadraticCurveTo(x + 3 * size, y - 6 * size, x + 5 * size, y - 4 * size);
    ctx.quadraticCurveTo(x + 5 * size, y, x, y);
  }, 0.65);
}

function beret(ctx, { side, back }, moon = false) {
  const width = side ? 7.4 : 9;
  shape(ctx, moon ? LAVENDER : SAGE, () => {
    ctx.moveTo(-width, 0);
    ctx.bezierCurveTo(-width - 1, -7, width - 3, -10, width, -3);
    ctx.quadraticCurveTo(width + 1, 1, width - 2, 2);
    ctx.quadraticCurveTo(0, 4, -width, 0);
  });
  shape(ctx, moon ? '#b49bc9' : '#91af89', () => {
    ctx.moveTo(-width + 1, 0);
    ctx.quadraticCurveTo(0, 3.8, width - 1, 0);
    ctx.quadraticCurveTo(4, 4.5, -width + 1, 1.2);
  }, 0);
  shape(ctx, moon ? '#b49bc9' : '#91af89', () => {
    ctx.moveTo(-1, -6); ctx.quadraticCurveTo(-1, -10, 1, -9);
    ctx.quadraticCurveTo(2, -8, 0.5, -6);
  }, 0.8);
  if (moon && !back) shape(ctx, CREAM, () => {
    ctx.moveTo(5, -5.5); ctx.bezierCurveTo(0, -5, 1, 0, 5, -0.5);
    ctx.quadraticCurveTo(2.5, -2, 5, -5.5);
  }, 0);
}

function daisy(ctx, { side, back }) {
  ctx.scale(side || back ? 0.76 : 1, 1);
  // The short gold clasp touches the ear; petals are one compact rosette.
  oval(ctx, -1.5, 1.8, 3.3, 1.2, GOLD, 0.7);
  for (let i = 0; i < 6; i += 1) {
    const angle = Math.PI * i / 3;
    oval(ctx, Math.cos(angle) * 3, Math.sin(angle) * 3, 2.2, 2.2, CREAM, 0.65);
  }
  oval(ctx, 0, 0, 1.8, 1.8, GOLD, 0.7);
}

function petalCollar(ctx, { side, turned, back }) {
  const left = side ? -12 : -17, right = side ? 17 : 17;
  shape(ctx, MINT, () => {
    ctx.moveTo(left, -0.4); ctx.quadraticCurveTo(0, 3, right, -0.4);
    ctx.quadraticCurveTo(right + 1, 5, 12, 4);
    ctx.quadraticCurveTo(10, 8, 5, 5);
    ctx.quadraticCurveTo(0, 9, -5, 5);
    ctx.quadraticCurveTo(-10, 8, -12, 4);
    ctx.quadraticCurveTo(left - 1, 5, left, -0.4);
  });
  if (!back) {
    const x = side || turned ? 11 : 0;
    leaf(ctx, x, 7, 0.48);
    oval(ctx, x, 3.5, 1.3, 1.3, GOLD, 0.65);
  }
}

function seedPouch(ctx, { back }) {
  shape(ctx, null, () => {
    ctx.moveTo(3, 3); ctx.quadraticCurveTo(5, -4, 10, -4);
  }, 1.25);
  shape(ctx, '#ebcdab', () => {
    ctx.moveTo(-1, 1); ctx.quadraticCurveTo(-6, 8, -3, 12);
    ctx.quadraticCurveTo(3, 16, 9, 12); ctx.quadraticCurveTo(12, 8, 6, 1);
    ctx.closePath();
  });
  shape(ctx, '#fae3c0', () => {
    ctx.moveTo(-1, 1); ctx.lineTo(-2, -1); ctx.quadraticCurveTo(3, 1, 7, -1);
    ctx.lineTo(6, 2); ctx.quadraticCurveTo(2, 3, -1, 1);
  }, 0.8);
  shape(ctx, null, () => { ctx.moveTo(-1, 3); ctx.quadraticCurveTo(4, 4, 7, 2); }, 0.7);
  if (!back) leaf(ctx, 3, 10, 0.63);
}

function rainCape(ctx, { back, side, turned }) {
  const oblique = side || turned;
  shape(ctx, '#edce86', () => {
    if (back) {
      ctx.moveTo(-17, 0); ctx.quadraticCurveTo(-21, 5, -23, 11);
      ctx.quadraticCurveTo(0, 18, 23, 11); ctx.quadraticCurveTo(21, 5, 17, 0);
    } else if (oblique) {
      ctx.moveTo(-15, 0); ctx.quadraticCurveTo(-20, 5, -22, 11);
      ctx.quadraticCurveTo(-6, 16, 15, 5); ctx.lineTo(16, 0);
    } else {
      ctx.moveTo(-17, 0); ctx.quadraticCurveTo(-20, 5, -23, 11);
      ctx.quadraticCurveTo(-7, 15, -2, 10); ctx.lineTo(0, 2);
      ctx.lineTo(2, 10); ctx.quadraticCurveTo(7, 15, 23, 11);
      ctx.quadraticCurveTo(20, 5, 17, 0);
    }
    ctx.closePath();
  });
  shape(ctx, '#f8dfa3', () => {
    ctx.moveTo(-17, 0); ctx.quadraticCurveTo(0, 3, 17, 0);
    ctx.quadraticCurveTo(9, 7, oblique ? 10 : 1, 3);
    ctx.quadraticCurveTo(-5, 8, -17, 0);
  }, 0.75);
  if (!back) oval(ctx, oblique ? 9 : 1.5, 6, 1.2, 1.2, '#fff1ce', 0.7);
  shape(ctx, null, () => {
    ctx.moveTo(-19, 10); ctx.quadraticCurveTo(-12, 12, -7, 11);
    if (!oblique) { ctx.moveTo(7, 11); ctx.quadraticCurveTo(12, 12, 19, 10); }
  }, 0.45);
}

function rainBoot(ctx, side = false) {
  shape(ctx, '#9ac4b0', () => {
    ctx.moveTo(-3.4, -2); ctx.lineTo(3.4, -2); ctx.lineTo(3.7, 1);
    ctx.quadraticCurveTo(side ? 6 : 5, 2, side ? 5.2 : 4.6, 4);
    ctx.quadraticCurveTo(2, 5.4, -4.2, 4.7);
    ctx.quadraticCurveTo(-4.8, 2, -3.4, -2); ctx.closePath();
  });
  shape(ctx, '#c9ded0', () => {
    ctx.moveTo(-3.4, -2); ctx.lineTo(3.4, -2); ctx.lineTo(3.5, -0.5);
    ctx.quadraticCurveTo(0, 0.4, -3.6, -0.5); ctx.closePath();
  }, 0.65);
  shape(ctx, null, () => { ctx.moveTo(-3.6, 3.5); ctx.quadraticCurveTo(0, 4.4, 3.6, 3.5); }, 0.55);
  oval(ctx, 2, 1.7, 0.7, 0.5, CREAM, 0);
}

function envelopePouch(ctx, { back, side }) {
  shape(ctx, null, () => { ctx.moveTo(1, 1); ctx.quadraticCurveTo(3, -5, 9, -4); }, 1.2);
  shape(ctx, '#f4e0be', () => {
    ctx.moveTo(-4, 1); ctx.quadraticCurveTo(2, -1, 9, 1);
    ctx.lineTo(8, 12); ctx.quadraticCurveTo(2, 14, -4, 11); ctx.closePath();
  });
  if (!back) {
    shape(ctx, '#fff0d5', () => {
      ctx.moveTo(-4, 1); ctx.lineTo(9, 1); ctx.lineTo(side ? 5 : 3, 6);
      ctx.quadraticCurveTo(2, 7, 1, 6); ctx.closePath();
    }, 0.8);
    oval(ctx, 2.5, 6.3, 1.3, 1.2, '#dea8b7', 0.5);
    shape(ctx, null, () => { ctx.moveTo(-2.8, 10); ctx.lineTo(0, 7.8); ctx.moveTo(6, 8); ctx.lineTo(7, 10.5); }, 0.5);
  }
}

function constellation(ctx, { side }) {
  const width = side ? 8 : 12;
  shape(ctx, null, () => {
    ctx.moveTo(-width, 0.1); ctx.quadraticCurveTo(0, -3, width, 0.1);
  }, 0.6);
  ctx.strokeStyle = LAVENDER; ctx.stroke();
  star(ctx, -width, 0.1, 1.4, GOLD);
  star(ctx, 0, -1.5, 1.6, CREAM);
  star(ctx, width, 0.1, 1.4, GOLD);
}

const SEASONAL_PAINTERS = Object.freeze({
  'usagi-garden-beret': beret,
  'usagi-daisy-clip': daisy,
  'usagi-petal-collar': petalCollar,
  'usagi-seed-pouch': seedPouch,
  'usagi-rain-cape': rainCape,
  'usagi-moon-beret': (ctx, view) => beret(ctx, view, true),
  'usagi-envelope-pouch': envelopePouch,
  'usagi-constellation': constellation
});

export { SEASONAL_PAINTERS, rainBoot };
