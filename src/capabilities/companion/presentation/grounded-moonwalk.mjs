'use strict';

// A planted foot owns its world-space position until the other foot has
// completed its slide. Body and both shoe attachments sample this same clock.
const smooth = value => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };
const TARGETS = Object.freeze([-3, -3, -6, -6, -3, -3, 0, 0]);
function sampleGroundedMoonwalk(progress, calmVisual = false) {
  const p = Math.max(0, Math.min(1, Number(progress) || 0));
  if (calmVisual) return Object.freeze({ x: 0, feet: [{ x: 0, y: 0, r: 0 }, { x: 0, y: 0, r: 0 }], support: [0, 1] });
  const step = Math.max(0, Math.min(8, (p - .12) / .76 * 8));
  const index = Math.min(7, Math.floor(step)), t = step >= 8 ? 1 : step - index;
  const positions = [0, 0];
  for (let i = 0; i < index; i++) positions[i % 2] = TARGETS[i];
  const moving = index % 2;
  positions[moving] += (TARGETS[index] - positions[moving]) * smooth(t);
  const x = (positions[0] + positions[1]) / 2;
  // The travelling foot skims the floor; the opposite sole stays flat and
// stationary. A small toe lift reads at native size without detaching boots.
  const feet = positions.map((worldX, side) => ({ x: worldX - x,
    y: side === moving ? -(Math.sin(Math.PI * t) ** 2) * 1.8 : 0, r: 0 }));
  return Object.freeze({ x, feet: Object.freeze(feet.map(Object.freeze)),
    support: Object.freeze(t === 0 || t === 1 ? [0, 1] : [1 - moving]) });
}
export { sampleGroundedMoonwalk };
