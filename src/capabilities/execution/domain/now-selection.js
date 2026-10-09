'use strict';

function selectTask(taskId) {
  const nowTaskId = typeof taskId === 'string' ? taskId.trim() : '';
  if (!nowTaskId || nowTaskId.length > 200) return { ok: false, reason: 'task-id-required' };
  return { ok: true, nowTaskId };
}

module.exports = { selectTask };
