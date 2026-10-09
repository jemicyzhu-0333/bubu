'use strict';
const { createFeedCompanionWorkflow } = require('../application');
const { runPostCommitEffect } = require('../shared/post-commit-effects');

function createCompanionFeeding({ announceBond, publishChange, reportEffectError = () => {}, invalidateMealAdvice = () => {}, ...ports }) {
  const workflow = createFeedCompanionWorkflow({ ...ports, reportEffectError,
    publish: fact => {
      runPostCommitEffect(invalidateMealAdvice, fact, reportEffectError);
      if (fact.bond) runPostCommitEffect(() => announceBond(fact.bond), fact, reportEffectError);
      // All canonical feed fields use the sampled, versioned shared publisher.
      runPostCommitEffect(() => publishChange({ companion: true, pet: true }), fact, reportEffectError);
    }
  });
  return Object.freeze({ register(registerIpc) {
    registerIpc('pet:feed', (_event, request) => workflow.execute(request));
  } });
}
module.exports = { createCompanionFeeding };
