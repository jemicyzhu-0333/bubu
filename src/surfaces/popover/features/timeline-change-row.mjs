import { t, getLocale } from '../../shared/interface/i18n.mjs';
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
  if (marker.redactionState === 'redacted') return { label: t('内容已移除'), verb: t('记录'), category: 'muted' };
  if (marker.visibility === 'private') return { label: t('私密记录'), verb: t('记录'), category: 'muted' };
  if (marker.kind === 'ai.change.reverted') return { label: t('{count} 项操作', { count: marker.change.count }), verb: t('已确认撤销'), category: 'muted' };
  return { label: t('{count} 项操作', { count: marker.change.count }), verb: t('已确认修改'), category: 'muted' };
}
function changeDetail(marker) {
  if (marker.redactionState === 'redacted') return t('内容已移除');
  if (marker.visibility === 'private') return t('私密记录');
  const labels = { 'task.changed': t('任务调整'), 'inbox.resolved': t('收件已处理'), 'routine.schedule.changed': t('日常计划调整') };
  const lines = [t('来源：经本人确认的 AI 协作'), t('状态：已提交')];
  for (const change of marker.changes || []) {
    const ids = (change.change?.entityRefs || []).map(ref => `${({ task: t('任务'), inbox: t('收件'), routine: t('日常') })[ref.kind]} ${ref.id}`);
    lines.push(ids.length ? t('{label}：{items}', { label: labels[change.kind] || t('变更'), items: ids.join(getLocale() === 'en' ? ', ' : '、') }) : labels[change.kind] || t('变更'));
  }
  lines.push(t('回执：{receipt}', { receipt: marker.change.receiptId }));
  if (marker.timezone) lines.push(t('发生时区：{timezone} (UTC{offset})', { timezone: marker.timezone, offset: `${marker.utcOffsetMinutes < 0 ? '' : '+'}${marker.utcOffsetMinutes / 60}` }));
  if (Number.isFinite(marker.receivedAt) && marker.receivedAt !== marker.occurredAt) lines.push(t('补录时间：{time}', { time: new Date(marker.receivedAt).toISOString() }));
  return lines.join('\n');
}
export { timelineCategory, timelineIcon, storedClock, changeDescription, changeDetail };
