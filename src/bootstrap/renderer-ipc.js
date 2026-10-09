'use strict';
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { createInterfacePreferencesRuntime } = require('./interface-preferences');
const { createIpcRegistrar } = require('../application/ipc');

// Main supplies the renderer root and canonical reads; the existing registrar
// still owns sender allowlists and closed payload admission.
function createRendererIpcRegistrar({ rendererDirectory, ipcHost, allowedSurfacesFor, assertIpcPayload, readTasks, getSettings, interfaceHost }) {
  const pages = Object.freeze(Object.fromEntries(Object.entries({ popover: 'popover', impulse: 'impulse', pet: 'pet',
    nudgeCorner: 'nudge-corner', nudgeFullscreen: 'nudge-fullscreen' })
    .map(([surface, page]) => [surface, path.resolve(rendererDirectory, `${page}.html`)])));
  function senderPage(event) {
    try {
      const raw = event.senderFrame && event.senderFrame.url ? event.senderFrame.url : event.sender.getURL();
      const parsed = new URL(raw);
      return parsed.protocol === 'file:' ? path.resolve(fileURLToPath(parsed)) : null;
    } catch (_) { return null; }
  }
  const registerIpc = createIpcRegistrar({ ipcHost, senderPage,
    allowedPagesFor: channel => allowedSurfacesFor(channel).map(surface => pages[surface]),
    validatePayload: (channel, payload) => {
      const currentTaskId = payload && typeof payload === 'object' ? (payload.id || payload.taskId) : payload;
      const currentTask = typeof currentTaskId === 'string' ? readTasks().find(task => task.id === currentTaskId) : null;
      return assertIpcPayload(channel, payload, { currentTask, currentSettings: getSettings() });
    }
  });
  const presentation = createInterfacePreferencesRuntime({ getSettings, host: interfaceHost });
  registerIpc('settings:get-interface', () => presentation.read());
  return (channel, handler) => registerIpc(channel, channel === 'settings:update' ? async (event, patch) => {
    const result = await handler(event, patch);
    if (result?.ok === true && ('locale' in patch || 'theme' in patch)) presentation.publish();
    return result;
  } : handler);
}
module.exports = { createRendererIpcRegistrar };
