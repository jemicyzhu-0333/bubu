'use strict';

import { createPathCache, paintShapes } from './rig/paint.mjs';

const TAU = Math.PI * 2;
const paths = createPathCache({ limit: 24 });
const shape = (d, fill, stroke = '#4b2c25', width = .9) => Object.freeze({
  d, fill, stroke, width, opacity: 1, m: [1, 0, 0, 1, 0, 0], cap: 'round', join: 'round'
});
// The generated study supplies only this little collaborator's geometry.
// Its blank pad is pretend play, never a progress/result from a real AI app.
const BODY = Object.freeze([
  shape('M4.2 15 Q3.4 17 4.6 21.3 L12 21.3 Q13.1 18 11.8 15Z', '#d8c3e8'),
  shape('M4.6 17.5 Q8 18.4 12.2 17.5 L11.8 20.1 Q8 20.8 4.5 19.8Z', '#fff3db', 'none'),
  shape('M4.7 21 L7.4 21.2 L7.4 23 Q4.4 24.2 3.9 22.4Z', '#fff3db'),
  shape('M10.6 21 L13 20.7 L14 22.2 Q12.2 23.8 10.5 23Z', '#fff3db')
]);
const HEAD = Object.freeze([
  shape('M6.8 3.2 L7.2 .8', 'none', '#4b2c25', .8),
  shape('M6.2 .9 Q6.1 -.4 7.4 -.4 Q8.6 -.3 8.3 .8 Q7.8 1.9 6.2 .9Z', '#d8c3e8'),
  shape('M2 4.3 Q6.2 2.6 11.8 4.1 Q15 5.2 14.7 10.4 Q14.8 14.7 11.7 15.1 L3.2 14.3 Q.4 13.8 .8 9.2 Q.7 5.8 2 4.3Z', '#fff3db'),
  shape('M2.8 5.4 L10.5 5.9 Q12.2 6.2 11.6 11.7 Q11.4 13.4 9.8 13.1 L2.7 12.2 Q1.6 11.6 1.9 8 Q1.9 5.7 2.8 5.4Z', '#b6dacf', '#4b2c25', .7),
  shape('M12.9 7.5 Q16.1 5.9 16.4 9.5 Q16.6 12.4 14.1 13.1 Q12.6 12.8 12.9 7.5Z', '#c5a8dc'),
  shape('M3.5 7.5 Q4 7.1 4.3 7.8 L4.1 9.6 Q3.8 10.3 3.3 9.7Z', '#4b2c25', 'none'),
  shape('M8.1 8 Q8.6 7.6 8.9 8.3 L8.7 10.1 Q8.3 10.6 7.9 10Z', '#4b2c25', 'none')
]);
const PAD = Object.freeze([
  shape('M11 16.4 L16.7 17 L15 23.3 L9.4 22.3Z', '#b8dacd'),
  shape('M12.4 16.5 L12.6 15.9 M14.2 16.8 L14.4 16.2 M16 17 L16.2 16.4', 'none', '#4b2c25', .65),
  shape('M15.7 20 Q18.2 19.1 18 21.2 Q17.1 23.3 15.4 22Z', '#fff3db')
]);
const HAND = Object.freeze([
  shape('M4.7 16.7 Q1.4 16.7 1.1 14.6 Q1.4 12.8 3.2 13.4 Q5.7 14.5 4.7 16.7Z', '#fff3db')
]);

// Includes outline, tilt, the full entering offset and foot-level motion.
const USAGI_EVENT_ROBOT_BOUNDS = Object.freeze({ x: 75, y: 37, width: 22, height: 28 });
function sampleUsagiEventRobot(artwork) {
  const primary = artwork?.pose?.sample?.event;
  const event = primary?.category === 'ai' ? primary
    : artwork?.combinationAccessories?.robot ? artwork.combinationAccessories.sample : null;
  if (!event || event.weight <= 0) return null;
  const t = event.calm ? 0 : TAU * event.p * 5;
  return Object.freeze({ x: 76 + (1 - event.weight) * 1.4, y: 39,
    opacity: event.weight, headTurn: -.035 + Math.sin(t) * .045,
    handY: event.calm ? 0 : .65 * (1 - Math.cos(t)),
    headY: event.calm ? 0 : .18 * Math.sin(t),
    bounds: USAGI_EVENT_ROBOT_BOUNDS });
}

function paintUsagiEventRobot(ctx, artwork, layer) {
  const pose = sampleUsagiEventRobot(artwork);
  if (!pose || layer !== 'front') return false;
  ctx.save(); ctx.globalAlpha *= pose.opacity;
  ctx.transform(...artwork.pose.world.root); ctx.translate(pose.x, pose.y);
  paintShapes(ctx, BODY, paths);
  ctx.save(); ctx.translate(7.8, 10 + pose.headY); ctx.rotate(pose.headTurn); ctx.translate(-7.8, -10);
  paintShapes(ctx, HEAD, paths); ctx.restore();
  paintShapes(ctx, PAD, paths);
  ctx.save(); ctx.translate(0, pose.handY); paintShapes(ctx, HAND, paths); ctx.restore();
  ctx.restore(); return true;
}

export { USAGI_EVENT_ROBOT_BOUNDS, sampleUsagiEventRobot, paintUsagiEventRobot };
