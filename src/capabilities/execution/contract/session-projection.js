'use strict';

const {
  STATUS,
  normalizeFocusSession,
  isActiveSession,
  isPausedSession,
  sessionKind,
  elapsedMs
} = require('../domain/session-state');

function projectSession(rawSession, now) {
  const session = normalizeFocusSession(rawSession, { now });
  const elapsed = elapsedMs(session, now);
  const kind = sessionKind(session);
  return {
    running: isActiveSession(session),
    paused: isPausedSession(session),
    status: session.status,
    mode: kind === STATUS.BREAK ? 'break' : 'focus',
    kind,
    sessionId: session.sessionId,
    startedAt: session.startedAt,
    endsAt: session.endsAt,
    taskId: session.taskId,
    awaitingOfflineConfirmation: session.awaitingOfflineConfirmation === true,
    recoveryReason: session.recoveryReason || null,
    plannedDurationMs: session.plannedDurationMs,
    elapsedMs: elapsed,
    remainingMs: Math.max(0, session.plannedDurationMs - elapsed)
  };
}

// 桌宠脚下的进度环只需要一个“锚点”：总时长、此刻已过多久、是不是在走。桌宠页拿到后自己用单调时钟
// 往前推，不需要主进程每秒推一次。没有正在进行或暂停的会话就没有环（null）。
function projectFocusRing(view) {
  if (!view || !(view.running || view.paused)) return null;
  const plannedMs = Number(view.plannedDurationMs);
  if (!Number.isFinite(plannedMs) || plannedMs <= 0) return null;
  const elapsedMs = Math.min(plannedMs, Math.max(0, Number(view.elapsedMs) || 0));
  return {
    mode: view.mode === 'break' ? 'break' : 'focus',
    sessionId: view.sessionId || null,
    plannedMs,
    elapsedMs,
    // 等待确认的离线恢复、暂停都算“没在走”：环停在那里，不假装还在前进。
    running: Boolean(view.running) && !view.paused && view.awaitingOfflineConfirmation !== true
  };
}

module.exports = { sessionKind, projectSession, projectFocusRing };
