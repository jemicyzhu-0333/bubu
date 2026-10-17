'use strict';
// Small facial phrases for all 32 semantic expressions. Time is injected;
// nothing here changes the selected expression or produces a business event.
const EXPRESSION_PHRASES = Object.freeze({
  'life.idle': [5200, 'curious', 'smile', .7, -.2, .92],
  'life.wake': [4200, 'wide', 'talk', .3, -.3, 1],
  'life.sleep': [5200, 'closed', 'talk', 0, .12, 0],
  'life.drowsy': [5800, 'closed', 'open', .2, .25, .18],
  'life.space': [6200, 'half', 'neutral', 1.1, -.35, .8],
  'life.peek': [4300, 'wide', 'talk', .8, -.25, 1],
  'life.return': [4600, 'determined', 'closed', .5, .2, .88],
  'life.attentive': [3600, 'curious', 'talk', .9, -.25, 1],
  'work.ready': [4000, 'focused', 'neutral', .3, -.25, .85],
  'work.starting': [4500, 'focused', 'smile', .65, .2, .92],
  'work.focus': [5100, 'focused', 'closed', 1.1, .35, .8],
  'work.deep-focus': [6000, 'focused', 'neutral', .8, .25, .65],
  'work.pause': [5800, 'half', 'closed', .25, .2, .72],
  'work.resume': [3900, 'focused', 'smile', .6, -.25, .95],
  'work.rest': [5400, 'smile', 'talk', .35, -.15, .9],
  'work.switch': [4400, 'focused', 'closed', 1.1, .25, .85],
  'work.waiting': [5700, 'waiting', 'talk', .7, -.15, .9],
  'work.wrap-up': [4700, 'content', 'smile', .75, .3, .82],
  'react.happy': [3200, 'content', 'grin', .45, -.35, .95],
  'react.satisfied': [5200, 'smile', 'smile', .25, -.15, .9],
  'react.surprised': [3600, 'wide', 'talk', .6, -.3, 1],
  'react.petted': [4200, 'content', 'smile', .3, .2, .7],
  'react.encouraging': [3900, 'smile', 'open', .5, -.25, .95],
  'react.hungry': [5200, 'pleading', 'talk', .55, -.25, .86],
  'react.relieved': [5500, 'closed', 'smile', .2, .2, .25],
  'react.celebrate': [3000, 'smile', 'open', .6, -.4, 1],
  'system.thinking': [4800, 'curious', 'closed', .9, -.35, .85],
  'system.searching': [3900, 'focused', 'talk', 1.2, .15, .9],
  'system.processing': [5300, 'focused', 'neutral', .5, .25, .82],
  'system.unavailable': [6600, 'sleepy', 'closed', .15, .15, .65],
  'system.restricted': [6000, 'waiting', 'closed', .45, -.1, .92],
  'system.stopped': [5600, 'closed', 'closed', 0, .08, 0]
});
function sampleExpressionFace(base, id, elapsedMs = 0) {
  const phrase = EXPRESSION_PHRASES[id] || EXPRESSION_PHRASES['life.idle'];
  const [period, eyes, mouth, dx, dy, openness] = phrase;
  const time = Math.max(0, Number(elapsedMs) || 0);
  const p = (time % period) / period;
  const weight = Math.sin(Math.PI * p) ** 2;
  const speaking = p > .28 && p < .68;
  return Object.freeze({ ...base,
    eyes: speaking ? eyes : base.eyes,
    mouth: speaking ? mouth : base.mouth,
    eyeOffsetX: (base.eyeOffsetX || 0) + Math.sin(Math.PI * 2 * p) * dx,
    eyeOffsetY: (base.eyeOffsetY || 0) + weight * dy,
    openness: (base.openness ?? 1) + (openness - (base.openness ?? 1)) * weight
  });
}
export { EXPRESSION_PHRASES, sampleExpressionFace };
