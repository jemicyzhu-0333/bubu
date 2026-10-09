import { energyPath } from './energy-path.mjs';
const DEMAND = Object.freeze({ low: '轻一些的事', medium: '一般难度的事', high: '需要更多投入的事' });
const SCOPE = Object.freeze({ today: '今天', '7days': '七天', saved: '保存为偏好' });
const PARAMETER = Object.freeze({ chronotypeShift: '曲线时段偏移', morningRampMinutes: '上午上升时长' });
const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const time = minute => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
const date = value => value === null ? '不设到期' : new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
function preferenceDescription(item) {
  return `${time(item.startMinute)}–${time(item.endMinute)} · ${DEMAND[item.demand]} · ${SCOPE[item.scope]}`;
}
function comparisonValid(value) {
  return value && value.sampleMinutes === 15 && ['current', 'proposed'].every(key => Array.isArray(value[key])
    && value[key].length === 96 && value[key].every(level => Number.isFinite(level) && level >= 10 && level <= 90));
}
function createPlanningPreferencesView({ $ }) {
  const node = id => $(`#${id}`);
  const text = (id, value) => { if (node(id)) node(id).textContent = value; };
  const hide = (id, value) => node(id)?.classList.toggle('hidden', value);
  function data(view, now) {
    const selected = node('planningPreferenceTarget')?.value || '';
    const items = view.storedPreferences || [];
    node('planningPreferenceTarget').innerHTML = '<option value="">新增偏好</option>' + items.map(item =>
      `<option value="${escape(item.id)}">${escape(preferenceDescription(item))}${item.expiresAt !== null && now >= item.expiresAt ? ' · 已到期' : ''}</option>`).join('');
    node('planningPreferenceTarget').value = items.some(item => item.id === selected) ? selected : '';
    text('planningPreferenceSummary', (items.length ? `已保存 ${items.length}/24 条偏好` : '暂无安排偏好')
      + (view.receiptCount >= view.receiptCapacity ? ' · 变更记录已满，暂不能保存新修改' : ''));
    node('planningHistoryEnabled').checked = view.collectionEnabled;
    node('planningHistoryClear').checked = false;
    const c = view.coverage;
    text('planningCoverage', `本机保留 ${view.retainedReportCount} 条。近 30 天：${c.sampleCount} 条有效自评，${c.coveredDays} 个日期，跨度 ${Math.floor(c.elapsedDays)} 天。${c.missingPredictionCount ? `其中 ${c.missingPredictionCount} 条没有当时的估计，不能据此推算偏差。` : ''}`);
    const trial = view.trial;
    text('planningTrialStatus', trial.active ? `正在试用：${PARAMETER[trial.trial.parameter]} ${trial.trial.from} → ${trial.trial.to} 分钟；${date(trial.trial.expiresAt)} 到期。`
      : trial.trial ? `试用目前未应用：${trial.reason === 'curve-trial-expired' ? '已到期' : '依据或参数已变化'}。可以恢复或重新核对。`
        : c.eligible ? '可以比较曲线并试用，效果尚待观察。' : !c.consentEnabled ? '开启自评记录后可积累试用所需的样本。' : '现有自评覆盖不足，暂不提供曲线试用。');
  }
  function parameter(view, reset = true) {
    const key = node('planningTrialParameter')?.value || 'chronotypeShift';
    const value = view?.parameters.find(candidate => candidate.parameter === key);
    if (!value || value.current === null) { text('planningTrialBounds', '当前参数暂不可用。'); return; }
    const min = Math.max(value.minimum, value.current - value.maximumStep);
    const max = Math.min(value.maximum, value.current + value.maximumStep);
    const input = node('planningTrialValue'); input.min = String(min); input.max = String(max);
    if (reset) input.value = String(value.current < max ? max : min);
    text('planningTrialBounds', `当前 ${value.current} 分钟 · 可选 ${min}–${max} 分钟`);
  }
  function review(value, kind) {
    hide('planningReview', false);
    text('planningReviewTitle', kind === 'history' ? '自评记录范围' : kind === 'trial' ? '曲线试用预览' : '安排偏好预览');
    let lines;
    if (kind === 'preference') lines = `${value.provenance ? '来源：对话中的安排建议；本次只保存安排偏好。\n' : ''}${value.before ? `原来：${preferenceDescription(value.before)}\n` : '新增一条偏好\n'}确认后：${preferenceDescription(value.after)}\n有效至：${date(value.after.expiresAt)}\n自评和个人观测保持原样。`;
    if (kind === 'history') lines = `新的自评记录：${value.enabled ? '开启，仅本机' : '关闭'}\n清除已有历史：${value.deletionCount} 条${value.clearHistory ? '，确认后不可撤销' : '，继续保留'}\n不补写历史，不清除当前最近一次自评。`;
    if (kind === 'trial') lines = `${PARAMETER[value.trial.parameter]}：${value.trial.from} → ${value.trial.to} 分钟\n自评依据：${value.coverage.sampleCount} 条，${value.coverage.coveredDays} 个日期\n确认时开始，${date(value.trial.expiresAt)} 到期；可以随时结束试用。\n样本覆盖不证明调整有效，也不能说明身体状况。`;
    text('planningReviewText', lines);
    text('planningReviewExpiry', `此预览可确认至 ${date(value.confirmationExpiresAt)}；修改表单后需要重新预览。`);
    hide('planningCurveComparison', kind !== 'trial');
    node('planningCurveComparison').innerHTML = kind === 'trial' && comparisonValid(value.comparison)
      ? `<p class="capability-note">实线：当前估计　虚线：建议估计</p><svg viewBox="0 0 480 100" role="img" aria-label="当前与建议的非医学能量估计曲线"><path class="planning-current-curve" d="${energyPath(value.comparison.current, 480, 100)}"/><path class="planning-proposed-curve" d="${energyPath(value.comparison.proposed, 480, 100)}"/></svg><div class="planning-curve-axis"><span>00:00</span><span>12:00</span><span>24:00</span></div>` : '';
    text('planningConfirm', kind === 'history' ? '确认记录范围' : kind === 'trial' ? '确认开始试用' : '确认保存偏好');
  }
  return Object.freeze({ data, parameter, review, text, hide });
}
export { createPlanningPreferencesView, comparisonValid, time };
