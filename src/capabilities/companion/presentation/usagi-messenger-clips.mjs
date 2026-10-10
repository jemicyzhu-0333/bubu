'use strict';
import { shape, oval, MINT, GOLD } from './usagi-wardrobe-shapes.mjs';

// Original procedural accessory art, drawn for the existing ear_r clasp.
// Four projections share the attachment; no character pixels are replaced.
function paperPlaneClip(ctx, { back, side, turned }) {
  ctx.translate(.75, 0);
  oval(ctx, -1, 1.1, 3.2, 1.4, MINT, .75);
  if (back) {
    shape(ctx, '#d6c6ae', () => { ctx.moveTo(-7, -2); ctx.lineTo(7, -5); ctx.lineTo(2, 4); ctx.lineTo(-1, 0); ctx.closePath(); }, .9);
    shape(ctx, null, () => { ctx.moveTo(-1, 0); ctx.lineTo(7, -5); }, .6);
    return;
  }
  const tip = side ? [7, -4] : turned ? [8, -5] : [8, -6];
  shape(ctx, '#fff7e6', () => {
    ctx.moveTo(-8, -2); ctx.lineTo(...tip); ctx.lineTo(2, 5);
    ctx.lineTo(-1, 1); ctx.lineTo(-5, 3); ctx.lineTo(-5, -1); ctx.closePath();
  }, .95);
  shape(ctx, '#e4cbb7', () => {
    ctx.moveTo(-5, -1); ctx.lineTo(...tip); ctx.lineTo(-1, 1); ctx.lineTo(-5, 3); ctx.closePath();
  }, .65);
}

function compassClip(ctx, { back, side, turned }) {
  oval(ctx, 0, 0, side ? 3.6 : 5.3, 5.3, GOLD, 1);
  if (back) { shape(ctx, null, () => { ctx.moveTo(-2, 0); ctx.lineTo(2, 0); }, .9); return; }
  oval(ctx, .15, 0, side ? 2.4 : 4, 4, '#f9f3e4', .65);
  const lean = side ? .8 : turned ? 1.2 : 1.5;
  shape(ctx, MINT, () => { ctx.moveTo(-lean, -3.1); ctx.lineTo(1.8, .6); ctx.lineTo(-1.5, 1); ctx.closePath(); }, .65);
  shape(ctx, '#c5add9', () => { ctx.moveTo(lean, 3.1); ctx.lineTo(-1.5, -1); ctx.lineTo(1.8, -.6); ctx.closePath(); }, .65);
  oval(ctx, 0, 0, .8, .8, GOLD, .3);
}
export { paperPlaneClip, compassClip };
