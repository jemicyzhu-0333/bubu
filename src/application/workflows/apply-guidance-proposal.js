'use strict';
const { CREATE_WORK_ITEM_WRITES } = require('./create-work-item');
const { UPDATE_WORK_ITEM_WRITES } = require('./update-work-item');
const { runPostCommitEffect } = require('../../shared/post-commit-effects');
const APPLY_GUIDANCE_PROPOSAL_WRITES = Object.freeze([...new Set([...CREATE_WORK_ITEM_WRITES, ...UPDATE_WORK_ITEM_WRITES])]);
function createApplyGuidanceProposalWorkflow({ proposalStore, updateWorkItemWorkflow, createWorkItemCommand, consumeBreakdownProposal, reportEffectError = () => {} }) {
  function execute({ proposalId, steps, targetTaskId, scope }) {
    const stored = proposalStore.get(proposalId);
    if (!stored) return { ok: false, reason: 'proposal-expired' };
    if (!stored.context || stored.context.kind !== 'breakdown') {
      return { ok: false, reason: 'proposal-kind-mismatch' };
    }
    // Applying a suggestion to an existing task goes through the same task edit
    // transaction as manual step editing. The proposal only decides what is
    // offered; the write path, its refusals, its recurrence scope requirement and
    // its reward budget stay unchanged.
    const requestedTaskId = targetTaskId || stored.context.taskId;
    if (requestedTaskId) {
      if (stored.context.taskId !== requestedTaskId) {
        return { ok: false, reason: 'proposal-target-mismatch' };
      }
      const operations = (Array.isArray(steps) ? steps : [])
        .map(step => (step && typeof step.title === 'string' ? step.title.trim() : ''))
        .filter(Boolean)
        .map(title => ({ op: 'add', title }));
      if (operations.length === 0) return { ok: false, reason: 'proposal-empty' };
      const applied = updateWorkItemWorkflow.execute({
        taskId: requestedTaskId,
        patch: { steps: operations },
        scope
      });
      if (!applied.ok) return applied;
      runPostCommitEffect(() => consumeBreakdownProposal(proposalId, 'proposal-applied'), { proposalId }, reportEffectError);
      return applied;
    }
    const created = createWorkItemCommand.execute({
      task: {
        title: stored.context.title,
        description: stored.context.description,
        energy: 'auto',
        steps
      },
      breakdown: true
    });
    if (!created.ok) return created;
    runPostCommitEffect(() => consumeBreakdownProposal(proposalId, 'proposal-applied'), { proposalId }, reportEffectError);
    return created;

  }
  return Object.freeze({ execute });
}
module.exports = { APPLY_GUIDANCE_PROPOSAL_WRITES, createApplyGuidanceProposalWorkflow };
