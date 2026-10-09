'use strict';

function reportSafely(reportError, error, fact) {
  try {
    const pending = reportError(error, fact);
    if (pending && typeof pending.catch === 'function') pending.catch(() => {});
  } catch {}
}

function runPostCommitEffect(effect, fact, reportError = () => {}) {
  try {
    const pending = effect(fact);
    if (pending && typeof pending.catch === 'function') {
      pending.catch(error => reportSafely(reportError, error, fact));
    }
    return true;
  } catch (error) {
    reportSafely(reportError, error, fact);
    return false;
  }
}

module.exports = { runPostCommitEffect };
