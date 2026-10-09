const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('imAdhder', {
  getState: () => ipcRenderer.invoke('state:get'),
  addImpulse: text => ipcRenderer.invoke('impulses:add', String(text || '').trim().slice(0, 500)),
  completeTask: (id, confirmUnfinishedSteps = false) => ipcRenderer.invoke('tasks:complete', {
    id,
    confirmUnfinishedSteps: confirmUnfinishedSteps === true
  }),
  completeStep: (taskId, stepId) => ipcRenderer.invoke('tasks:complete-step', { taskId, stepId }),
  appendTaskStep: (id, title, scope) => ipcRenderer.invoke('tasks:update', {
    id,
    patch: { steps: [{ op: 'add', title: String(title || '').trim().slice(0, 200) }] },
    ...(scope ? { scope } : {})
  }),
  startPomodoro: (taskId, minutes) => ipcRenderer.invoke('pomodoro:start', { taskId, minutes }),
  renameTaskStep: (id, stepId, title, scope) => ipcRenderer.invoke('tasks:update', {
    id, patch: { steps: [{ op: 'rename', stepId, title: String(title || '').trim().slice(0, 200) }] },
    ...(scope ? { scope } : {})
  }),
  kickstart: (taskId, clarification) => ipcRenderer.invoke('pomodoro:kickstart', { ...clarification, taskId }),
  stopPomodoro: action => ipcRenderer.invoke('pomodoro:stop', action),
  pausePomodoro: () => ipcRenderer.invoke('pomodoro:pause'),
  resumePomodoro: action => ipcRenderer.invoke('pomodoro:resume', action),
  hideImpulse: () => ipcRenderer.invoke('impulse:hide'),
  onStateDiff: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('state:diff', listener);
    return () => ipcRenderer.removeListener('state:diff', listener);
  },
  onSensoryProfile: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, profile) => callback(profile);
    ipcRenderer.on('sensory:profile', listener);
    return () => ipcRenderer.removeListener('sensory:profile', listener);
  }
});
