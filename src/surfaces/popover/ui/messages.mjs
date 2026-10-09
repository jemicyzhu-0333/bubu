'use strict';

// 面板要说给人听的每一句话都在这里。它不认识 DOM，也不认识状态：给它一个机器
// 码或一条规则，它给回一句用户能拿去做事的话。
// 之所以单独成一层：同一个原因码会同时出现在任务行、专注动作、拆解回退与设置
// 披露上，四处各写一句翻译，就会有三处慢慢说得不一样。
function createPopoverMessages({ pad2 } = {}) {
  if (typeof pad2 !== 'function') throw new TypeError('popover messages requires pad2');

  const BLOCKER_LABELS = Object.freeze({
    unclear: '不清楚',
    'too-big': '太大',
    boring: '无聊',
    anxious: '有压力',
    'low-energy': '没电',
    interrupted: '被打断'
  });
  const WEEKDAY_LABELS = Object.freeze(['', '一', '二', '三', '四', '五', '六', '日']);
  const REPEAT_LABELS = Object.freeze({ daily: '每天', weekly: '每周', monthly: '每月' });

  function breakdownProviderLabel(result) {
    if (result.fallback) return '本地确定性模板';
    if (result.provider === 'api') return '已启用的 API';
    return '本地规则';
  }

  // 回退本身是设计内的，但“为什么回退”不说就只剩下“模型好像不好用”。主进程给的
  // 是机器码，这里翻成一句能拿去做事的话，认不出来就原码奉上——不吞。
  function fallbackReasonText(reason) {
    if (!reason) return '';
    // 模型答了但答得不合约定，与“根本没连上”是两件事。不分开说，用户会去查
    // 密钥和 Base URL，而那两样都是好的。
    const rejected = /^proposal-rejected\|(.+)$/.exec(reason);
    if (rejected) return `模型给的内容不符合约定，重试后仍未通过：${rejected[1]}`;
    const httpStatus = /^provider-http-(\d{3})(?:\|(.+))?$/.exec(reason);
    if (httpStatus) {
      const status = httpStatus[1];
      const detail = httpStatus[2] ? `：${httpStatus[2]}` : '';
      if (status === '401' || status === '403') return `密钥被拒（HTTP ${status}），检查 API 密钥是否正确、是否过期${detail}`;
      if (status === '404') return `这个地址上没有可用接口（HTTP 404），检查 Base URL${detail}`;
      if (status === '429') return 'HTTP 429 限流，稍后再试';
      if (status === '400') return `HTTP 400，通常是模型名或该密钥授权范围不匹配${detail}`;
      if (status === '402') return `HTTP 402，账户余额不足${detail}`;
      return `HTTP ${status}${detail}`;
    }
    return {
      'provider-credential-missing': '还没保存 API 密钥',
      'provider model is required': '还没填模型名',
      // 这两条不是模型报错，是等待时间用完了。说成“超时”而不是原始机器码，
      // 否则用户会去查密钥和模型名，而那两样都是好的。
      'provider-request-aborted': '模型在时限内没回话（超时），本地模板已先填好',
      'provider-timeout': '连接超时，模型没在时限内回话',
      'provider-response-invalid-json': '模型返回的不是合法 JSON',
      'provider-response-missing-output': '模型返回里没有内容',
      'provider-response-too-large': '模型返回过大',
      'provider-endpoint-resolves-private': 'Base URL 解析到了内网地址，只允许公网 HTTPS',
      'provider-endpoint-host-not-allowed': 'Base URL 指向本机或内网主机名，只允许公网 HTTPS',
      'provider-endpoint-address-not-allowed': 'Base URL 直写了内网 IP，只允许公网 HTTPS',
      'invalid-provider-endpoint': 'Base URL 不合法',
      'provider-endpoint-port-not-allowed': '只允许 443 端口',
      'provider-failed': '请求没成功'
    }[reason] || reason;
  }

  function fallbackReasonSuffix(result) {
    if (!result || !result.fallback || !result.reason) return '';
    return `（AI 未生效：${fallbackReasonText(result.reason)}）`;
  }

  function describeSeriesRule(series) {
    if (!series || !series.rule) return '';
    const rule = series.rule;
    const interval = Number.isInteger(rule.interval) && rule.interval > 1 ? rule.interval : 1;
    const intervalUnit = ({ daily: '天', weekly: '周', monthly: '月' })[rule.frequency];
    const base = interval > 1 && intervalUnit
      ? `每 ${interval} ${intervalUnit}`
      : (REPEAT_LABELS[rule.frequency] || rule.frequency);
    const days = rule.frequency === 'weekly' && Array.isArray(rule.weekdays) && rule.weekdays.length
      ? ` ${rule.weekdays.map(day => WEEKDAY_LABELS[day]).join('')}`
      : '';
    const strategy = rule.strategy === 'after-completion' ? ' · 完成后再算' : '';
    const paused = series.state === 'paused' ? '已暂停 · ' : series.state === 'ended' ? '已结束 · ' : '';
    return `${paused}${base}${days}${strategy}`;
  }

  function taskActionMessage(reason) {
    if (reason === 'task-in-focus') return '专注期间只可加步骤；结束这一轮后再编辑整件任务。';
    return ({
      'task-not-found': '这件任务已不在列表中，面板刷新后可以重新选择。',
      'task-completed': '这件任务已经完成了；需要的话可以再做一遍。',
      'occurrence-skipped': '这一次已经跳过，下一次已经排好了。',
      'step-completed': '这一步已经勾过，不需要再勾。',
      'task-not-recurring': '这不是重复任务，没有“这一次”可以跳。',
      'series-not-found': '它的重复规则已不存在，请刷新面板后重试。',
      'series-ended': '这个重复系列已经结束；需要继续时请复制成一个新系列。',
      'task-in-active-session': '这件任务仍绑定着当前计时，请先结束计时再处理。',
      'open-recurrence-occurrence': '开放中的重复任务不能直接归档；请先完成或跳过这一次。',
      'step-limit-reached': '这个任务已经有 100 个步骤，请先整理现有步骤。',
      'next-action-required': '请先写下一个具体、可动手的下一步。'
    })[reason] || '这次没有成功，任务内容仍然保留，请重试。';
  }
  // “今天 23:59” / “明天 23:59” / “8/30 23:59”
  function formatExpiry(iso) {
    const d = new Date(iso);
    const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const dayDiff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - today) / 86400000);
    if (dayDiff === 0) return `今天 ${hm}`;
    if (dayDiff === 1) return `明天 ${hm}`;
    if (dayDiff === -1) return `昨天 ${hm}`;
    return `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
  }

  function focusActionMessage(reason) {
    return ({
      'task-not-found': '关联任务已不在列表中；刷新后可改选任务，或选择自由专注。',
      'task-completed': '这件任务已经完成，不能继续计时；可以结束这段。',
      'occurrence-skipped': '这一次已经跳过，下一次已经排好了。',
      'next-action-required': '先写下一个可观察的下一动作，再开始两分钟。',
      'task-expired': '这件任务已到自动失效时间。先在任务列表的“更多”里续期。',
      'task-scheduled': '预约时间还没到，暂时不能继续计时。',
      'not-paused': '当前计时没有暂停，请按更新后的面板继续。',
      'session-changed': '计时已换成另一轮，请按更新后的面板继续。',
      'resume-intent-mismatch': '计时状态已变化，请重新查看继续或确认按钮。',
      'resume-action-unavailable': '计时状态暂不可用，请重新打开面板。',
      'recovery-state-inconsistent': '这轮计时的恢复状态不一致，暂时不能继续或确认；可以放弃本轮。',
      'quick-start-decision-pending': '请先完成两分钟启动后的三选一。',
      'focus-landing-pending': '请先保存或跳过上一轮的落点，再开始新的计时。',
      'awaiting-confirmation': '这一轮已到点，请先确认计入完成或放弃本轮。',
      'no-pending-focus-landing': '这条落点已经处理，可以继续下一步。',
      'no-matching-focus-landing': '这条落点已经处理或更新，请按当前面板继续。',
      'stale-landing-prompt': '这条落点已被更新，请按当前面板继续。',
      'landing-note-not-saved': '落点没有保存，输入仍保留，请重试或暂时跳过。',
      'already-running': '这段计时已经在进行或暂停中。',
      'session-active': '已有另一段计时正在进行或暂停中，请先处理当前计时。',
      'session-already-active': '已有一段计时正在进行。',
      'not-running': '现在没有正在进行的专注，时长会在下一轮生效。',
      'session-kind-not-adjustable': '两分钟救援与休息是固定时长，不可调整。',
      'duration-below-invested': '不能缩到已经投入的时长之下；想现在停下请选“结束这段”。'
    })[reason] || '这次没有启动成功，状态和任务都已保留，请重试。';
  }

  function scoreSummary(candidate) {
    const b = candidate.scoreBreakdown || {};
    const labels = { deadline: '紧迫', energyMatch: '能量匹配', durationFit: '时长适配', activation: '易启动', nextStep: '下一步清晰', avoidance: '回避信号', resumeMomentum: '恢复势能' };
    return Object.entries(b)
      .filter(([, value]) => typeof value === 'number' && value !== 0)
      .sort((a, b2) => Math.abs(b2[1]) - Math.abs(a[1]))
      .slice(0, 3)
      .map(([key, value]) => `${labels[key] || key} ${value > 0 ? '+' : ''}${Math.round(value)}`)
      .join(' · ');
  }

  return Object.freeze({
    BLOCKER_LABELS,
    WEEKDAY_LABELS,
    REPEAT_LABELS,
    breakdownProviderLabel,
    fallbackReasonText,
    fallbackReasonSuffix,
    describeSeriesRule,
    taskActionMessage,
    formatExpiry,
    focusActionMessage,
    scoreSummary
  });
}


export { createPopoverMessages };
