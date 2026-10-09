'use strict';

// 完成之后几秒内的撤销：登记表在内存里，撤销成功后补上两件派生的事——把那条“任务完成”时间线记录删掉，
// 再通知面板重画。注册放在这里而不是 main.js：主进程入口的行数与 IPC 注册数只减不增。
const { createUndoRegistry } = require('../application/state/undo-registry');
const { runPostCommitEffect } = require('../shared/post-commit-effects');

function createTaskUndo({ unitOfWork, clock, idFactory, timelineRecorder, publishChange, reportEffectError = () => {} } = {}) {
  if (!timelineRecorder || typeof timelineRecorder.recordTaskCompletionUndone !== 'function'
      || typeof publishChange !== 'function') {
    throw new TypeError('task undo requires a timeline recorder and a change publisher');
  }
  const registry = createUndoRegistry({ unitOfWork, clock, idFactory });

  function undoComplete(token) {
    const result = registry.undo(token);
    if (!result.ok) return { ok: false, reason: result.reason };
    runPostCommitEffect(() => timelineRecorder.recordTaskCompletionUndone(result.meta), result, reportEffectError);
    runPostCommitEffect(() => publishChange({
      tasks: true, stats: true, pet: true, companion: true, skin: true, nowTask: true,
      recommendations: true, recurrenceSeries: true, focusLandingPrompt: true, timeline: true
    }), result, reportEffectError);
    return { ok: true, taskId: result.subject };
  }

  function register(registerIpc) {
    if (typeof registerIpc !== 'function') throw new TypeError('task undo requires an IPC registrar');
    registerIpc('tasks:undo-complete', (_event, token) => undoComplete(token));
  }

  return Object.freeze({ registry, undoComplete, register });
}

module.exports = { createTaskUndo };
