'use strict';

// 随手记分拣（ARCHITECTURE「AI 与 LLM」）：闪念保存之后，在后台问一次模型“这是什么、该去哪儿”，
// 把答案作为建议挂回这条闪念。建议本身不改任何别的数据——转任务、记日常、记状态都要本人
// 在收件箱里点一下。置信度不够就不挂，界面上它就是一条普通闪念。
const work = require('../../capabilities/work');
const { beginDiagnostic, observeDiagnostic, finishDiagnostic } = require('../ai/diagnostic-observation');
const preferences = require('../../capabilities/preferences');
const { runPostCommitEffect } = require('../../shared/post-commit-effects');
const { createCaptureTriageStatus } = require('../ai/capture-triage-status');

const TRIAGE_CAPTURE_WRITES = Object.freeze(['impulses']);
const MIN_TRIAGE_CONFIDENCE = 60;
const MAX_TRIAGE_AGE_MS = 30 * 60 * 1000;

function enabled(state) {
  const settings = preferences.normalizeSettings(state && state.settings);
  return settings.aiBreakdownEnabled === true && settings.aiCaptureTriageEnabled === true;
}

function createTriageCaptureWorkflow({
  unitOfWork, readSnapshot, clock, triage, requestScope, diagnostics, publish = () => {}, publishStatus = () => {}, reportEffectError = () => {}
} = {}) {
  if (!unitOfWork || typeof unitOfWork.run !== 'function' || typeof readSnapshot !== 'function'
      || !clock || typeof clock.now !== 'function' || typeof triage !== 'function') {
    throw new TypeError('triage-capture workflow requires state, clock and triage ports');
  }

  const status = createCaptureTriageStatus({ readSnapshot, publish: () =>
    runPostCommitEffect(publishStatus, Object.freeze({ type: 'capture-triage-status' }), reportEffectError) });

  async function performCaptured(fact, assertCurrent, token, diagnostic) {
    const before = readSnapshot();
    if (!enabled(before)) return { ok: true, changed: false, reason: 'capture-triage-disabled' };
    if (!fact || fact.type !== 'impulse-captured' || typeof fact.impulseId !== 'string'
        || !Number.isFinite(fact.capturedAt)) {
      return { ok: true, changed: false, reason: 'impulse-stale' };
    }
    const impulse = work.impulseInbox.findImpulse(before, fact.impulseId);
    if (!impulse || impulse.createdAt !== fact.capturedAt
        || clock.now() - fact.capturedAt > MAX_TRIAGE_AGE_MS) {
      return { ok: true, changed: false, reason: 'impulse-stale' };
    }
    const expectedText = impulse.text;
    let answered, failureCode;
    status.running(token);
    try {
      answered = await triage({ impulseText: expectedText }, { onFailure: detail => { failureCode = detail.reason; }, ...(diagnostic ? { diagnostics: diagnostic } : {}) });
    } catch (error) {
      reportEffectError(error);
      return { ok: true, changed: false, reason: 'provider-failed' };
    }
    if (!answered || answered.ok !== true || !answered.triage) {
      return { ok: true, changed: false, reason: (answered && answered.reason) || 'provider-failed',
        ...(failureCode ? { failureCode } : {}) };
    }
    observeDiagnostic(diagnostic, 'gate', { confidence: answered.triage.confidence, minimum: MIN_TRIAGE_CONFIDENCE,
      accepted: answered.triage.confidence >= MIN_TRIAGE_CONFIDENCE, code: 'classification-confidence' });
    if (answered.triage.confidence < MIN_TRIAGE_CONFIDENCE) {
      return { ok: true, changed: false, reason: 'capture-triage-unsure' };
    }
    const at = clock.now();
    assertCurrent();
    const transaction = unitOfWork.run({
      writes: TRIAGE_CAPTURE_WRITES,
      context: { now: at },
      transition: state => (enabled(state)
        ? work.impulseInbox.annotateImpulseTriage(state, {
          impulseId: fact.impulseId, expectedText, triage: { ...answered.triage, at }
        })
        : { ok: false, reason: 'capture-triage-disabled' })
    });
    if (!transaction.ok) return { ok: true, changed: false, reason: transaction.reason,
      failureCode: 'capture-triage-apply-failed' };
    if (transaction.committed) {
      runPostCommitEffect(publish, Object.freeze({ type: 'impulse-triaged', impulseId: fact.impulseId }), reportEffectError);
    }
    return { ok: true, changed: Boolean(transaction.committed) };
  }

  async function handleCaptured(fact) {
    let lease, result;
    const token = status.begin(fact);
    const diagnostic = beginDiagnostic(diagnostics, 'capture-triage', fact);
    try {
      lease = requestScope?.begin();
      result = await performCaptured(fact, () => lease?.assertCurrent(), token, diagnostic);
      return result;
    } catch (error) {
      if (error.message === 'provider-request-aborted') {
        result = { ok: true, changed: false, reason: 'provider-request-aborted' };
        return result;
      }
      result = { reason: 'capture-triage-unavailable' };
      throw error;
    } finally {
      let observed = result;
      try { lease?.assertCurrent(); } catch (_) { observed = { reason: 'provider-request-aborted' }; }
      lease?.release();
      status.finish(token, observed);
      finishDiagnostic(diagnostic, result, 'suggestion-saved');
    }
  }

  return Object.freeze({ handleCaptured, readStatus: status.read, dispose: status.dispose });
}

module.exports = { createTriageCaptureWorkflow, MIN_TRIAGE_CONFIDENCE };
