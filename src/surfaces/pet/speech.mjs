'use strict';

// One existing bubble and one replaceable timeout, shared by every speaker.
// Context copy is optional: it may neither replace nor queue behind other speech.
const SAY_MAX_CHARS = 42;
function createPetSpeech({ bubble, contextSlot = null, setTimeout, clearTimeout } = {}) {
  if (!bubble?.classList || !bubble?.dataset || typeof setTimeout !== 'function'
      || typeof clearTimeout !== 'function') throw new TypeError('speech requires a bubble and timer ports');
  let timer = null;
  let source = null;
  let generation = 0;
  const speechHome = bubble.parentElement;

  function hide() {
    generation += 1;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    source = null;
    bubble.classList.remove('show');
    // Keep the source selector until the next utterance: removing it here would
    // move a fading context bubble back over the head for one CSS transition.
  }

  function show(text, ms = 3500, nextSource = 'standard') {
    const value = String(text);
    if (timer !== null) clearTimeout(timer);
    source = nextSource;
    // The same speech node occupies the supplemental grid cell only for
    // context. All other speakers retain the original stage coordinates.
    const host = source === 'context' ? contextSlot : speechHome;
    if (host && bubble.parentElement !== host) host.appendChild(bubble);
    bubble.textContent = value.length > SAY_MAX_CHARS ? value.slice(0, SAY_MAX_CHARS - 1) + '…' : value;
    bubble.dataset.speechSource = source;
    bubble.classList.add('show');
    const ownGeneration = ++generation;
    timer = setTimeout(() => { if (generation === ownGeneration) hide(); }, ms);
    return true;
  }

  function sayOwned(text, ms) {
    show(text, ms);
    const ownGeneration = generation;
    return () => { if (generation === ownGeneration) hide(); };
  }

  const visible = () => bubble.classList.contains('show');
  function showContext(text, ms = 2800) {
    if (visible()) return false;
    return show(text, ms, 'context');
  }
  function cancelContext() {
    if (source === 'context') hide();
  }
  return Object.freeze({ sayOwned, say: (text, ms) => show(text, ms), hide, showContext, cancelContext, visible,
    hasExternal: () => visible() && source !== 'context',
    snapshot: () => Object.freeze({ visible: visible(), source }) });
}

export { createPetSpeech, SAY_MAX_CHARS };
