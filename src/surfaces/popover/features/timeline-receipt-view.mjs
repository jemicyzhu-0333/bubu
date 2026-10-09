'use strict';

const FIELDS = Object.freeze({ title: '标题', description: '说明', tags: '标签', nextAction: '下一步',
  plannedFor: '计划日期', estimateMinutes: '预计分钟', estimateSource: '估计来源', energy: '所需精力',
  energyAuto: '自动估计', suggestedMin: '建议分钟', steps: '步骤', stepTitles: '重复步骤',
  classification: '收件分类', resolution: '处理去向', schedule: '日常计划', energySignalIds: '相关估计记录' });
function valueText(value) {
  if (value === null || value === undefined) return '无';
  return (typeof value === 'string' ? value : JSON.stringify(value)).slice(0, 3000);
}
function renderTimelineReceipt({ document, host, response, onContinueConversation } = {}) {
  const receipt = response.receipt;
  const section = document.createElement('section');
  section.className = 'tl-receipt';
  section.setAttribute('aria-label', '已确认变更详情');
  const lines = [`回执：${receipt.receiptId}`, `状态：${response.durability === 'unconfirmed' ? '本机修改已落下，保存确认待完成' : receipt.status === 'reverted' ? '已撤销' : '已提交'}`,
    `记录同步：${response.historyStatus === 'synced' ? '已同步' : '待同步'}`,
    `撤销：${response.undoAvailable ? '可在协作记录中预览并确认' : '当前不可用'}`];
  if (receipt.details === null || receipt.detailsRedacted) lines.push('变更内容已移除');
  else for (const diff of receipt.details?.diff || []) {
    lines.push(`关联${({ task: '任务', inbox: '收件', routine: '日常', recurrenceSeries: '重复计划' })[diff.entityRef?.kind] || '实体'}：${diff.entityRef?.id || '不可用'}`);
    for (const field of [...(diff.fields || []), ...(diff.derivedChanges || [])]) {
      if (!FIELDS[field.field]) continue;
      lines.push(`${FIELDS[field.field]}：${valueText(field.before)} → ${valueText(field.after)}`);
    }
  }
  section.textContent = lines.join('\n');
  if (typeof onContinueConversation === 'function' && typeof receipt.conversationId === 'string') {
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = '在本机核对与撤销';
    button.addEventListener('click', () => onContinueConversation({ conversationId: receipt.conversationId, receiptId: receipt.receiptId }));
    section.appendChild(button);
  }
  host.appendChild(section);
}
export { renderTimelineReceipt };
