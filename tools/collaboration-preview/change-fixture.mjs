// Synthetic change proposals for visual inspection of production UI components.
// This module never writes canonical state, calls a provider or claims that a
// browser/native layout has been tested. Apply is intentionally unavailable.
function installSyntheticChanges({ surfaceClient, record, response }) {
  const taskId = 'synthetic-task';
  record.messages.push({ id: 'synthetic-change-message', role: 'assistant', sequence: record.messages.length + 1,
    content: '合成建议：给报告一个更小的标题，并调整一条普通日常的将来提醒。',
    proposal: { id: 'synthetic-proposal', version: 7, kind: 'change-set', body: JSON.stringify({ operations: [
      { type: 'task.update', entityId: taskId, scope: 'current', patch: { title: '报告：先写一句事实', plannedFor: '2026-10-04' } },
      { type: 'routine.schedule', entityId: 'synthetic-meeting', schedule: { frequency: 'weekly', timesOfDay: ['15:00'], weekdays: [1, 3, 5], windowMinutes: 30 } }
    ] }) } });
  let version = 0;
  Object.assign(surfaceClient, {
    async getConversationContextChoices({ kind }) {
      return { ok: true, items: kind === 'task' ? [{ id: taskId, title: '整理报告' }]
        : kind === 'inbox' ? [{ id: 'synthetic-inbox', text: '合成收件原文：明天提醒我整理报告。' }]
          : [{ id: 'synthetic-meeting', title: '会议', kind: 'meeting' }], nextCursor: null, availability: 'available' };
    },
    async previewConversationChanges(args) {
      version++;
      const operations = args.operations || [
        { opId: 'synthetic-op-task', type: 'task.update', entityId: taskId, scope: 'current', patch: { title: '报告：先写一句事实', plannedFor: '2026-10-04' } },
        { opId: 'synthetic-op-routine', type: 'routine.schedule', entityId: 'synthetic-meeting', schedule: { frequency: 'weekly', timesOfDay: ['15:00'], weekdays: [1, 3, 5], windowMinutes: 30 } }
      ];
      const diff = operations.map(op => ({ opId: op.opId, type: op.type, entityRef: { kind: op.type.startsWith('routine.') ? 'routine' : 'task', id: op.entityId },
        fields: op.type.startsWith('routine.') ? [{ field: 'schedule', before: { frequency: 'daily', timesOfDay: ['09:00'], weekdays: [], windowMinutes: 30 }, after: op.schedule }]
          : Object.entries(op.patch).map(([field, after]) => ({ field, before: field === 'title' ? '整理报告' : null, after })),
        derivedChanges: [], reversibility: { status: 'available', reason: null } }));
      return { ok: true, changeSet: { conversationId: record.id, changeSetId: 'synthetic-change-set', proposalVersion: version,
        applyGroupId: 'synthetic-group', operationsHash: 'a'.repeat(64), previewHash: 'b'.repeat(64), disclosureHash: 'c'.repeat(64),
        operations: operations.map(op => ({ ...op, ...(op.type.startsWith('routine.') ? { timezone: 'Asia/Shanghai' } : {}) })), diff,
        applyGroups: [{ applyGroupId: 'synthetic-group', store: 'config', opIds: operations.map(op => op.opId) }],
        rationale: '仅用于检查显示的合成说明', evidenceRefs: [{ kind: 'message', id: 'synthetic-change-message', revision: null }],
        warnings: ['合成界面预览；确认按钮不会执行真实写入。'], reversibility: 'available' } };
    },
    async confirmConversationChanges() { return { ok: false, reason: 'synthetic-readonly-preview' }; },
    async cancelConversationChanges() { return { ok: true }; },
    async getConversationReceipts() { return { ok: true, items: [], nextCursor: null }; },
    async getConversationProposalStatus({ proposalIds }) {
      return { ok: true, items: proposalIds.map(proposalId => ({ proposalId, store: 'config', status: 'proposal',
        receiptId: null, version: null, targetId: null, historyStatus: null })) };
    }
  });
  const setScope = surfaceClient.setConversationScope;
  surfaceClient.setConversationScope = async args => {
    const result = await setScope(args);
    result.selection = { taskIds: args.taskIds || [], inboxIds: args.inboxIds || [], routineIds: args.routineIds || [], focusSummary: args.focusSummary };
    result.disclosure.provider = { model: '合成预览，无外发', endpoint: '本机 fixture' };
    result.contextPreview = [
      { availability: 'available', items: result.selection.taskIds.map(id => ({ id, title: '整理报告' })) },
      { availability: 'available', items: result.selection.inboxIds.map(id => ({ id, text: '合成收件原文：明天提醒我整理报告。' })) },
      { availability: 'available', items: result.selection.routineIds.map(id => ({ id, title: '会议', kind: 'meeting', schedule: { frequency: 'daily', timesOfDay: ['09:00'], weekdays: [], windowMinutes: 30 } })) }
    ];
    return result;
  };
}

export { installSyntheticChanges };
