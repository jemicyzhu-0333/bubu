'use strict';

const { runPostCommitEffect } = require('../../../shared/post-commit-effects');

function presentLevelUp(reward, { notify, presentExpression, reportEffectError } = {}) {
  if (!reward || !reward.leveledUp) return;
  const effects = [
    () => notify({ title: `🌟 升级！Lv.${reward.level}`, body: '你积累的每一个真实行动都算数。' }),
    () => presentExpression('react.celebrate', { source: 'essential', ttlMs: 3500, minHoldMs: 900 })
  ];
  for (const effect of effects) runPostCommitEffect(effect, reward, reportEffectError);
}

module.exports = { presentLevelUp };
