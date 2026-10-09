'use strict';

// 「针对这件事的下一步」：卡住弹层里策略卡上方的一块。
//
// 它和策略卡不是一回事:策略卡给的是一条通用办法(本机规则,永远拿得到),这一块给
// 的是针对这件事的一句下一步(要发一次请求,可能回退)。所以它不替换策略卡,也不在
// 等待期间把策略卡换成一个转圈——等的时候下面那条办法照旧可读,这一块只在自己
// 这一格里写一行「正在想」。
//
// 这一层拥有的全部状态:当前这次请求的序号。它的唯一用途是丢弃迟到的旧结果——
// 连着点两次「换一个」时,先发的那次可能后回来,没有这个序号就会用旧建议盖掉新的。
function createPopoverUnstickAdvice({ $, escapeHTML, surfaceClient } = {}) {
  if (typeof $ !== 'function' || typeof escapeHTML !== 'function') {
    throw new TypeError('popover unstick advice requires $ and escapeHTML');
  }
  if (!surfaceClient || typeof surfaceClient.suggestUnstick !== 'function') {
    throw new TypeError('popover unstick advice requires surfaceClient.suggestUnstick');
  }

  const HEAD = '<div class="unstick-head">针对这件事的下一步</div>';
  // 主进程拒绝的四种情形都是「目标不在了」,各自有一句人话。别的原因不猜,统一
  // 落到那句「这次没想出来」,因为把内部原因码摆到面上帮不了任何人。
  const REFUSALS = Object.freeze({
    'task-not-found': '这件事已经不在了。',
    'task-completed': '这件事已经完成了。',
    'occurrence-skipped': '这次已经跳过了。',
    'proposal-target-changed': '这件事刚被改过,先看一眼再问会更准。'
  });

  let requestSeq = 0;

  function show(html) {
    const node = $('#unstickBlock');
    if (!node) return;
    node.innerHTML = html;
    node.classList.remove('hidden');
  }

  function note(text) {
    show(`${HEAD}<p class="unstick-pending">${escapeHTML(text)}</p>`);
  }

  // 关掉弹层、换一件任务都要清一次:留在面上的旧建议会被当成对新任务说的。
  function clear() {
    requestSeq += 1;
    const node = $('#unstickBlock');
    if (!node) return;
    node.innerHTML = '';
    node.classList.add('hidden');
  }

  function renderAdvice(result) {
    // 回退了就说清楚回退到哪、为什么:静默换一个来源,用户会把本地模板当成模型说的。
    const source = result.fallback
      ? `本地建议（${result.reason || '未提供原因'}）`
      : result.provider === 'api' ? 'AI 建议' : '本地建议';
    const parts = [HEAD, `<p class="unstick-action">${escapeHTML(result.nextAction)}</p>`];
    if (result.why) parts.push(`<p class="unstick-why">${escapeHTML(result.why)}</p>`);
    // 和下一步一字不差的兜底不值得占一行——那不是「另一条路」。
    if (result.fallbackAction && result.fallbackAction !== result.nextAction) {
      parts.push(`<p class="unstick-fallback">做不动就先做：${escapeHTML(result.fallbackAction)}</p>`);
    }
    const steps = Array.isArray(result.splitSteps) ? result.splitSteps.filter(Boolean) : [];
    if (steps.length) {
      parts.push(`<ul class="unstick-steps">${steps.map(step => `<li>${escapeHTML(step)}</li>`).join('')}</ul>`);
    }
    parts.push(`<p class="unstick-source">${escapeHTML(source)}</p>`);
    show(parts.join(''));
  }

  // 没有选定任务就没有「这件事」,不发请求:一句没有对象的下一步等于噪音。
  async function request({ taskId, note: reason } = {}) {
    if (!taskId) {
      clear();
      return;
    }
    const seq = (requestSeq += 1);
    note('正在想一个针对这件事的下一步……下面那条办法可以先看。');
    let result = null;
    try {
      result = await surfaceClient.suggestUnstick({ taskId, note: reason || null });
    } catch (_) {
      result = null;
    }
    if (seq !== requestSeq) return;
    if (!result || result.ok === false) {
      note(REFUSALS[result && result.reason] || '这次没想出来,先按下面那条办法试试。');
      return;
    }
    renderAdvice(result);
  }

  return Object.freeze({ request, clear });
}

export { createPopoverUnstickAdvice };
