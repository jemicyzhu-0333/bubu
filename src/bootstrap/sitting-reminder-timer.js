'use strict';

function normalizeSamplers({ sample, onError, samplers }) {
  const source = Array.isArray(samplers)
    ? samplers
    : [{ name: 'hydration', sample, onError }];

  return source
    .filter(entry => entry && typeof entry.sample === 'function')
    .map((entry, index) => ({
      name: typeof entry.name === 'string' && entry.name ? entry.name : `sampler-${index + 1}`,
      sample: entry.sample,
      onError: typeof entry.onError === 'function'
        ? entry.onError
        : (typeof onError === 'function' ? onError : () => {})
    }));
}

function createSittingReminderTimer({ lifecycle, sample, onError, samplers }) {
  const activeSamplers = normalizeSamplers({ sample, onError, samplers });
  function reportError(sampler, error) {
    try {
      Promise.resolve(sampler.onError(error, sampler.name)).catch(() => {});
    } catch (_) { /* one broken error sink must not silence later samplers */ }
  }
  return () => lifecycle.interval('timer:hydration', () => {
    for (const sampler of activeSamplers) {
      try {
        Promise.resolve(sampler.sample()).catch(error => reportError(sampler, error));
      } catch (error) {
        reportError(sampler, error);
      }
    }
  }, 30 * 1000);
}

module.exports = { createSittingReminderTimer };
