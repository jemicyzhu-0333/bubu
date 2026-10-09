'use strict';

const { projectRecommendations: projectDomainRecommendations } = require('../domain/recommendations');

// Preserve the public two-argument query while keeping ambient time outside domain policy.
function projectRecommendations(input, taskStartBlockReason) {
  return projectDomainRecommendations(input, taskStartBlockReason, () => Date.now());
}

module.exports = { projectRecommendations };
