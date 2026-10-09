import { t } from '../../shared/interface/i18n.mjs';
'use strict';

const FIELDS = Object.freeze({ title: '标题', description: '说明', tags: '标签', nextAction: '下一步',
  plannedFor: '计划日期', estimateMinutes: '预计分钟', estimateSource: '估计来源', energy: '所需精力',
  energyAuto: '自动估计', suggestedMin: '建议分钟', steps: '步骤', stepTitles: '重复步骤',
  classification: '收件分类', resolution: '处理去向', schedule: '日常计划', energySignalIds: '相关估计记录' });
function valueText(value) {
  if (value === null || value === undefined) return t('无');
  return (typeof value === 'string' ? value : JSON.stringify(value)).slice(0, 3000);
}
function renderTimelineReceipt({ document, host, response, onContinueConversation } = {}) {
  const receipt = response.receipt;
  const section = document.createElement('section');
  section.className = 'tl-receipt';
  let button = null;
  function repaintCopy() {
    section.setAttribute('aria-label', t('已确认变更详情'));
    const lines = [t('回执：{receipt}', { receipt: receipt.receiptId }), t('状态：{status}', { status: t(response.durability === 'unconfirmed' ? '本机修改已落下，保存确认待完成' : receipt.status === 'reverted' ? '已撤销' : '已提交') }),
      t('记录同步：{status}', { status: t(response.historyStatus === 'synced' ? '已同步' : '待同步') }),
      t('撤销：{availability}', { availability: t(response.undoAvailable ? '可在协作记录中预览并确认' : '当前不可用') })];
    if (receipt.details === null || receipt.detailsRedacted) lines.push(t('变更内容已移除'));
    else for (const diff of receipt.details?.diff || []) {
      lines.push(t('关联{kind}：{id}', { kind: t(({ task: '任务', inbox: '收件', routine: '日常', recurrenceSeries: '重复计划' })[diff.entityRef?.kind] || '实体'), id: diff.entityRef?.id || t('不可用') }));
      for (const field of [...(diff.fields || []), ...(diff.derivedChanges || [])]) {
        if (!FIELDS[field.field]) continue;
        lines.push(t('{field}：{before} → {after}', { field: t(FIELDS[field.field]), before: valueText(field.before), after: valueText(field.after) }));
      }
    }
    const text = [...(section.childNodes || [])].find(node => node.nodeType === 3);
    if (text) text.textContent = lines.join('\n');
    else section.textContent = lines.join('\n');
    if (button) button.textContent = t('在本机核对与撤销');
  }
  repaintCopy();
  if (typeof onContinueConversation === 'function' && typeof receipt.conversationId === 'string') {
    button = document.createElement('button');
    button.type = 'button'; button.textContent = t('在本机核对与撤销');
    button.addEventListener('click', () => onContinueConversation({ conversationId: receipt.conversationId, receiptId: receipt.receiptId }));
    section.appendChild(button);
  }
  host.appendChild(section);
  return repaintCopy;
}
export { renderTimelineReceipt };
