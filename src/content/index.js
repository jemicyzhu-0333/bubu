'use strict';

const legacy = require('./legacy-pet-content');
const { DIALOGUE_PACK } = require('./dialogues');
const scenes = require('./scenes.mjs');
const behaviors = require('./behaviors.mjs');
const interactions = require('./interactions');
const sessionActivities = require('./session-activities.mjs');
const expressions = require('./expressions.mjs');
const appearance = require('./appearance.mjs');
const {
  assertDialogueLibrary,
  createFreshPicker,
  dialogueStats,
  mergeContentTrees
} = require('./registry');

const LINES = mergeContentTrees(legacy.LINES, DIALOGUE_PACK);
const DIALOGUE_STATS = Object.freeze(assertDialogueLibrary(LINES));
const pickFresh = createFreshPicker({ historySize: 18, rng: () => Math.random() });

function pickPool(pool, id) {
  return pickFresh(Array.isArray(pool) ? pool : [], id);
}

// 这里挑的是 LINES.energy 下的台词池名，和 guidance 里 low/medium/high 三档的
// 领域档位不是一回事：池子有五个，就分五段。名字对齐同文件的 workPoolId，避免被误读
// 成领域概念后被“统一”掉。
function energyPoolId(energyLevel) {
  if (energyLevel >= 80) return 'excellent';
  if (energyLevel >= 60) return 'good';
  if (energyLevel >= 35) return 'medium';
  if (energyLevel >= 15) return 'low';
  return 'empty';
}

function workPoolId({ hour, state, hoursIdle, workStart, workEnd }) {
  if (hour === workStart) return 'start';
  if (hour >= workEnd) return 'overtime';
  if (state === 'focused') return 'deepWork';
  if (Number(hoursIdle) >= 1) return 'reentry';
  const rotating = ['messages', 'review', 'creative', 'blocked', 'contextSwitch', 'admin'];
  return rotating[Math.abs(Math.round(hour)) % rotating.length];
}

function specialMomentIds(now) {
  const hour = now.getHours();
  const minute = now.getMinutes();
  const day = now.getDay();
  const date = now.getDate();
  const month = now.getMonth();
  const ids = [];
  if (day === 1) ids.push('monday');
  if (day === 5) ids.push('friday');
  if (day === 0 || day === 6) ids.push('weekend');
  if (date <= 2) ids.push('monthStart');
  if (date >= 28) ids.push('monthEnd');
  if (date <= 3 && [0, 3, 6, 9].includes(month)) ids.push('quarterStart');
  if (month === 0 && date <= 3) ids.push('yearStart');
  if (month === 11 && date >= 28) ids.push('yearEnd');
  if (hour === 3 && minute >= 30 && minute <= 36) ids.push('threethirtythree');
  if (hour === 11 && minute >= 9 && minute <= 13) ids.push('elevenEleven');
  if (hour === 12 && minute >= 32 && minute <= 36) ids.push('twelveThirtyFour');
  if (hour === 22 && minute >= 20 && minute <= 24) ids.push('twentyTwoTwentyTwo');
  if (hour < 1) ids.push('afterMidnight');
  if (hour >= 5 && hour <= 7) ids.push('sunrise');
  if (hour >= 17 && hour <= 19) ids.push('sunset');
  ids.push(['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter'][month]);
  return [...new Set(ids)];
}

function getContextualLine({
  hour = new Date().getHours(),
  state = 'idle',
  energyLevel = 60,
  hoursIdle = 0,
  workStart = 10,
  workEnd = 21,
  now = new Date()
} = {}) {
  const roll = Math.random();
  const period = legacy.getTimePeriod(hour, workStart, workEnd);
  const workId = workPoolId({ hour, state, hoursIdle, workStart, workEnd });
  const moments = specialMomentIds(now);

  if (roll < 0.16 && LINES.work[workId]) return pickPool(LINES.work[workId], `work.${workId}`);
  if (roll < 0.36 && LINES.time[period]) return pickPool(LINES.time[period], `time.${period}`);
  if (roll < 0.49) {
    const band = energyPoolId(Number(energyLevel));
    return pickPool(LINES.energy[band], `energy.${band}`);
  }
  if (roll < 0.72 && moments.length) {
    const moment = moments[Math.abs(now.getDate() + hour) % moments.length];
    return pickPool(LINES.special[moment], `special.${moment}`);
  }
  const stateId = LINES.state[state] ? state : 'idle';
  return pickPool(LINES.state[stateId], `state.${stateId}`);
}

module.exports = {
  ...legacy,
  ...scenes,
  ...behaviors,
  ...interactions,
  ...sessionActivities,
  ...expressions,
  ...appearance,
  LINES,
  DIALOGUE_STATS,
  dialogueStats: () => dialogueStats(LINES),
  getContextualLine,
  pick: values => pickPool(values, 'legacy.pick')
};
