const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bubu', {
  onNudgeInit: callback => {
    if (typeof callback === 'function') ipcRenderer.on('nudge:init', (_event, payload) => callback(payload));
  },
  onNudgeFocus: callback => {
    if (typeof callback === 'function') ipcRenderer.on('nudge:focus-controls', () => callback());
  },
  onNudgeSensoryProfile: callback => {
    if (typeof callback === 'function') ipcRenderer.on('nudge:sensory-profile', (_event, profile) => callback(profile));
  },
  dismissNudge: actionId => ipcRenderer.invoke('nudge:dismiss', String(actionId || 'dismiss').slice(0, 64)),
  // 提醒卡上的「已完成/跳过」直接落账。这里只暴露打卡一条:提醒卡不该能改日常清单,
  // 主进程的白名单也只给了这条两个 nudge surface。
  logRoutine: entry => ipcRenderer.invoke('routines:log', entry),
  setNudgePointerInteractive: interactive => ipcRenderer.invoke('nudge:pointer-interactive', Boolean(interactive))
});
