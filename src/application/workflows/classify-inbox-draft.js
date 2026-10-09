'use strict';

const work = require('../../capabilities/work');
const guidance = require('../../capabilities/guidance');

// A person's label replaces the AI suggestion. Any non-state label withdraws only
// that capture's AI correction (ARCHITECTURE「收件分类与原文历史」).
// The caller owns the draft, complete write set and single business commit.
function classifyInboxDraft(state, { id, category, routineKind = null, level = null }) {
  const result = work.inboxRecords.classifyImpulse(state, { id, category, routineKind, level });
  if (result.ok && category !== 'state') guidance.energySignals.removeImpulseEnergySignal(state, id);
  return result;
}

module.exports = { classifyInboxDraft };
