import { onLocaleChanged } from '../../shared/interface/i18n.mjs';
import { createPlanningPreferencesView, comparisonValid, time } from '../ui/planning-preferences-view.mjs';
const ERRORS = Object.freeze({
  'guidance-preview-expired': '预览已到期，重新查看后可以确认。',
  'guidance-preview-capacity': '本次打开的预览较多，稍后可以再试。已有内容未改变。',
  'planning-preference-changed': '安排偏好已经变化，请重新核对。',
  'planning-preferences-full': '已有 24 条偏好，可以选择已有条目修改。',
  'planning-receipts-full': '本机偏好变更记录已达到 512 条，本次未保存；仍可以撤销最近一次变更。',
  'planning-preference-invalid': '时间段和偏好需要填写完整；结束时间应晚于开始时间。',
  'planning-proposal-source-changed': '这份建议的来源已经变化或停止引用，需要回到对话重新核对。',
  'planning-proposal-already-reviewed': '这份建议已经保存，可以在已有偏好中查看和修改。',
  'planning-proposal-unavailable': '这份对话建议暂时不可用。已有偏好未改变。',
  'planning-proposal-target-mismatch': '修改后的目标与原建议不一致，请重新打开原建议。',
  'self-report-history-changed': '自评记录范围已经变化，请重新核对。',
  'self-report-consent-required': '开启本机记录并积累足够自评后，才可以试用曲线。',
  'self-report-coverage-insufficient': '自评记录的数量或时间覆盖还不足。',
  'curve-trial-active': '已有一项试用，结束后才能开始另一项。',
  'curve-source-changed': '曲线参数已经变化，请重新比较。',
  'curve-comparison-changed': '曲线依据已经变化，请重新比较。',
  'curve-trial-step-outside-limit': '试用值超出本次可编辑范围。',
  'curve-trial-invalid': '参数、试用值或期限不完整。',
  'planning-undo-unavailable': '这次偏好变更已不能撤销。',
  'curve-undo-unavailable': '这项试用已结束或不能撤销。'
});
const DEFINITE_REFUSALS = new Set(['guidance-preview-expired', 'planning-preview-invalid', 'planning-preference-changed',
  'planning-proposal-source-changed', 'planning-proposal-already-reviewed', 'planning-receipts-full', 'planning-receipt-id-conflict',
  'self-report-history-changed', 'self-report-consent-invalid', 'curve-preview-invalid', 'curve-source-changed',
  'curve-comparison-changed', 'state-revision-conflict']);
const FIELDS = ['planningPreferenceTarget', 'planningStart', 'planningEnd', 'planningDemand', 'planningScope',
  'planningHistoryEnabled', 'planningHistoryClear', 'planningTrialParameter', 'planningTrialValue', 'planningTrialScope'];
const METHODS = Object.freeze({ preference: ['previewPlanningPreference', 'confirmPlanningPreference'],
  history: ['previewEnergyHistoryConsent', 'confirmEnergyHistoryConsent'], trial: ['previewEnergyCurveTrial', 'confirmEnergyCurveTrial'] });
const clone = value => structuredClone(value);
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const minute = (value, end = false) => end && value === '24:00' ? 1440
  : /^([01]\d|2[0-3]):[0-5]\d$/.test(value || '') ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : null;
