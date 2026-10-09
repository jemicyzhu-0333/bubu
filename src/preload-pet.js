const { contextBridge, ipcRenderer } = require('electron');

// ARCHITECTURE「安全边界」: each named subscription owns one listener only.
function subscribePet(channel, callback) {
  let active = true;
  const listener = (_event, data) => { if (active) callback(data); };
  ipcRenderer.on(channel, listener);
  return () => {
    if (!active) return;
    active = false;
    ipcRenderer.removeListener(channel, listener);
  };
}

contextBridge.exposeInMainWorld('bubu', {
  pet_getBounds: () => ipcRenderer.invoke('pet:getBounds'),
  pet_setPosition: (x, y) => ipcRenderer.invoke('pet:setPosition', { x, y }),
  pet_savePosition: (x, y) => ipcRenderer.invoke('pet:savePosition', { x, y }),
  pet_dragStart: () => ipcRenderer.invoke('pet:dragStart'),
  pet_dragEnd: () => ipcRenderer.invoke('pet:dragEnd'),
  pet_getFeedState: () => ipcRenderer.invoke('pet:getFeedState'),
  pet_feed: request => ipcRenderer.invoke('pet:feed', request),
  pet_interaction: interactionId => ipcRenderer.invoke('pet:interaction', interactionId),
  pet_setMenuOpen: open => ipcRenderer.invoke('pet:setMenuOpen', Boolean(open)),
  pet_getState: () => ipcRenderer.invoke('pet:getState'),
  pet_getContent: () => ipcRenderer.invoke('pet:getContent'),
  pet_getContextualLine: context => ipcRenderer.invoke('pet:getContextualLine', context),
  pet_setState: state => ipcRenderer.invoke('pet:setState', state),
  pet_updateRuntime: runtime => ipcRenderer.invoke('pet:updateRuntime', runtime),
  pet_ackCue: acknowledgement => ipcRenderer.invoke('pet:cueAck', acknowledgement),
  pet_startFocus: () => ipcRenderer.invoke('pet:startFocus'),
  pet_openImpulse: () => ipcRenderer.invoke('pet:openImpulse'),
  pet_openPanel: () => ipcRenderer.invoke('pet:openPanel'),
  pet_toggleDnd: () => ipcRenderer.invoke('pet:toggleDnd'),
  pet_hide: () => ipcRenderer.invoke('pet:hide'),
  onPetSync: callback => subscribePet('pet:sync', callback),
  onPetViewport: callback => subscribePet('pet:viewport', callback),
  onPetFeedState: callback => subscribePet('pet:feedState', callback),
  onPetDock: callback => subscribePet('pet:dock', callback),
  onPetPeek: callback => subscribePet('pet:peek', callback),
  onPetCue: callback => subscribePet('pet:cue', callback),
  // 只读注视推送：只进不出，不暴露任何发送/调用能力。
  onPetGaze: callback => subscribePet('pet:gaze', callback),
  onPetDevtools: callback => subscribePet('pet:devtools', callback)
});
