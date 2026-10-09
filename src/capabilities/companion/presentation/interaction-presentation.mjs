'use strict';

const clamp = value => Math.max(0, Math.min(1, Number(value) || 0));
const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
const isPurr = action => action?.interactionId === 'longPress' && action.id === 'tail-wiggle';
const isSummon = action => action?.interactionId === 'click-30' && action.id === 'magic-trick';
const isFireworks = action => action?.interactionId === 'click-20' && action.id === 'spin';
const isFacingInteraction = action => isPurr(action) || isSummon(action) || isFireworks(action);

// These are input-specific performances, not additional ambient actions or
// persistence IDs. A normal tail wag and hat trick keep their original art.
function sampleInteractionPresentation(action, progress, { calmVisual = false } = {}) {
  if (!isFacingInteraction(action)) return null;
  const t = calmVisual ? .5 : clamp(progress), purr = isPurr(action);
  const phase = Object.freeze({ index: t < .2 ? 0 : t < .78 ? 1 : 2, count: 3,
    label: isFireworks(action) ? (t < .2 ? '第一朵烟花' : t < .78 ? '慢慢绽放' : '收好星光')
      : purr ? (t < .2 ? '抬头回应' : t < .78 ? '安心呼噜' : '轻轻回望')
      : (t < .2 ? '邀请小星' : t < .78 ? '小星来啦' : '挥别小星'),
    timelineProgress: t, progress: t });
  const expression = purr ? 'react.petted' : 'react.happy';
  return Object.freeze({ action: Object.freeze({ ...action, motion: 'breathe', prop: 'none', effect: 'none',
    expression, baseExpression: expression, faceCue: expression, interactionProgress: t,
    interactionView: 'front', sequencePhase: phase }), progress: t, phase });
}

function sampleInteractionFace(expression, action, progress, calmVisual = false) {
  if (!isFacingInteraction(action)) return null;
  const t = calmVisual ? .5 : clamp(progress), purr = isPurr(action);
  const content = t >= .18 && t <= .82;
  return Object.freeze({ ...expression, eyes: content ? 'content' : 'neutral', mouth: 'smile',
    openness: 1, eyeOffsetX: purr ? 0 : content ? .5 : 0, eyeOffsetY: 0, eyeInsetX: 0 });
}

function heart(context, x, y, size, alpha) {
  context.save(); context.translate(x, y); context.scale(size, size); context.globalAlpha *= alpha;
  context.fillStyle = '#edb8c2'; context.beginPath(); context.moveTo(0, 3);
  context.bezierCurveTo(-6, -1, -3, -5, 0, -2); context.bezierCurveTo(3, -5, 6, -1, 0, 3);
  context.fill(); context.restore();
}

function drawFireworks(context, t, calmVisual) {
  const blooms = [[-13, 15, .01, '#e4bd7e'], [82, 4, .22, '#ceaec9'], [77, 37, .44, '#a4c7d2']];
  for (const [x, y, start, color] of blooms) {
    const age = calmVisual ? .46 : (t - start) / .25;
    if (age <= 0 || age >= 1) continue;
    const radius = 2 + smooth(Math.min(1, age / .72)) * 11;
    context.save(); context.globalAlpha *= calmVisual ? .65 : Math.sin(Math.PI * age) * .85;
    context.fillStyle = color; context.strokeStyle = color; context.lineWidth = .8;
    for (let i = 0; i < 8; i += 1) {
      const a = i * Math.PI / 4, dx = Math.cos(a), dy = Math.sin(a);
      context.beginPath(); context.moveTo(x + dx * radius * .55, y + dy * radius * .55);
      context.lineTo(x + dx * radius * .85, y + dy * radius * .85); context.stroke();
      context.fillRect(x + dx * radius - 1, y + dy * radius - 1, 2, 2);
    }
    context.restore();
  }
}

// Native art coordinates, inside the existing body/face/wardrobe transform.
// A slow reveal uses actual shape and presence, with no font glyph or asset load.
function drawInteractionLayer(context, action, progress, { layer, calmVisual = false } = {}) {
  if (layer !== 'front' || !isFacingInteraction(action)) return false;
  const t = calmVisual ? .5 : action.interactionProgress ?? clamp(progress);
  if (isFireworks(action)) { drawFireworks(context, t, calmVisual); return true; }
  const appear = calmVisual ? 1 : smooth(t / .2) * smooth((1 - t) / .18);
  if (isPurr(action)) {
    const breath = calmVisual ? 0 : Math.sin(Math.PI * t * 2);
    heart(context, -6, 29 - breath * 1.2, .7, appear * .7);
    heart(context, 73, 24 + breath, .5, appear * .5);
    return true;
  }
  const reveal = calmVisual ? 1 : smooth((t - .12) / .24) * smooth((.98 - t) / .18);
  const y = 47 - reveal * 15 + (calmVisual ? 0 : Math.sin(Math.PI * t * 2) * 1.2);
  context.save(); context.globalAlpha *= appear;
  context.strokeStyle = '#c9b9d8'; context.lineWidth = .9;
  context.beginPath(); context.moveTo(69, 61);
  context.bezierCurveTo(69, 57.5, 89, 57.5, 89, 61);
  context.bezierCurveTo(89, 64.5, 69, 64.5, 69, 61); context.stroke();
  context.globalAlpha *= reveal; context.translate(79, y);
  const scale = .55 + reveal * .45; context.scale(scale, scale);
  context.fillStyle = '#f5df9f'; context.strokeStyle = '#b9a57a'; context.lineWidth = 1;
  context.lineJoin = 'round'; context.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const angle = -Math.PI / 2 + i * Math.PI / 5, radius = i % 2 ? 6.3 : 11;
    const x = Math.cos(angle) * radius, yy = Math.sin(angle) * radius;
    if (i) context.lineTo(x, yy); else context.moveTo(x, yy);
  }
  context.closePath(); context.fill(); context.stroke();
  context.fillStyle = '#776b63';
  for (const x of [-3, 3]) { context.beginPath(); context.arc(x, -.5, .85, 0, Math.PI * 2); context.fill(); }
  context.strokeStyle = '#776b63'; context.lineWidth = .65;
  context.beginPath(); context.moveTo(-1, 2); context.quadraticCurveTo(0, 3.4, 1, 2); context.stroke();
  context.restore(); return true;
}

export { isFacingInteraction, sampleInteractionPresentation, sampleInteractionFace, drawInteractionLayer };
