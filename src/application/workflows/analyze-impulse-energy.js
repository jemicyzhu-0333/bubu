'use strict';

const work = require('../../capabilities/work');
const guidance = require('../../capabilities/guidance');
const preferences = require('../../capabilities/preferences');
const { runPostCommitEffect } = require('../../shared/post-commit-effects');

const ANALYZE_IMPULSE_ENERGY_WRITES = Object.freeze(['energySignals']);
const MIN_IMPULSE_ENERGY_CONFIDENCE = 70;
const MAX_IMPULSE_ANALYSIS_AGE_MS = 30 * 60 * 1000;

function enabled(state) {
  const settings = preferences.normalizeSettings(state && state.settings);
  return settings.aiBreakdownEnabled === true && settings.aiImpulseEnergyEnabled === true;
}

function eligibleClassification(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.confidence < MIN_IMPULSE_ENERGY_CONFIDENCE || value.direction === 'neutral') return null;
  if (!Number.isInteger(value.delta) || value.delta === 0) return null;
  if ((value.direction === 'up' && value.delta < 0)
      || (value.direction === 'down' && value.delta > 0)) return null;
  return value;
}

function freshImpulse(state, fact, expectedText, now) {
  if (!fact || fact.type !== 'impulse-captured'
      || typeof fact.impulseId !== 'string' || !Number.isFinite(fact.capturedAt)) return null;
  if (now < fact.capturedAt || now - fact.capturedAt > MAX_IMPULSE_ANALYSIS_AGE_MS) return null;
  const impulse = work.impulseInbox.findImpulse(state, fact.impulseId);
  if (!impulse || impulse.createdAt !== fact.capturedAt || impulse.text !== expectedText) return null;
  if (impulse.classification && impulse.classification.category !== 'state') return null;
  return impulse;
}

function createAnalyzeImpulseEnergyWorkflow({
  unitOfWork,
  readSnapshot,
  clock,
  classify,
  requestScope,
  publish = () => {},
  reportEffectError = () => {}
} = {}) {
  if (!unitOfWork || typeof unitOfWork.run !== 'function' || typeof readSnapshot !== 'function') {
    throw new TypeError('analyze-impulse-energy workflow requires state ports');
  }
  if (!clock || typeof clock.now !== 'function' || typeof classify !== 'function') {
    throw new TypeError('analyze-impulse-energy workflow requires clock and classifier ports');
  }
  if (typeof publish !== 'function' || typeof reportEffectError !== 'function') {
    throw new TypeError('analyze-impulse-energy workflow effects must be functions');
  }

  async function performCaptured(fact, assertCurrent) {
    const before = readSnapshot();
    if (!enabled(before)) return { ok: true, changed: false, reason: 'impulse-energy-disabled' };
    if (!fact || fact.type !== 'impulse-captured' || typeof fact.impulseId !== 'string') {
      return { ok: true, changed: false, reason: 'impulse-stale' };
    }
    const captured = work.impulseInbox.findImpulse(before, fact.impulseId);
    const source = freshImpulse(before, fact, captured && captured.text, clock.now());
    if (!source) return { ok: true, changed: false, reason: 'impulse-stale' };
    const expectedText = source.text;

    let analyzed;
    try {
      analyzed = await classify({ impulseText: expectedText });
    } catch (error) {
      reportEffectError(error);
      return { ok: true, changed: false, reason: 'provider-failed' };
    }
    if (!analyzed || analyzed.ok !== true) {
      return { ok: true, changed: false, reason: analyzed && analyzed.reason || 'provider-failed' };
    }
    const classification = eligibleClassification(analyzed.classification);
    if (!classification) return { ok: true, changed: false, reason: 'no-explicit-energy-signal' };

    const analyzedAt = clock.now();
    assertCurrent();
    const transaction = unitOfWork.run({
      writes: ANALYZE_IMPULSE_ENERGY_WRITES,
      context: { now: analyzedAt },
      transition: state => {
        if (!enabled(state) || !freshImpulse(state, fact, expectedText, analyzedAt)) {
          return { ok: false, reason: 'impulse-stale' };
        }
        return guidance.energySignals.recordEnergySignal(state, {
          id: fact.impulseId,
          source: 'impulse-ai',
          referenceId: fact.impulseId,
          at: fact.capturedAt,
          delta: classification.delta,
          confidence: classification.confidence,
          reason: classification.reason
        });
      }
    });
    if (!transaction.ok) return { ok: true, changed: false, reason: transaction.reason };
    if (transaction.committed) {
      runPostCommitEffect(publish, Object.freeze({
        type: 'impulse-energy-recorded',
        signal: transaction.signal,
        analyzedAt,
        revision: transaction.revision
      }), reportEffectError);
    }
    return { ok: true, changed: transaction.committed, signal: transaction.signal || null };
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

module.exports = {
  ANALYZE_IMPULSE_ENERGY_WRITES,
  MIN_IMPULSE_ENERGY_CONFIDENCE,
  MAX_IMPULSE_ANALYSIS_AGE_MS,
  createAnalyzeImpulseEnergyWorkflow
};
