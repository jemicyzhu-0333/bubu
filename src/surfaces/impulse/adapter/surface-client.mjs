'use strict';

// The impulse surface sees only this reviewed bridge. Feature code never reaches
// into window.imAdhder directly, so adding an action requires the preload and IPC
// allowlist to change together.
function createImpulseSurfaceClient(bridge = typeof window !== 'undefined' ? window.imAdhder : null) {
  if (!bridge || typeof bridge !== 'object') throw new TypeError('impulse surface bridge is required');
  const methods = [
    'getState', 'addImpulse', 'completeTask', 'completeStep', 'appendTaskStep', 'renameTaskStep',
    'startPomodoro', 'kickstart', 'stopPomodoro', 'pausePomodoro', 'resumePomodoro',
    'hideImpulse', 'onStateDiff', 'onSensoryProfile'
  ];
  for (const method of methods) {
    if (typeof bridge[method] !== 'function') throw new TypeError(`impulse bridge is missing ${method}`);
  }
  return Object.freeze(Object.fromEntries(methods.map(method => [
    method,
    (...args) => bridge[method](...args)
  ])));
}

export { createImpulseSurfaceClient };
