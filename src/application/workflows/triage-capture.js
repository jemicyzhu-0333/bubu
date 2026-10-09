'use strict';

// 随手记分拣（ARCHITECTURE「AI 与 LLM」）：闪念保存之后，在后台问一次模型“这是什么、该去哪儿”，
// 把答案作为建议挂回这条闪念。建议本身不改任何别的数据——转任务、记日常、记状态都要本人
// 在收件箱里点一下。置信度不够就不挂，界面上它就是一条普通闪念。
const work = require('../../capabilities/work');
const preferences = require('../../capabilities/preferences');
const { runPostCommitEffect } = require('../../shared/post-commit-effects');

const TRIAGE_CAPTURE_WRITES = Object.freeze(['impulses']);
const MIN_TRIAGE_CONFIDENCE = 60;
const MAX_TRIAGE_AGE_MS = 30 * 60 * 1000;

function enabled(state) {
  const settings = preferences.normalizeSettings(state && state.settings);
  return settings.aiBreakdownEnabled === true && settings.aiCaptureTriageEnabled === true;
}

function createTriageCaptureWorkflow({
  unitOfWork, readSnapshot, clock, triage, requestScope, publish = () => {}, reportEffectError = () => {}
} = {}) {
  if (!unitOfWork || typeof unitOfWork.run !== 'function' || typeof readSnapshot !== 'function'
      || !clock || typeof clock.now !== 'function' || typeof triage !== 'function') {
    throw new TypeError('triage-capture workflow requires state, clock and triage ports');
  }

  async function performCaptured(fact, assertCurrent) {
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
    let answered;
    try {
      answered = await triage({ impulseText: expectedText });
    } catch (error) {
      reportEffectError(error);
      return { ok: true, changed: false, reason: 'provider-failed' };
    }
    if (!answered || answered.ok !== true || !answered.triage) {
      return { ok: true, changed: false, reason: (answered && answered.reason) || 'provider-failed' };
    }
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
    if (!transaction.ok) return { ok: true, changed: false, reason: transaction.reason };
    if (transaction.committed) {
      runPostCommitEffect(publish, Object.freeze({ type: 'impulse-triaged', impulseId: fact.impulseId }), reportEffectError);
    }
    return { ok: true, changed: Boolean(transaction.committed) };
  }

  async function handleCaptured(fact) {
    let lease;
    try {
      lease = requestScope?.begin();
      return await performCaptured(fact, () => lease?.assertCurrent());
    } catch (error) {
      if (error.message === 'provider-request-aborted') {
        return { ok: true, changed: false, reason: 'provider-request-aborted' };
      }
      throw error;
    } finally { lease?.release(); }
  }

  return Object.freeze({ handleCaptured });
}

module.exports = { createTriageCaptureWorkflow, MIN_TRIAGE_CONFIDENCE };
