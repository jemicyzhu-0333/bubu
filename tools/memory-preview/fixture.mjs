import { createPopoverMemoryList } from '../../src/surfaces/popover/features/memory-list.mjs';

// No Electron bridge, real provider, profile storage or business writes.
const $ = selector => document.querySelector(selector);
const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const at = Date.UTC(2026, 9, 4, 12);
let sequence = 0;
const rows = ['active', 'candidate', 'paused', 'removed'].map((status, index) => ({ id: `synthetic-memory-${index}`, version: 2,
  kind: index === 1 ? 'context' : 'preference', subject: ['工作安排', '只适用于本周', '旧的时间偏好', '已移入回收区'][index],
  body: ['开始写报告时先写一句事实', '这周下午有会议，安排只用于本周', '下午先做更简单的事', '这是一条合成已移除记录'][index],
  status, sourceType: index === 1 ? 'model-proposed' : 'user-statement', sourceRefs: [{ kind: 'message', id: 'synthetic-source', revision: null }],
  confirmedAt: index === 1 ? null : at, validFrom: at, expiresAt: index === 1 ? at + 604800000 : null,
  scope: 'work', privacyLevel: 'standard', createdAt: at, updatedAt: at, lastUsedAt: index === 0 ? at : null,
  useCount: index === 0 ? 2 : 0, contextAllowed: status === 'active', conflictIds: [] }));
const surfaceClient = {
  async listMemories({ status, limit = 20 } = {}) { return { ok: true, availability: 'available', items: rows.filter(row => !status || row.status === status).slice(0, limit), nextCursor: null }; },
  async previewMemoryChange(request) {
    const before = rows.find(row => row.id === request.targetId) || null;
    const after = request.operation === 'permanent-remove' ? null : ['add', 'update'].includes(request.operation)
      ? { ...rows[0], ...before, ...request.input, id: before?.id || 'synthetic-new-memory', version: (before?.version || 0) + 1 }
      : { ...before, version: before.version + 1, status: ({ activate: 'active', pause: 'paused', remove: 'removed', restore: 'paused' })[request.operation] };
    return { ok: true, preview: { previewId: `synthetic-preview-${++sequence}`, previewHash: 'f'.repeat(64), expectedVersion: before?.version || null,
      operation: request.operation, expiresAt: at + 300000, before, after, affectedIds: [before?.id || after.id],
      invalidatedSourceRefs: before?.sourceRefs || [], permanent: request.operation === 'permanent-remove', undoExpiresAt: before && request.operation !== 'permanent-remove' ? at + 600000 : null } };
  },
  async confirmMemoryChange() { return { ok: false, reason: 'synthetic-readonly-preview' }; },
  async cancelMemoryChange() { return { ok: true }; }
};
$('#appShell').inert = true; $('#settingsMask').classList.remove('hidden'); $('#settingsMask').setAttribute('aria-hidden', 'false');
$('#settingGroupAi').open = true;
const feature = createPopoverMemoryList({ $, escapeHTML, surfaceClient, now: () => at }); feature.mount(); await feature.load();
$('#memoryTitle').textContent = 'AI 记得什么 · 合成只读预览';
$('#memoryStatus').textContent = '本页只使用合成记录；确认按钮不会保存、移除或外发数据。';
$('#memorySection').scrollIntoView({ block: 'start' });
