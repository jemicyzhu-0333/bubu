'use strict';

// 这一次渲染要用的那个「会话」是叠出来的:持久下来的 focusSession 带着生命周期身份
// （它是什么状态、暂停之前在做什么、绑的是哪一件任务），pomodoro 是主进程那份权威
// 的单调投影（还剩多少、锚点在哪）。谁在上面、暂停时的 mode 从哪里读、running 到底
// 包含哪几个状态,这三件事只在这里回答一次。
//
// 面板顶上曾经有一份同样的合并；六个层都从注进来的 getSession 读它,那就更不该由
// 组合根顺手写在中间。这一层不认识 DOM,给什么 state 就答什么,没有 state 时答一个
// 形状完整的空闲会话,调用方不必再判空。
function popoverSessionView(state) {
  if (!state) return { status: 'idle', running: false, paused: false, taskId: null };
  const f = state.focusSession;
  if (f) {
    // The raw persisted session carries lifecycle identity while pomodoro is
    // the main process's authoritative, monotonic projection for this render.
    const projection = state.pomodoro || {};
    const kind = f.status === 'paused' ? (f.kind || f.pausedFrom) : f.status;
    return {
      ...f,
      ...projection,
      status: f.status,
      running: ['focus', 'quick-start', 'break'].includes(f.status),
      paused: f.status === 'paused',
      mode: kind === 'break' ? 'break' : (kind === 'quick-start' ? 'quick-start' : 'focus')
    };
  }
  const p = state.pomodoro || {};
  return { ...p, status: p.running ? (p.mode || 'focus') : 'idle', paused: false };
}


export { popoverSessionView };
