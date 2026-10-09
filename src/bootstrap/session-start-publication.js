'use strict';

const { runPostCommitEffect } = require('../shared/post-commit-effects');

// Publish a committed start even if an earlier presentation effect fails.
function createSessionStartPublisher({ notify, focusPet = () => {}, recordTimeline, publish, reportEffectError }) {
  return fact => {
    if (fact.quick) runPostCommitEffect(() => notify({
      delivery: 'companion', title: '2 分钟启动',
      body: '只做下一步。两分钟后你可以停、续 8 分钟或进入完整一轮。'
    }), fact, reportEffectError);
    runPostCommitEffect(focusPet, fact, reportEffectError);
    runPostCommitEffect(() => recordTimeline({
      session: fact.session, taskId: fact.taskId, startedAt: fact.startedAt
    }), fact, reportEffectError);
    runPostCommitEffect(() => publish({
      pomodoro: true, stats: true, nowTask: true, quickStartDecision: true,
      ...(fact.clarified ? { tasks: true, recommendations: true } : {})
    }), fact, reportEffectError);
  };
}

module.exports = { createSessionStartPublisher };
