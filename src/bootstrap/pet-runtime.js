'use strict';

// Existing runtime projection and optional V2 native-effect admission stay separate.
// The normal registrar retains its closed codec/surface allowlist; the window
// independently binds lease requests to its current document and native owner.
function registerPetRuntimeIpc({ registerIpc, getWindow, applyRuntime }) {
  registerIpc('pet:updateRuntime', (event, runtime) => {
    let receipt = { ok: true };
    if (Object.hasOwn(runtime, 'inputLease')) {
      const window = getWindow();
      if (typeof window?.applyInputLease !== 'function') return { ok: false, reason: 'input-lease-unavailable' };
      receipt = window.applyInputLease(event, runtime.inputLease);
      if (receipt?.ok !== true) return receipt;
    }
    applyRuntime({ visible: runtime.visible, menuOpen: runtime.menuOpen,
      dragging: runtime.dragging, prefersReducedMotion: runtime.prefersReducedMotion });
    return receipt;
  });
}
module.exports = { registerPetRuntimeIpc };
