// Read-only synthetic multi-store history. These IDs and receipts are fixtures,
// not evidence of writes in a real profile or of a live browser/native review.
function installSyntheticProposalStatuses({ surfaceClient, record }) {
  const examples = [
    { id: 'synthetic-memory', kind: 'memory-candidate', store: 'memory', status: 'applied',
      body: { memoryCandidate: { kind: 'preference', subject: '合成记忆示例', body: '先列两条事实', scope: 'work', expiresAt: null } } },
    { id: 'synthetic-planning', kind: 'planning-preference-candidate', store: 'planning', status: 'reverted',
      body: { planningPreference: { startMinute: 540, endMinute: 600, demand: 'low', scope: '7days' } } }
  ];
  for (const example of examples) record.messages.push({ id: `${example.id}-message`, role: 'assistant',
    content: '合成历史示例：独立确认的结果在对应分组中核对。',
    proposal: { id: example.id, kind: example.kind, version: 1, body: JSON.stringify(example.body) } });
  surfaceClient.getConversationProposalStatus = async ({ proposalIds }) => ({ ok: true, items: proposalIds.map(proposalId => {
    const example = examples.find(item => item.id === proposalId);
    return { proposalId, store: example?.store || 'config', status: example?.status || 'proposal',
      receiptId: example ? `${proposalId}-fixture-receipt` : null, version: example ? 2 : null,
      targetId: example ? `${proposalId}-fixture-target` : null, historyStatus: example ? 'pending' : null };
  }) });
}
export { installSyntheticProposalStatuses };
