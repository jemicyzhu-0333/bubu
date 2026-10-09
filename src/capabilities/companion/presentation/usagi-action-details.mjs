'use strict';

import { applyPoint } from './rig/pose.mjs';
import { contactWeight, posedPropPoint } from './usagi-contact.mjs';

function stroke(context, color, width, draw) {
  context.beginPath(); draw(); context.strokeStyle = color;
  context.lineWidth = width; context.lineCap = 'round'; context.lineJoin = 'round'; context.stroke();
}

function steam(context, point, t, calm) {
  for (let i = 0; i < 2; i += 1) {
    const age = calm ? .35 : (t * 2 + i * .5) % 1;
    const x = point[0] + (i ? 1.7 : -1.7), y = point[1] - 2 - age * 5;
    context.save(); context.globalAlpha *= (1 - age) * .65;
    stroke(context, '#a7afb1', .85, () => {
      context.moveTo(x, y); context.bezierCurveTo(x - 2, y - 1.8, x + 2, y - 3.5, x, y - 5.5);
    }); context.restore();
  }
}

function drawUsagiActionDetails(context, { artwork, layer = 'front', action } = {}) {
  if (layer !== 'front' || !artwork) return false;
  const { sample, world } = artwork.pose, data = artwork.rig.views[artwork.drawnView];
  const t = sample.contactPhase || 0, calm = sample.calmVisual;
  const has = id => sample.props.includes(id);
  const wrist = side => applyPoint(world[`hand_${side}`], ...data.bones[`hand_${side}`].pivot);
  context.save();
  if (Number.isFinite(action?.propOpacity)) context.globalAlpha *= action.propOpacity;
  if (has('cup')) steam(context, posedPropPoint(artwork, 'cup', [0, -3]), t, calm);
  if (has('pan')) {
    const bowl = posedPropPoint(artwork, 'pan', [-7, 3.6]), hand = wrist('l');
    stroke(context, '#97735b', 1.55, () => { context.moveTo(...hand); context.lineTo(bowl[0] - 1.5, bowl[1]); });
    context.beginPath(); context.ellipse(bowl[0] - 1.5, bowl[1], 2, .85, -.3, 0, Math.PI * 2);
    context.fillStyle = '#c19c72'; context.fill(); steam(context, bowl, t, calm);
  }
  if (has('watering-can')) {
    const amount = contactWeight(t, .12, .34, .66, .9), spout = posedPropPoint(artwork, 'watering-can', [11, -4]);
    if (amount > .02) for (let i = 0; i < 4; i += 1) {
      const age = calm ? i / 4 : (t * 4 + i / 4) % 1;
      const x = spout[0] + (62 - spout[0]) * age, y = spout[1] + (55 - spout[1]) * age;
      context.globalAlpha *= amount;
      stroke(context, '#8ebcca', .85, () => { context.moveTo(x, y); context.lineTo(x + .35, y + 1.3); });
    }
  }
  if (has('needle-l') && has('needle-r')) {
    const left = posedPropPoint(artwork, 'needle-l', [4, -5]), right = posedPropPoint(artwork, 'needle-r', [4, -5]);
    stroke(context, '#aa8fbd', .7, () => {
      context.moveTo(...left); context.quadraticCurveTo((left[0] + right[0]) / 2, Math.max(left[1], right[1]) + 3, ...right);
      context.quadraticCurveTo(47, 62, 52, 62);
    });
  }
  if (has('book') && sample.motion === 'read') {
    const turn = contactWeight(t, .4, .56, .62, .8);
    if (turn > .01) {
      context.beginPath(); context.moveTo(33, 48); context.quadraticCurveTo(42 - turn * 14, 43, 44 - turn * 11, 46);
      context.lineTo(44 - turn * 11, 57); context.quadraticCurveTo(38 - turn * 10, 56, 33, 60); context.closePath();
      context.fillStyle = '#fff7e7'; context.fill(); context.strokeStyle = '#aba397'; context.lineWidth = .65; context.stroke();
    }
  }
  if (has('pen') && sample.motion === 'write') {
    const tip = posedPropPoint(artwork, 'pen', [-1.6, 6]);
    stroke(context, '#858c96', .65, () => { context.moveTo(tip[0] - 3, tip[1] + .3); context.lineTo(...tip); });
  }
  if (has('camera') && !calm && t > .46 && t < .53) {
    const amount = Math.sin((t - .46) / .07 * Math.PI);
    context.globalAlpha *= amount;
    stroke(context, '#edcd7b', 1.2, () => { context.moveTo(41, 38); context.lineTo(41, 35);
      context.moveTo(46, 40); context.lineTo(48, 38); });
  }
  context.restore(); return true;
}

export { drawUsagiActionDetails };
