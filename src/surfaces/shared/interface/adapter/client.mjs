function createInterfaceClient(bridge = globalThis.window?.bubu) {
  if (!bridge || typeof bridge.getInterfacePreferences !== 'function'
      || typeof bridge.onInterfacePreferences !== 'function') throw new TypeError('interface bridge is required');
  return Object.freeze({
    read: () => bridge.getInterfacePreferences(),
    subscribe: callback => bridge.onInterfacePreferences(callback)
  });
}
export { createInterfaceClient };
