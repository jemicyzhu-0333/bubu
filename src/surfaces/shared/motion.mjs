// One motion owner per surface; native window geometry never participates.
import { iconMotion } from './icon-motion.mjs';
let runtime;
const loadRuntime = () => (runtime ||= import('../../../node_modules/gsap/index.js'));
function createSurfaceMotion(document, { load = loadRuntime } = {}) {
  const view = document.defaultView;
  const active = new Map();
  let disposed = false;
  const query = view?.matchMedia?.('(prefers-reduced-motion: reduce)');
  function reduced() {
    return !query || query.matches || document.hidden
      || document.body.dataset.motion === 'reduced' || document.body.dataset.stimulation === 'low';
  }
  function clear(element) {
    const previous = active.get(element);
    active.delete(element);
    previous?.context?.revert();
  }
  function stop() { for (const element of [...active.keys()]) clear(element); }
  async function play(element, from, to, kind = 'transition', pressed = false) {
    if (!element || disposed) return;
    const previous = active.get(element);
    // Hover -> focus -> click is one gesture, including while GSAP is loading.
    // Reverting the live context here would snap the icon back to its origin.
    if (!reduced() && kind === 'feedback' && previous?.kind === kind && previous.running) {
      if (pressed) {
        previous.pressed = true;
        previous.tween?.timeScale(1.3);
      }
      return;
    }
    clear(element);
    if (reduced()) return;
    const ticket = { kind, running: true, pressed };
    active.set(element, ticket);
    try {
      const { gsap } = await load();
      if (disposed || active.get(element) !== ticket || !element.isConnected || reduced()) return;
      ticket.context = gsap.context(() => {
        ticket.tween = gsap.fromTo(element, from, { ...to, overwrite: 'auto',
          clearProps: 'transform,opacity,visibility', onComplete: () => { ticket.running = false; } });
        if (ticket.pressed) ticket.tween.timeScale(1.3);
      }, element);
    } catch { if (active.get(element) === ticket) clear(element); }
  }
  function enter(element) {
    return play(element, { y: 6, autoAlpha: .45 }, { y: 0, autoAlpha: 1, duration: .24, ease: 'power2.out' });
  }
  function ambient(element, particle = false) {
    return play(element, particle ? { y: 8, opacity: .12 } : { y: 0 },
      particle ? { y: -12, opacity: .55, duration: 3.8, repeat: -1, yoyo: true, ease: 'sine.inOut' }
        : { y: -3, duration: 2.8, repeat: -1, yoyo: true, ease: 'sine.inOut' });
  }
  function feedback(element, variant = 'lift', pressed = false) {
    return play(element, { x: 0, y: 0, scale: 1, rotation: 0 }, iconMotion(variant), 'feedback', pressed);
  }
  const preferenceChange = () => { if (reduced()) stop(); };
  query?.addEventListener?.('change', preferenceChange);
  document.addEventListener?.('visibilitychange', preferenceChange);
  const observer = view?.MutationObserver ? new view.MutationObserver(preferenceChange) : null;
  observer?.observe(document.body, { attributes: true, attributeFilter: ['data-motion', 'data-stimulation'] });
  return { reduced, enter, feedback, ambient, stop, dispose() {
    disposed = true; stop(); observer?.disconnect();
    query?.removeEventListener?.('change', preferenceChange);
    document.removeEventListener?.('visibilitychange', preferenceChange);
  } };
}
export { createSurfaceMotion };
