'use strict';

const ICONS = Object.freeze({
  ai: '<path d="M4 5h16v11H9l-5 4V5Z"/><path d="M8 9h8M8 12h5"/>',
  task: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="m8 12 3 3 5-6"/>',
  inbox: '<path d="M4 5h16v14H4Z"/><path d="M4 12h5l2 3h2l2-3h5"/>',
  routine: '<path d="M19 8a8 8 0 1 0 1 7M19 3v5h-5"/>',
  focus: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'
});
function timelineCategory(entry) {
  if (entry.type === 'focus' || entry.marker?.kind?.startsWith('session.')) return 'focus';
  if (entry.marker?.change) return 'ai';
  if (entry.marker?.kind?.startsWith('task.')) return 'task';
  if (entry.marker?.kind?.startsWith('inbox.')) return 'inbox';
  if (entry.marker?.kind?.startsWith('routine.')) return 'routine';
  return 'other';
}
function timelineIcon(category) {
  const path = ICONS[category];
  return path ? `<svg class="tl-type-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">${path}</svg>` : '';
}
function storedClock(at, offset) {
  if (!Number.isInteger(offset)) return null;
  return new Date(at + offset * 60000).toISOString().slice(11, 16);
}
function changeDescription(marker) {
  if (marker.redactionState === 'redacted') return { label: '内容已移除', verb: '记录', category: 'muted' };
  if (marker.visibility === 'private') return { label: '私密记录', verb: '记录', category: 'muted' };
  if (marker.kind === 'ai.change.reverted') return { label: `${marker.change.count} 项操作`, verb: '已确认撤销', category: 'muted' };
  return { label: `${marker.change.count} 项操作`, verb: '已确认修改', category: 'muted' };
}
function changeDetail(marker) {
  if (marker.redactionState === 'redacted') return '内容已移除';
  if (marker.visibility === 'private') return '私密记录';
  const labels = { 'task.changed': '任务调整', 'inbox.resolved': '收件已处理', 'routine.schedule.changed': '日常计划调整' };
  const lines = ['来源：经本人确认的 AI 协作', '状态：已提交'];
  for (const change of marker.changes || []) {
    const ids = (change.change?.entityRefs || []).map(ref => `${({ task: '任务', inbox: '收件', routine: '日常' })[ref.kind]} ${ref.id}`);
    lines.push(`${labels[change.kind] || '变更'}${ids.length ? `：${ids.join('、')}` : ''}`);
  }
  lines.push(`回执：${marker.change.receiptId}`);
  if (marker.timezone) lines.push(`发生时区：${marker.timezone} (UTC${marker.utcOffsetMinutes < 0 ? '' : '+'}${marker.utcOffsetMinutes / 60})`);
  if (Number.isFinite(marker.receivedAt) && marker.receivedAt !== marker.occurredAt) lines.push(`补录时间：${new Date(marker.receivedAt).toISOString()}`);
  return lines.join('\n');
}
export { timelineCategory, timelineIcon, storedClock, changeDescription, changeDetail };
