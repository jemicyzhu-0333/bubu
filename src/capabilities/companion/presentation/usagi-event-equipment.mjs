'use strict';

import { createPathCache, paintShapes } from './rig/paint.mjs';
import { multiply, localMatrix } from './rig/pose.mjs';

const paths = createPathCache({ limit: 32 });
const shape = (d, fill, stroke = '#351710', width = 1.1) => Object.freeze({
  d, fill, stroke, width, opacity: 1, m: [1, 0, 0, 1, 0, 0], cap: 'round', join: 'round'
});
// The original mint outer lid/logo remains the prop. The study's quarter view
// supplies its physical plane and the keyboard behind it, never screen text.
const QUARTER_LID = Object.freeze([.8, -.07, -.17, 1, 37.9, .3]);
const QUARTER_BASE = Object.freeze([
  shape('M23 53 L45 50 L63 59 L36 64 L23 60Z', '#cbe4dc'),
  shape('M27 54 L44 52 L54 57 L36 60Z', '#e2eee8', '#839c94', .65),
  shape('M30 54 L45 53 M31 56 L48 54.5 M34 58 L50 56', 'none', '#839c94', .65)
]);

function eventLaptop(artwork) { return artwork?.pose?.sample?.event?.category === 'ai'; }
function laptopMatrix(artwork) {
  const pose = artwork.pose.sample.propPoses.laptop || {};
  return multiply(artwork.pose.world.root, localMatrix([33, 52], pose));
}

function paintUsagiEventLaptopBase(ctx, artwork, palette) {
  if (!eventLaptop(artwork)) return false;
  const data = artwork.rig.views[artwork.drawnView], prop = data.props.laptop;
  ctx.save(); ctx.globalAlpha *= artwork.pose.sample.event.weight;
  paintShapes(ctx, artwork.drawnView === 'three-quarter' ? QUARTER_BASE : [prop.shapes[1]],
    paths, palette, laptopMatrix(artwork));
  ctx.restore(); return true;
}

function paintUsagiEventProp(ctx, { id, prop, artwork, matrix }, paint) {
  if (id !== 'laptop' || !eventLaptop(artwork)) return false;
  const lid = [prop.shapes[0], ...prop.shapes.slice(2)];
  paint(lid, artwork.drawnView === 'three-quarter' ? multiply(matrix, QUARTER_LID) : matrix);
  return true;
}

export { QUARTER_LID, QUARTER_BASE, paintUsagiEventLaptopBase, paintUsagiEventProp };
