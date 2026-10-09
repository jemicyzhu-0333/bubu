'use strict';
const { projectCompanionFeedState } = require('../application');

// Getters are pure. The meal runtime and manual commands own care changes;
// reads never charge elapsed hunger or allocate a meal decision.
function createPetQueries({ readSample, projectState, foods }) {
  return Object.freeze({
    getState() { return projectState(readSample()); },
    getFeedState() {
      const sample = readSample();
      return { ...(sample.feedState || projectCompanionFeedState(sample.snapshot, sample.now)), foods };
    }
  });
}
module.exports = { createPetQueries };
