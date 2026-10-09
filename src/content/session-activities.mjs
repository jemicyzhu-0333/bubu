'use strict';

import * as expressionLibrary from './expressions.mjs';

const petSessionActivitiesApi = (() => {
const petBehaviorExpressionSource = expressionLibrary;
const { EXPECTED_EXPRESSION_IDS } = petBehaviorExpressionSource;
function sessionActivity(id, state, label, icon, motion, prop, expression, durationMs) {
  return Object.freeze({
    id, state, label, icon, motion, prop, expression,
    durationMs: Math.max(20_000, Math.round(durationMs))
  });
}

const SESSION_ACTIVITIES = Object.freeze({
  'focus-read': sessionActivity('focus-read', 'focused', '读书', '📖', 'read', 'book', 'work.focus', 42_000),
  'focus-type': sessionActivity('focus-type', 'focused', '打字', '⌨', 'type', 'keyboard', 'work.deep-focus', 36_000),
  'focus-write': sessionActivity('focus-write', 'focused', '写文档', '✎', 'write', 'document', 'work.focus', 44_000),
  'focus-browse': sessionActivity('focus-browse', 'focused', '浏览网页', '▣', 'browse', 'laptop', 'work.switch', 38_000),
  'focus-charts': sessionActivity('focus-charts', 'focused', '看行情', '↗', 'trade', 'chart', 'work.deep-focus', 34_000),
  'focus-notes': sessionActivity('focus-notes', 'focused', '整理便签', '▤', 'organize', 'notes', 'work.wrap-up', 40_000),
  'rest-daydream': sessionActivity('rest-daydream', 'resting', '放空发呆', '◌', 'daydream', 'none', 'life.space', 38_000),
  'rest-nap': sessionActivity('rest-nap', 'resting', '打个小盹', 'zZ', 'doze', 'pillow', 'life.sleep', 48_000),
  'rest-tea': sessionActivity('rest-tea', 'resting', '慢慢喝茶', '♨', 'sip', 'cup', 'work.rest', 36_000),
  'rest-stretch': sessionActivity('rest-stretch', 'resting', '伸展一下', '↟', 'stretch', 'none', 'react.relieved', 30_000),
  'rest-window': sessionActivity('rest-window', 'resting', '看看窗外', '☁', 'look', 'none', 'life.space', 40_000),
  'rest-plant': sessionActivity('rest-plant', 'resting', '照料小苗', '♧', 'water', 'watering-can', 'react.encouraging', 42_000)
});

const SESSION_ACTIVITY_ROTATIONS = Object.freeze({
  focused: Object.freeze([
    'focus-write', 'focus-type', 'focus-read', 'focus-browse', 'focus-notes', 'focus-charts'
  ]),
  resting: Object.freeze([
    'rest-daydream', 'rest-tea', 'rest-window', 'rest-nap', 'rest-stretch', 'rest-plant'
  ])
});

function validateSessionActivities(activities = SESSION_ACTIVITIES, rotations = SESSION_ACTIVITY_ROTATIONS) {
  const expectedStates = ['focused', 'resting'];
  for (const state of expectedStates) {
    const ids = rotations[state];
    if (!Array.isArray(ids) || ids.length < 6 || new Set(ids).size !== ids.length) {
      throw new TypeError(`invalid ${state} activity rotation`);
    }
    for (const id of ids) {
      const activity = activities[id];
      if (!activity || activity.id !== id || activity.state !== state || !activity.label
          || !activity.motion || !activity.prop || activity.durationMs < 20_000
          || !EXPECTED_EXPRESSION_IDS.includes(activity.expression)) {
        throw new TypeError(`invalid session activity: ${id}`);
      }
    }
  }
  return Object.freeze({
    focusCount: rotations.focused.length,
    restCount: rotations.resting.length,
    totalCount: Object.keys(activities).length
  });
}

const SESSION_ACTIVITY_STATS = validateSessionActivities();

// The activity mirror (ARCHITECTURE「活动镜像」): outside a focus session the companion can
// copy what the person is doing. One activity per mode, so it simply keeps going while the
// mode lasts. `mirror-ai` reuses each current form's laptop and ellipsis artwork.
const MIRROR_ACTIVITIES = Object.freeze({
  'mirror-music': sessionActivity('mirror-music', 'mirror-music', '听音乐', '♪', 'dance', 'music-notes', 'react.happy', 24_000),
  'mirror-coding': sessionActivity('mirror-coding', 'mirror-coding', '写代码', '⌨', 'type', 'keyboard', 'work.deep-focus', 36_000),
  'mirror-ai': sessionActivity('mirror-ai', 'mirror-ai', '和 AI 对话', '…', 'browse', 'ai-chat', 'life.attentive', 30_000)
});
const MIRROR_ROTATIONS = Object.freeze({
  'mirror-music': Object.freeze(['mirror-music']),
  'mirror-coding': Object.freeze(['mirror-coding']),
  'mirror-ai': Object.freeze(['mirror-ai'])
});
for (const [mode, ids] of Object.entries(MIRROR_ROTATIONS)) {
  for (const id of ids) {
    const activity = MIRROR_ACTIVITIES[id];
    if (!activity || activity.state !== mode || !EXPECTED_EXPRESSION_IDS.includes(activity.expression)) {
      throw new TypeError(`invalid mirror activity: ${id}`);
    }
  }
}

return {
  SESSION_ACTIVITIES,
  SESSION_ACTIVITY_ROTATIONS,
  SESSION_ACTIVITY_STATS,
  MIRROR_ACTIVITIES,
  MIRROR_ROTATIONS,
  validateSessionActivities
};

})();

export default petSessionActivitiesApi;
export const SESSION_ACTIVITIES = petSessionActivitiesApi.SESSION_ACTIVITIES;
export const SESSION_ACTIVITY_ROTATIONS = petSessionActivitiesApi.SESSION_ACTIVITY_ROTATIONS;
export const SESSION_ACTIVITY_STATS = petSessionActivitiesApi.SESSION_ACTIVITY_STATS;
export const validateSessionActivities = petSessionActivitiesApi.validateSessionActivities;
export const MIRROR_ACTIVITIES = petSessionActivitiesApi.MIRROR_ACTIVITIES;
export const MIRROR_ROTATIONS = petSessionActivitiesApi.MIRROR_ROTATIONS;
