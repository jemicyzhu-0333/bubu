'use strict';

const DIRTY_FIELDS = Object.freeze({
  tasks: ['tasks', 'taskFilters'],
  archivedTasks: ['archivedTasks', 'history'],
  recurrenceSeries: ['recurrenceSeries'],
  impulses: ['impulses', 'inboxHistoryTotal', 'inboxHistoryCountVersion'],
  // 等级会改变橱窗里哪些配饰解锁,所以 appearance 跟着 stats 走;换皮肤会改变
  // 自动兜底选中的那一件,所以也跟着 skin 走。appearance 自己那条只在“佩戴/恢复
  // 默认”时用——那次写入不动等级也不动皮肤,单独一条能让 delta 只带这一个字段。
  stats: ['stats', 'xp', 'level', 'levelCost', 'foodTickets', 'feedState', 'companionProjection', 'foodShop', 'appearance'],
  settings: ['settings', 'work', 'focusMinutes', 'autoExpiryPreview', 'ai'],
  skin: ['skins', 'currentSkin', 'theme', 'appearance', 'companionProjection', 'foodShop', 'feedState'],
  appearance: ['appearance'],
  pet: ['companionProjection', 'foodShop', 'foodTickets', 'feedState'],
  energy: ['energy', 'energyCheckIn', 'energyCurve'],
  // 起床时间与情绪记录：起床时间会改今天的曲线，所以连能量一起带上。
  wellbeing: ['wake', 'moodNotes', 'energy', 'energyCheckIn', 'energyCurve'],
  recommendations: ['recommendations', 'nowTaskId', 'nowTask'],
  nowTask: ['nowTaskId', 'nowTask'],
  pomodoro: ['pomodoro', 'focusSession', 'quickStartDecision', 'quickStartResolutionPending', 'focusLandingPrompt'],
  focusSession: ['pomodoro', 'focusSession', 'quickStartDecision', 'quickStartResolutionPending', 'focusLandingPrompt'],
  quickStartDecision: ['quickStartDecision', 'quickStartResolutionPending'],
  focusLandingPrompt: ['focusLandingPrompt'],
  companion: ['companionProjection', 'foodShop'],
  strategy: ['strategy'],
  // 日常的列表与今天的打卡是同一份投影里的一个字段:清单变了、打了一次卡,面板要
  // 重画的是同一块。曲线也在这里 —— 打一次咖啡的卡就改变了今天剩下的形状,漏掉
  // 它的表现是「打完卡曲线不动,等下一次自评才跳一下」。
  routines: ['routines', 'energyCurve'],
  timeline: [],
  // 活动镜像只投影一个类别与接入状态，不含应用名。
  activity: ['activityMirror'],
  reviews: ['reviews'],
  migrationNotices: ['migrationNotices']
});

function buildStateDelta(state, dirty = {}) {
  if (!state || typeof state !== 'object') throw new TypeError('state projection is required');
  if (dirty.all) return { ...state };
  const unknown = Object.keys(dirty).filter(flag => dirty[flag] && !Object.prototype.hasOwnProperty.call(DIRTY_FIELDS, flag));
  if (unknown.length) throw new TypeError(`unknown state dirty flag: ${unknown.join(', ')}`);
  const names = new Set(['serverNow', 'storageStatus']);
  for (const [flag, fields] of Object.entries(DIRTY_FIELDS)) {
    if (dirty[flag]) for (const field of fields) names.add(field);
  }
  // A task-only mutation can disable a paused session's rendered resume action.
  // Keep the existing quick-panel refresh owner and revision-gap protocol.
  if (dirty.tasks && state.pomodoro?.paused) names.add('pomodoro');
  if (dirty.tasks) {
    names.add('focusLandingPrompt');
    names.add('quickStartDecision');
  }
  const delta = {};
  for (const name of names) if (Object.prototype.hasOwnProperty.call(state, name)) delta[name] = state[name];
  return delta;
}

function applyStateDelta(current, message) {
  if (!message || !Number.isSafeInteger(message.revision) || message.revision < 1) {
    return { applied: false, reason: 'invalid-revision', state: current };
  }
  const previousRevision = current && Number.isSafeInteger(current.revision) ? current.revision : 0;
  if (message.revision <= previousRevision) return { applied: false, reason: 'stale-revision', state: current };
  if (message.revision !== previousRevision + 1 && !(message.dirty && message.dirty.all)) {
    return { applied: false, reason: 'revision-gap', state: current };
  }
  const delta = message.delta || message.state;
  if (!delta || typeof delta !== 'object' || Array.isArray(delta)) {
    return { applied: false, reason: 'invalid-delta', state: current };
  }
  return { applied: true, reason: null, state: { ...(current || {}), ...delta, revision: message.revision } };
}

const stateChannelApi = { DIRTY_FIELDS, buildStateDelta, applyStateDelta };


export default stateChannelApi;
export { DIRTY_FIELDS, buildStateDelta, applyStateDelta };
