import { t, getLocale } from '../../shared/interface/i18n.mjs';
import { energyPath } from './energy-path.mjs';
const DEMAND = Object.freeze({ low: '轻一些的事', medium: '一般难度的事', high: '需要更多投入的事' });
const SCOPE = Object.freeze({ today: '今天', '7days': '七天', saved: '保存为偏好' });
const PARAMETER = Object.freeze({ chronotypeShift: '曲线时段偏移', morningRampMinutes: '上午上升时长' });
const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const time = minute => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
const date = value => value === null ? t('不设到期') : new Date(value).toLocaleString(getLocale(), { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
function preferenceDescription(item) {
  return `${time(item.startMinute)}–${time(item.endMinute)} · ${t(DEMAND[item.demand])} · ${t(SCOPE[item.scope])}`;
}
function comparisonValid(value) {
  return value && value.sampleMinutes === 15 && ['current', 'proposed'].every(key => Array.isArray(value[key])
    && value[key].length === 96 && value[key].every(level => Number.isFinite(level) && level >= 10 && level <= 90));
}
function createPlanningPreferencesView({ $ }) {
  const node = id => $(`#${id}`);
  const copies = new Map();
  const text = (id, value) => {
    const paint = () => { if (node(id)) node(id).textContent = typeof value === 'function' ? value() : t(value); };
    copies.set(id, paint); paint();
  };
  const hide = (id, value) => node(id)?.classList.toggle('hidden', value);
  function data(view, now) {
    const selected = node('planningPreferenceTarget')?.value || '';
    const items = view.storedPreferences || [];
    const optionLabel = item => preferenceDescription(item) + (item.expiresAt !== null && now >= item.expiresAt ? t(' · 已到期') : '');
    node('planningPreferenceTarget').innerHTML = `<option value="">${t('新增偏好')}</option>` + items.map(item =>
      `<option value="${escape(item.id)}">${escape(optionLabel(item))}</option>`).join('');
    node('planningPreferenceTarget').value = items.some(item => item.id === selected) ? selected : '';
    copies.set('preferenceOptions', () => node('planningPreferenceTarget')?.querySelectorAll('option').forEach((option, index) => {
      option.textContent = index === 0 ? t('新增偏好') : optionLabel(items[index - 1]);
    }));
    text('planningPreferenceSummary', () => (items.length ? t('已保存 {count}/24 条偏好', { count: items.length }) : t('暂无安排偏好'))
      + (view.receiptCount >= view.receiptCapacity ? t(' · 变更记录已满，暂不能保存新修改') : ''));
    node('planningHistoryEnabled').checked = view.collectionEnabled;
    node('planningHistoryClear').checked = false;
    const c = view.coverage;
    text('planningCoverage', () => t('本机保留 {retained} 条。近 30 天：{samples} 条有效自评，{days} 个日期，跨度 {elapsed} 天。', { retained: view.retainedReportCount, samples: c.sampleCount, days: c.coveredDays, elapsed: Math.floor(c.elapsedDays) })
      + (c.missingPredictionCount ? t('其中 {count} 条没有当时的估计，不能据此推算偏差。', { count: c.missingPredictionCount }) : ''));
    const trial = view.trial;
    text('planningTrialStatus', () => trial.active ? t('正在试用：{parameter} {from} → {to} 分钟；{expiry} 到期。', { parameter: t(PARAMETER[trial.trial.parameter]), from: trial.trial.from, to: trial.trial.to, expiry: date(trial.trial.expiresAt) })
      : trial.trial ? t('试用目前未应用：{reason}。可以恢复或重新核对。', { reason: t(trial.reason === 'curve-trial-expired' ? '已到期' : '依据或参数已变化') })
        : t(c.eligible ? '可以比较曲线并试用，效果尚待观察。' : !c.consentEnabled ? '开启自评记录后可积累试用所需的样本。' : '现有自评覆盖不足，暂不提供曲线试用。'));
  }
  function parameter(view, reset = true) {
    const key = node('planningTrialParameter')?.value || 'chronotypeShift';
    const value = view?.parameters.find(candidate => candidate.parameter === key);
    if (!value || value.current === null) { text('planningTrialBounds', '当前参数暂不可用。'); return; }
    const min = Math.max(value.minimum, value.current - value.maximumStep);
    const max = Math.min(value.maximum, value.current + value.maximumStep);
    const input = node('planningTrialValue'); input.min = String(min); input.max = String(max);
    if (reset) input.value = String(value.current < max ? max : min);
    text('planningTrialBounds', () => t('当前 {current} 分钟 · 可选 {min}–{max} 分钟', { current: value.current, min, max }));
  }
  function review(value, kind) {
    hide('planningReview', false);
    text('planningReviewTitle', kind === 'history' ? '自评记录范围' : kind === 'trial' ? '曲线试用预览' : '安排偏好预览');
    text('planningReviewText', () => {
      if (kind === 'preference') return (value.provenance ? t('来源：对话中的安排建议；本次只保存安排偏好。') + '\n' : '')
        + (value.before ? t('原来：{preference}', { preference: preferenceDescription(value.before) }) : t('新增一条偏好'))
        + '\n' + t('确认后：{preference}\n有效至：{expiry}\n自评和个人观测保持原样。', { preference: preferenceDescription(value.after), expiry: date(value.after.expiresAt) });
      if (kind === 'history') return t('新的自评记录：{enabled}\n清除已有历史：{count} 条{effect}\n不补写历史，不清除当前最近一次自评。', { enabled: t(value.enabled ? '开启，仅本机' : '关闭记录'), count: value.deletionCount, effect: t(value.clearHistory ? '，确认后不可撤销' : '，继续保留') });
      if (kind === 'trial') return t('{parameter}：{from} → {to} 分钟\n自评依据：{samples} 条，{days} 个日期\n确认时开始，{expiry} 到期；可以随时结束试用。\n样本覆盖不证明调整有效，也不能说明身体状况。', { parameter: t(PARAMETER[value.trial.parameter]), from: value.trial.from, to: value.trial.to, samples: value.coverage.sampleCount, days: value.coverage.coveredDays, expiry: date(value.trial.expiresAt) });
      return '';
    });
    text('planningReviewExpiry', () => t('此预览可确认至 {expiry}；修改表单后需要重新预览。', { expiry: date(value.confirmationExpiresAt) }));
    hide('planningCurveComparison', kind !== 'trial');
    node('planningCurveComparison').innerHTML = kind === 'trial' && comparisonValid(value.comparison)
      ? `<p class="capability-note">${t('实线：当前估计　虚线：建议估计')}</p><svg viewBox="0 0 480 100" role="img" aria-label="${t('当前与建议的非医学能量估计曲线')}"><path class="planning-current-curve" d="${energyPath(value.comparison.current, 480, 100)}"/><path class="planning-proposed-curve" d="${energyPath(value.comparison.proposed, 480, 100)}"/></svg><div class="planning-curve-axis"><span>00:00</span><span>12:00</span><span>24:00</span></div>` : '';
    copies.set('comparison', () => {
      const host = node('planningCurveComparison');
      const caption = host?.querySelector('p'); if (caption) caption.textContent = t('实线：当前估计　虚线：建议估计');
      host?.querySelector('svg')?.setAttribute('aria-label', t('当前与建议的非医学能量估计曲线'));
    });
    text('planningConfirm', kind === 'history' ? '确认记录范围' : kind === 'trial' ? '确认开始试用' : '确认保存偏好');
  }
  // Only these copy callbacks run on language changes. They do not reset form values,
  // invalidate previews, refresh data, or alter the identity of a pending confirmation.
  function repaintCopy() { copies.forEach(paint => paint()); }
  return Object.freeze({ data, parameter, review, text, hide, repaintCopy });
}
export { createPlanningPreferencesView, comparisonValid, time };
