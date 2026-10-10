'use strict';

import { paperPlaneClip, compassClip } from './usagi-messenger-clips.mjs';
import { IDENTITY, multiply } from './rig/pose.mjs';

// Native vector wardrobe, in the same cream-bunny scale and cocoa ink as the
// authored rig. No face coordinates, body geometry or persisted state live here.
import { MINT, GOLD, BLUE, LAVENDER, shape, oval, star } from './usagi-wardrobe-shapes.mjs';
import { SEASONAL_PAINTERS, rainBoot } from './usagi-seasonal-wardrobe.mjs';

function earBow(ctx, { back, side }) {
  const scale = back ? 0.65 : side ? 0.78 : 0.8;
  ctx.scale(scale, scale);
  shape(ctx, MINT, () => {
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(-11, -9, -9, -1);
    ctx.quadraticCurveTo(-10, 9, 0, 0);
  });
  if (!back) shape(ctx, MINT, () => {
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(8, -10, 9, -2);
    ctx.quadraticCurveTo(12, 6, 0, 0);
  });
  oval(ctx, 0, 0, 2.2, 2.4, '#83bda7');
}

function cape(ctx, { back, side, turned }, starlit = false) {
  shape(ctx, starlit ? LAVENDER : BLUE, () => {
    if (back) {
      ctx.moveTo(-18, 0);
      ctx.quadraticCurveTo(-22, 5, -25, 12);
      ctx.quadraticCurveTo(0, 23, 25, 12);
      ctx.quadraticCurveTo(22, 5, 18, 0);
    } else if (side || turned) {
      ctx.moveTo(-17, 0);
      ctx.quadraticCurveTo(-22, 5, -24, 12);
      ctx.quadraticCurveTo(-10, 20, 15, 2);
    } else {
      ctx.moveTo(-19, 0);
      ctx.quadraticCurveTo(-22, 5, -25, 11);
      ctx.quadraticCurveTo(-11, 14, 0, 2);
      ctx.quadraticCurveTo(11, 14, 25, 11);
      ctx.quadraticCurveTo(22, 5, 19, 0);
    }
    ctx.closePath();
  });
  if (starlit) {
    star(ctx, -17, 7, 2.2);
    if (!side && !turned) star(ctx, 17, 7, 1.6);
  }
}

function collar(ctx, { back, side, turned }) {
  shape(ctx, GOLD, () => {
    ctx.moveTo(-18, -1);
    ctx.quadraticCurveTo(0, 3, 18, -1);
    ctx.lineTo(18, 2);
    ctx.quadraticCurveTo(0, 6, -18, 2);
    ctx.closePath();
  });
  if (!back) star(ctx, side || turned ? 15 : 0, 4, 3.2, '#f3d589');
}

function sprout(ctx, { back, side }) {
  ctx.scale(side || back ? 0.8 : 1, 1);
  shape(ctx, null, () => { ctx.moveTo(0, 2); ctx.quadraticCurveTo(1, -3, 0, -7); });
  shape(ctx, MINT, () => {
    ctx.moveTo(0, -4); ctx.quadraticCurveTo(-9, -12, -7, -4);
    ctx.quadraticCurveTo(-5, 0, 0, -4);
    ctx.quadraticCurveTo(5, -13, 8, -8); ctx.quadraticCurveTo(7, -2, 0, -4);
  });
  oval(ctx, 0, 1, 2, 1.6, GOLD);
}

function sakura(ctx, { back, side }) {
  ctx.scale(back || side ? 0.8 : 1, 1);
  for (let index = 0; index < 5; index += 1) {
    const angle = index * Math.PI * 2 / 5 - Math.PI / 2;
    oval(ctx, Math.cos(angle) * 3.5, Math.sin(angle) * 3.5, 2.6, 2.8, '#efb8c7', 0.8);
  }
  oval(ctx, 0, 0, 1.8, 1.8, GOLD, 0.7);
}

function sunhat(ctx, { side }) {
  ctx.scale(side ? 0.85 : 1, 1);
  shape(ctx, '#f0d59d', () => {
    ctx.moveTo(-6, 0); ctx.lineTo(-4, -7);
    ctx.quadraticCurveTo(0, -10, 4, -7); ctx.lineTo(6, 0); ctx.closePath();
  });
  shape(ctx, MINT, () => {
    ctx.moveTo(-5.3, -3); ctx.quadraticCurveTo(0, -1.5, 5.3, -3);
    ctx.lineTo(6, 0); ctx.lineTo(-6, 0); ctx.closePath();
  }, 0.7);
  oval(ctx, 0, 1, 10, 2.2, '#f0d59d');
}

function crown(ctx, { back, side }) {
  ctx.scale(side ? 0.82 : 1, 1);
  shape(ctx, GOLD, () => {
    ctx.moveTo(-7, 1); ctx.lineTo(-8, -7); ctx.lineTo(-3, -3);
    ctx.lineTo(0, -9); ctx.lineTo(3, -3); ctx.lineTo(8, -7);
    ctx.lineTo(7, 1); ctx.quadraticCurveTo(0, 3, -7, 1); ctx.closePath();
  });
  if (!back) oval(ctx, 0, -1, 1.5, 1.6, LAVENDER, 0.7);
}

