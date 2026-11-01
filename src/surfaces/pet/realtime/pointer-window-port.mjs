// The surface owns desktop deactivation policy. Forward only input propagation;
// webpage-style blur/focus suspension must not stop an unfocused desktop pet.
export function createDesktopPointerWindow(window) {
  if (typeof window?.addEventListener !== 'function' || typeof window?.removeEventListener !== 'function')
    throw new TypeError('desktop pointer window requires event ports');
  return Object.freeze({
    addEventListener(type, listener) { if (!['blur', 'focus'].includes(type)) window.addEventListener(type, listener); },
    removeEventListener(type, listener) { if (!['blur', 'focus'].includes(type)) window.removeEventListener(type, listener); }
  });
}