function createPlanningPreferencesFeature({ document, client, $ = selector => document.querySelector(selector), now = () => Date.now() } = {}) {
  if (!client || typeof client.getPlanningGuidance !== 'function' || typeof client.cancelPlanningPreview !== 'function') throw new TypeError('planning feature requires scoped client and cancellation');
  const node = id => $(`#${id}`);
  const view = createPlanningPreferencesView({ $ });
  const listeners = [];
  let data = null, pending = null, recovery = null, confirming = false, busy = false, disposed = false, epoch = 0;
  let proposalContext = null;
  const visible = () => !disposed && node('settingGroupPlanning')?.open === true
    && !node('settingsMask')?.classList.contains('hidden');
  const say = message => view.text('planningStatus', message);
  function sync() {
    const locked = busy || Boolean(recovery);
    for (const id of FIELDS) if (node(id)) node(id).disabled = locked || !data;
    node('planningPreferenceTarget').disabled = locked || !data || Boolean(proposalContext);
    view.hide('planningProposalContext', !proposalContext);
    for (const id of ['planningPreferencePreview', 'planningHistoryPreview']) node(id).disabled = locked || !data;
    if (data && data.receiptCount >= data.receiptCapacity) node('planningPreferencePreview').disabled = true;
    node('planningTrialPreview').disabled = locked || !data?.coverage.eligible || Boolean(data?.trial.active)
      || Boolean(data?.trial.trial && data.trial.reason !== 'curve-trial-expired');
    node('planningPreferenceUndo').disabled = locked || !data?.preferenceUndo || now() >= data.preferenceUndo.expiresAt;
    node('planningTrialUndo').disabled = locked || !data?.trialUndo || now() >= data.trialUndo.expiresAt;
    node('planningConfirm').disabled = busy || confirming || !(recovery || pending)
      || !recovery && now() >= pending.value.confirmationExpiresAt;
    node('planningCancel').disabled = confirming;
    node('planningRefresh').disabled = busy || confirming;
  }
  async function releaseTicket(ticket) {
    if (!ticket || typeof ticket.value?.previewId !== 'string') return { ok: true, cancelled: false };
    // A confirmation attempt owns its identity until its outcome is established.
    if (recovery && recovery.kind === ticket.kind && recovery.value.previewId === ticket.value.previewId) return { ok: false, recovery: true };
    try { return await client.cancelPlanningPreview({ kind: ticket.kind, previewId: ticket.value.previewId }); }
    catch (_) { return { ok: false, reason: 'preview-cancellation-unconfirmed' }; }
  }
  function showRecovery() {
    if (!recovery || !visible()) return;
    view.review(recovery.value, recovery.kind);
    view.text('planningConfirm', '重试核对这次保存');
    say(confirming ? '确认请求正在处理，结果尚未核对。' : '保存结果暂时无法确认。重新读取或重试会核对同一次请求，不会创建另一项变更。');
  }
  async function invalidate(message = '') {
    const abandoned = pending, token = ++epoch; pending = null; busy = false;
    view.hide('planningReview', true); view.hide('planningCurveComparison', true);
    if (recovery) showRecovery(); else if (message) say(message);
    sync();
    const result = await releaseTicket(abandoned);
    if (token === epoch && visible() && abandoned && !result?.ok && !recovery) say('预览已隐藏，但取消结果尚未确认。重新读取后可以核对。');
    return result;
  }
  function recoveredFromView() {
    if (!recovery || confirming) return false;
    if (recovery.kind === 'preference' && data.preferenceUndo?.receiptId === recovery.value.previewId) return true;
    return recovery.kind === 'trial' && data.trial?.trial?.id === recovery.value.trial.id;
  }
  async function reload({ quiet = false } = {}) {
    if (!visible() || confirming) { if (confirming) showRecovery(); return; }
    const abandoned = pending, token = ++epoch; pending = null; busy = true; view.hide('planningReview', true); sync();
    await releaseTicket(abandoned);
    if (token !== epoch || !visible()) return;
    try {
      const result = await client.getPlanningGuidance();
      if (token !== epoch || !visible()) return;
      if (!result?.ok || !result.view || !Array.isArray(result.view.parameters)) throw new Error('planning-read-unavailable');
      data = clone(result.view); view.data(data, now()); view.parameter(data);
      if (recoveredFromView()) { recovery = null; say('已核对上次确认的本机变更。'); }
      else if (recovery) showRecovery();
      else if (!quiet) say('已读取本机设置。变更会先显示预览。');
    } catch (_) { if (token === epoch && visible()) { data = null; say(recovery ? '保存结果仍待核对，确认请求的标识已保留。' : '暂时无法读取本机设置，已有内容未改变。'); } }
    finally { if (token === epoch) { busy = false; sync(); } }
  }
  function read(kind) {
    if (kind === 'preference') return { id: node('planningPreferenceTarget').value || null,
      startMinute: minute(node('planningStart').value), endMinute: minute(node('planningEnd').value, true),
      demand: node('planningDemand').value, scope: node('planningScope').value };
    if (kind === 'history') return { enabled: node('planningHistoryEnabled').checked, clearHistory: node('planningHistoryClear').checked };
    return { parameter: node('planningTrialParameter').value, to: Number(node('planningTrialValue').value), scope: node('planningTrialScope').value };
  }
  function proposalMatches(value, context) {
    return value?.provenance?.conversationId === context.conversationId
      && value.provenance.proposalId === context.proposalId && typeof value.provenance.messageId === 'string';
  }
  function fillPreference(input) {
    node('planningPreferenceTarget').value = input.id || '';
    node('planningStart').value = time(input.startMinute); node('planningEnd').value = time(input.endMinute);
    node('planningDemand').value = input.demand; node('planningScope').value = input.scope;
  }
  async function reviewProposal({ conversationId, proposalId } = {}) {
    if (recovery || confirming || !visible() || typeof client.previewPlanningProposal !== 'function') return;
    const context = { conversationId, proposalId }, abandoned = pending, token = ++epoch;
    proposalContext = context; pending = null; busy = true; view.hide('planningReview', true); sync();
    await releaseTicket(abandoned);
    if (token !== epoch || !visible()) return;
    try {
      const loaded = await client.getPlanningGuidance();
      if (token !== epoch || !visible()) return;
      if (!loaded?.ok || !loaded.view) throw new Error('planning-read-unavailable');
      data = clone(loaded.view); view.data(data, now()); view.parameter(data);
      const result = await client.previewPlanningProposal(context);
      const returned = { kind: 'preference', value: result };
      if (token !== epoch || !visible()) { await releaseTicket(returned); return; }
      if (!result?.ok) { say(ERRORS[result?.reason] || '这份对话建议暂时不能核对，已有偏好未改变。'); return; }
      const input = { id: result.before?.id || null, startMinute: result.after?.startMinute, endMinute: result.after?.endMinute,
        demand: result.after?.demand, scope: result.after?.scope };
      if (!proposalMatches(result, context) || !matches(result, 'preference', input)) {
        await releaseTicket(returned); say('返回的预览与这份对话建议不一致，请重新打开。'); return;
      }
      fillPreference(input);
      pending = { kind: 'preference', input: clone(input), value: clone(result) };
      view.review(result, 'preference'); say('对话建议已带入，可以修改时间段、难度和期限。确认后才保存。');
      node('planningStart')?.focus();
    } catch (_) { if (token === epoch && visible()) say('对话建议读取未完成，已有偏好未改变。'); }
    finally { if (token === epoch) { busy = false; sync(); } }
  }
  function matches(value, kind, input) {
    if (!value?.ok || typeof value.previewId !== 'string' || !Number.isFinite(value.confirmationExpiresAt)
      || value.confirmationExpiresAt <= now()) return false;
    if (kind === 'preference') return value.after && (input.id === null ? value.before === null : value.before?.id === input.id && value.after.id === input.id)
      && ['startMinute', 'endMinute', 'demand', 'scope'].every(key => value.after[key] === input[key]);
    if (kind === 'history') return value.enabled === input.enabled && value.clearHistory === input.clearHistory
      && value.expectedVersion === data.coverage.version && value.deletionCount === (input.clearHistory ? data.retainedReportCount : 0)
      && value.historicalBackfill === false && value.externalTransmission === false;
    return value.trial && ['parameter', 'to', 'scope'].every(key => value.trial[key] === input[key])
      && value.coverage?.eligible === true && comparisonValid(value.comparison);
  }
  async function preview(kind) {
    if (busy || recovery || !data || !visible() || !METHODS[kind]) return;
    const input = read(kind);
    const proposal = kind === 'preference' && proposalContext ? clone(proposalContext) : null;
    if (kind === 'preference' && (input.startMinute === null || input.endMinute === null || input.endMinute <= input.startMinute)) {
      invalidate(ERRORS['planning-preference-invalid']); return;
    }
    if (kind === 'trial' && (!data.coverage.eligible || data.trial.active)) { say('当前还不能开始新的曲线试用。'); return; }
    const abandoned = pending, token = ++epoch; pending = null; busy = true; view.hide('planningReview', true); sync();
    await releaseTicket(abandoned);
    if (token !== epoch || !visible()) return;
    try {
      const result = proposal ? await client.previewPlanningProposal({ ...proposal, input }) : await client[METHODS[kind][0]](input);
      const returned = { kind, value: result };
      if (token !== epoch || !visible()) { await releaseTicket(returned); return; }
      if (!same(input, read(kind))) { await releaseTicket(returned); await invalidate('表单已改变，请重新查看变更。'); return; }
      if (!result?.ok) { say(ERRORS[result?.reason] || '暂时无法准备预览，已有内容未改变。'); return; }
      if (!matches(result, kind, input) || proposal && !proposalMatches(result, proposal)) { await releaseTicket(returned); if (token === epoch && visible()) say('返回的预览与当前选择不一致，请重新读取。'); return; }
      pending = { kind, input: clone(input), value: clone(result) }; view.review(result, kind); say('预览已准备好，尚未保存。');
    } catch (_) { if (token === epoch && visible()) say('预览未成功，已有内容未改变。'); }
    finally { if (token === epoch) { busy = false; sync(); } }
  }
  async function confirm() {
    if (busy || confirming || !(recovery || pending) || !visible()) return;
    const retry = Boolean(recovery);
    if (!retry && now() >= pending.value.confirmationExpiresAt) { await invalidate(ERRORS['guidance-preview-expired']); return; }
    if (!retry && !same(pending.input, read(pending.kind))) { await invalidate('表单已改变，请重新查看变更。'); return; }
    const selected = clone(recovery || pending);
    recovery = selected; pending = null; confirming = true; busy = true; ++epoch; sync();
    try {
      const result = await client[METHODS[selected.kind][1]]({ previewId: selected.value.previewId });
      // Close/edit may hide the UI, but cannot discard this confirmation outcome.
      if (result?.ok) {
        recovery = null; confirming = false; busy = false;
        if (selected.kind === 'preference') proposalContext = null;
        if (visible()) {
          view.hide('planningReview', true);
          say(selected.kind === 'trial' ? '曲线试用已开始，到期后恢复原参数。' : selected.kind === 'history' ? '本机自评记录范围已更新。' : '安排偏好已保存，自评保持原样。');
          await reload({ quiet: true });
        }
      } else if (retry && result?.committed !== false || result?.ok !== false || result.uncertain === true
        || result.committed === true || !DEFINITE_REFUSALS.has(result.reason)) {
        confirming = false; busy = false; showRecovery();
        if (visible()) say('这次请求的结果仍无法确认；原标识已保留，请重新读取并核对当前记录。');
      } else {
        recovery = null; confirming = false; busy = false;
        await releaseTicket(selected);
        if (visible()) { view.hide('planningReview', true); say(ERRORS[result?.reason] || '尚未确认保存，请重新核对。'); await reload({ quiet: true }); }
      }
    } catch (_) { confirming = false; busy = false; showRecovery(); }
    finally { confirming = false; busy = false; sync(); }
  }
  async function undo(kind) {
    if (busy || recovery || !data || !visible()) return;
    const request = clone(kind === 'trial' ? data.trialUndo : data.preferenceUndo);
    if (!request || now() >= request.expiresAt) { say('当前没有可撤销的变更。'); return; }
    const abandoned = pending, token = ++epoch; pending = null; busy = true; view.hide('planningReview', true); sync();
    await releaseTicket(abandoned);
    if (token !== epoch || !visible()) return;
    try {
      const method = kind === 'trial' ? 'undoEnergyCurveTrial' : 'undoPlanningPreference';
      const payload = kind === 'trial' ? { trialId: request.trialId, expectedVersion: request.expectedVersion }
        : { receiptId: request.receiptId, expectedVersion: request.expectedVersion };
      const result = await client[method](payload);
      if (token !== epoch || !visible()) return;
      say(result?.ok ? kind === 'trial' ? '试用已结束，保留已发生的自评。' : '上次偏好变更已撤销。' : ERRORS[result?.reason] || '无法撤销，请重新读取后核对。');
      await reload({ quiet: true });
    } catch (_) { if (token === epoch && visible()) say('撤销结果暂时无法确认，请重新读取。'); }
    finally { if (token === epoch) { busy = false; sync(); } }
  }
  function selectPreference() {
    invalidate(); const id = node('planningPreferenceTarget').value;
    const item = data?.storedPreferences.find(candidate => candidate.id === id);
    if (!item) return;
    node('planningStart').value = time(item.startMinute); node('planningEnd').value = time(item.endMinute);
    node('planningDemand').value = item.demand; node('planningScope').value = item.scope;
  }
  function close() { proposalContext = null; return invalidate(); }
  function on(id, event, handler) { const target = node(id); if (target) { target.addEventListener(event, handler); listeners.push(() => target.removeEventListener(event, handler)); } }
  function init() {
    listeners.push(onLocaleChanged(view.repaintCopy));
    for (const [id, value] of Object.entries({ planningStart: '13:00', planningEnd: '17:00', planningDemand: 'low', planningScope: 'today', planningTrialParameter: 'chronotypeShift', planningTrialScope: 'today' })) if (node(id) && !node(id).value) node(id).value = value;
    for (const [kind, id] of Object.entries({ preference: 'planningPreferenceForm', history: 'planningHistoryForm', trial: 'planningTrialForm' })) on(id, 'submit', event => { event.preventDefault(); void preview(kind); });
    for (const id of FIELDS) for (const event of ['input', 'change']) on(id, event, () => invalidate(pending ? '表单已改变，请重新查看变更。' : ''));
    on('planningPreferenceTarget', 'change', selectPreference);
    on('planningTrialParameter', 'change', () => { invalidate(); view.parameter(data); });
    on('planningConfirm', 'click', () => { void confirm(); });
    on('planningCancel', 'click', () => invalidate('预览已关闭。'));
    on('planningRefresh', 'click', () => { void reload(); });
    on('planningPreferenceUndo', 'click', () => { void undo('preference'); });
    on('planningTrialUndo', 'click', () => { void undo('trial'); });
    on('settingGroupPlanning', 'toggle', () => { if (visible()) { if (!proposalContext) void reload(); } else close(); });
    on('btnSettings', 'click', () => { void Promise.resolve().then(() => { if (visible() && !proposalContext) return reload(); }); });
    on('btnSettingsClose', 'click', () => close());
    on('settingsMask', 'mousedown', event => { if (event.target === node('settingsMask')) close(); });
    if (typeof client.onPopoverHidden === 'function') {
      const unsubscribe = client.onPopoverHidden(() => close());
      if (typeof unsubscribe === 'function') listeners.push(unsubscribe);
    }
    sync(); if (visible()) void reload();
  }
  function dispose() { disposed = true; close(); for (const remove of listeners.splice(0)) remove(); }
  return Object.freeze({ init, dispose, reload, preview, confirm, undo, invalidate, reviewProposal });
}
export { createPlanningPreferencesFeature };