function satchel(ctx, { back, side }) {
  // Strap stays in the lower-body band; it never runs diagonally over a cheek.
  shape(ctx, null, () => { ctx.moveTo(0, 1); ctx.quadraticCurveTo(2, -7, 8, -6); });
  shape(ctx, '#e6be91', () => {
    ctx.moveTo(-5, 0); ctx.quadraticCurveTo(0, -2, 6, 0);
    ctx.lineTo(6, 13); ctx.quadraticCurveTo(0, 16, -5, 13); ctx.closePath();
  });
  shape(ctx, '#f5d5af', () => {
    ctx.moveTo(-5, 0); ctx.lineTo(6, 0); ctx.lineTo(5, 4);
    ctx.quadraticCurveTo(0, 7, -4, 4); ctx.closePath();
  });
  if (!back) {
    shape(ctx, '#dfa06c', () => {
      ctx.moveTo(-1.7, 7); ctx.quadraticCurveTo(2, 4, 3, 7);
      ctx.lineTo(0, 11); ctx.closePath();
    }, 0.65);
    shape(ctx, null, () => { ctx.moveTo(1, 6); ctx.lineTo(side ? 3 : 2, 4); }, 0.7);
  }
}

function scarf(ctx, { back, side, turned }) {
  const tailX = side || turned ? 13 : 16;
  shape(ctx, LAVENDER, () => {
    ctx.moveTo(tailX - 3, 2); ctx.lineTo(tailX + 2, 2);
    ctx.lineTo(tailX + 5, 13); ctx.lineTo(tailX, 15); ctx.closePath();
  });
  shape(ctx, MINT, () => {
    ctx.moveTo(-17, -1); ctx.quadraticCurveTo(0, 2, 17, -1);
    ctx.lineTo(17, 3); ctx.quadraticCurveTo(0, 8, -17, 3); ctx.closePath();
  });
  if (!back) oval(ctx, tailX - 1, 3, 3, 2.5, '#f1c7ca', 0.8);
}

function halo(ctx, { side }) {
  oval(ctx, 0, 0, side ? 6 : 9, 1.3, null, 1.1);
  // A second warm hairline keeps the center transparent rather than capping ears.
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 0.6;
  ctx.stroke();
}

function boot(ctx, side = false) {
  shape(ctx, BLUE, () => {
    ctx.moveTo(-3.5, -2); ctx.lineTo(3.5, -2);
    ctx.lineTo(side ? 5 : 4.5, 3);
    ctx.quadraticCurveTo(3, 6, -4, 5); ctx.quadraticCurveTo(-5, 3, -3.5, -2);
  });
  star(ctx, 0, 1.3, 1.4, '#fff5de');
}

function footwear(ctx, { artwork, anchor, view }, drawBoot = boot) {
  ctx.save();
  ctx.translate(anchor.x, anchor.y);
  drawBoot(ctx, view === 'profile');
  ctx.restore();
  const data = artwork?.rig?.views?.[artwork.drawnView || view];
  const right = data?.anchors?.['usagi.footwear-r'];
  const left = data?.anchors?.['usagi.footwear'];
  if (!right || !left) return;
  const from = artwork.pose.world[left.bone] || IDENTITY;
  const to = artwork.pose.world[right.bone] || IDENTITY;
  const [a, b, c, d, e, f] = from;
  const determinant = a * d - b * c;
  const inverse = [d, -b, -c, a, c * f - d * e, b * e - a * f].map(value => value / determinant);
  // The rig compositor already applied the left ankle's matrix. Cancel only
  // that matrix, then apply the right ankle so a walking boot cannot float.
  ctx.transform(...multiply(inverse, to));
  ctx.translate(right.x, right.y);
  drawBoot(ctx, view === 'profile');
}

const PAINTERS = Object.freeze({
  ...SEASONAL_PAINTERS,
  'usagi-paper-plane-clip': paperPlaneClip,
  'usagi-compass-clip': compassClip,
  'usagi-ear-bow': earBow,
  'usagi-star-collar': collar,
  'usagi-travel-cape': cape,
  'usagi-sprout-clip': sprout,
  'usagi-sakura-clip': sakura,
  'usagi-sunhat': sunhat,
  'usagi-tiny-crown': crown,
  'usagi-carrot-satchel': satchel,
  'usagi-pastel-scarf': scarf,
  'usagi-halo': halo,
  'usagi-starlit-cape': (ctx, view) => cape(ctx, view, true)
});

function appearance(ctx, options) {
  const { item, layer, form, view = 'front' } = options;
  if (!item?.parts.includes(layer) || layer !== 'front') return false;
  const anchor = form.appearanceAnchors[item.exclusiveGroup]?.[view];
  const painter = PAINTERS[item.renderKey];
  const bootPainter = item.renderKey === 'usagi-soft-boots' ? boot
    : item.renderKey === 'usagi-rain-boots' ? rainBoot : null;
  if (!anchor || (!painter && !bootPainter)) return false;
  ctx.save();
  try {
    if (bootPainter) footwear(ctx, { ...options, anchor, view }, bootPainter);
    else {
      ctx.translate(anchor.x, anchor.y);
      // Profile headwear seats on the canonical skull span. Other views keep
      // the existing separation from the near ear clasp and its moving bone.
      if (item.exclusiveGroup === 'usagi.headwear') ctx.translate(view === 'profile' ? (26 + 44) / 2 - anchor.x : -8, 0);
      if (item.exclusiveGroup === 'usagi.earwear') ctx.translate(view === 'three-quarter' ? 5 : 4, 0);
      painter(ctx, { back: view === 'back', side: view === 'profile', turned: view === 'three-quarter' });
    }
  } finally { ctx.restore(); }
  return true;
}

export { appearance };
