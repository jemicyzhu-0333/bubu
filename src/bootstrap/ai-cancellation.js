'use strict';

// 拆解 / 补全弹窗关掉时的取消通道。注册放在这里而不是 main.js：主进程入口的 IPC 注册数只减不增。
function registerAiCancellation(registerIpc, proposalPreview) {
  if (typeof registerIpc !== 'function' || !proposalPreview || typeof proposalPreview.cancelPending !== 'function') {
    throw new TypeError('ai cancellation requires an IPC registrar and a proposal preview');
  }
  registerIpc('ai:cancel', () => proposalPreview.cancelPending());
}

module.exports = { registerAiCancellation };
