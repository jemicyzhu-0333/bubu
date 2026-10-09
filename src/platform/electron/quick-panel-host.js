'use strict';

const { resolveFocusDisplay, focusLanding } = require('./focus-display');

// Built-in fallback accelerators. Every one of these was verified to register
// successfully on this machine (macOS 15.5 / Electron 44, arm64) and is chosen
// to avoid the macOS input-source switchers (⌃Space, ⌃⌥Space) and common system
// chords. Punctuation must be the literal key: Electron throws a conversion
// error on token names like "Period"/"Slash" (observed in the B1 probe), so the
// list uses '.' and '/' directly.
const BUILT_IN_CANDIDATES = Object.freeze([
  'Alt+Shift+Space', // ⌥⇧Space — the default, and the first rung
  'Alt+Shift+.',     // ⌥⇧.
  'Control+Alt+.',   // ⌃⌥.
  'Alt+Shift+/',     // ⌥⇧/
  'F19'              // an unused function key, the last resort
]);

const MODIFIER_GLYPHS = Object.freeze({
  Command: '⌘', Cmd: '⌘', CommandOrControl: '⌘', Meta: '⌘',
  Control: '⌃', Ctrl: '⌃', Alt: '⌥', Option: '⌥', Shift: '⇧', Super: '❖'
});

function acceleratorLabel(accelerator) {
  if (typeof accelerator !== 'string' || !accelerator) return '';
  return accelerator.split('+').map(part => MODIFIER_GLYPHS[part] || part).join('');
}

/**
 * Owns the quick-panel global shortcut and where the panel lands on screen.
 *
 * Binding is a ladder, not a single attempt (task B2): the user's configured
 * accelerator is tried first, then a list of built-in fallbacks, until one is
 * claimed. Whatever actually registers is remembered and reported through
 * describeShortcut, so the UI shows the combo that works — not the one the user
 * configured that silently lost to another app. If every rung fails, the panel
 * stays reachable from the menu bar; that is logged exactly once and is never
 * turned into an error dialog, a red setting, or a demand that the user pick a
 * different chord. Compatibility is ours to absorb, not the user's.
 *
 * dispose releases only the chord we claimed — never unregisterAll, which would
 * disarm every other host's shortcut (ARCHITECTURE「快捷行动面板」).
 */
function createQuickPanelHost({
  shortcutHost,
  screenHost,
  BrowserWindow = require('electron').BrowserWindow,
  ownsSender = () => false,
  showPanel,
  hidePanel,
  isPanelVisible = () => false,
  cuePet = () => {},
  logger = () => {},
  candidates = BUILT_IN_CANDIDATES
} = {}) {
  if (!shortcutHost || typeof shortcutHost.claim !== 'function') {
    throw new TypeError('quick panel host requires a shortcut host that can claim a chord');
  }
  if (!screenHost || typeof screenHost.primaryDisplay !== 'function') {
    throw new TypeError('quick panel host requires a screen host');
  }
  if (typeof showPanel !== 'function' || typeof hidePanel !== 'function') {
    throw new TypeError('quick panel host requires showPanel and hidePanel');
  }

  let configured = null; // what the user asked for
  let active = null;     // { accelerator, release } — what actually registered
  let releasePetCue = null;
  let enabled = true;

  function panelDisplay() {
    return resolveFocusDisplay({ screenHost, ownsSender, BrowserWindow });
  }

  function clearPetCue() {
    if (typeof releasePetCue !== 'function') return;
    const release = releasePetCue;
    releasePetCue = null;
    try { release(); } catch (_) { /* restoring the pet cannot block panel close */ }
  }

  // The hotkey is the user's own action, so it is honoured even during DND
  // (ARCHITECTURE「快捷行动面板」): no do-not-disturb check here on purpose.
  function hide() {
    clearPetCue();
    hidePanel();
  }

  function open() {
    if (isPanelVisible()) return;
    const display = panelDisplay();
    clearPetCue();
    try {
      const bounds = showPanel(display);
      const release = cuePet(display, bounds);
      releasePetCue = typeof release === 'function' ? release : null;
    } catch (error) {
      clearPetCue();
      throw error;
    }
  }

  function releaseActive() {
    if (active && typeof active.release === 'function') active.release();
    active = null;
  }
  function toggle() { if (isPanelVisible()) hide(); else open(); }

  // Try one accelerator. shortcutHost.claim returns a release fn on success, or
  // null when the chord is taken, invalid, or register threw — all of which mean
  // "this rung failed, move on". (Verified in B1: register returns false when a
  // chord is held, and throws a TypeError on an unparseable token; the shortcut
  // adapter already turns both into null.)
  function claimOne(accelerator) {
    if (typeof accelerator !== 'string' || !accelerator) return null;
    return shortcutHost.claim(accelerator, toggle);
  }

  function ladderFor(preferred) {
    const order = [];
    for (const accelerator of [preferred, ...candidates]) {
      if (typeof accelerator === 'string' && accelerator && !order.includes(accelerator)) order.push(accelerator);
    }
    return order;
  }

  // Walk the ladder until one accelerator sticks. Never throws; never asks the
  // user for anything.
  function claimLadder(preferred) {
    for (const accelerator of ladderFor(preferred)) {
      const release = claimOne(accelerator);
      if (release) {
        active = { accelerator, release };
        const usedFallback = accelerator !== preferred;
        if (usedFallback) {
          logger({ scope: 'quick-panel', event: 'fallback-bound', configured: preferred, accelerator });
        }
        return { ok: true, accelerator, usedFallback };
      }
    }
    // Every rung failed. The panel is still reachable from the tray, so this is a
    // one-line note, not an error the user has to act on.
    logger({ scope: 'quick-panel', event: 'no-accelerator', configured: preferred, note: 'menu-bar only' });
    return { ok: false, accelerator: null, degraded: true };
  }

  // Bind at startup to the user's configured accelerator (or a sensible default).
  function claim(accelerator) {
    if (typeof accelerator === 'string' && accelerator) configured = accelerator;
    else if (!configured) configured = BUILT_IN_CANDIDATES[0];
    releaseActive();
    if (!enabled) return { ok: false, accelerator: null, reason: 'disabled' };
    return claimLadder(configured);
  }

  // Re-bind to a new configured accelerator, rolling back to the previous
  // binding if the entire new ladder fails, so we never end up with nothing
  // registered (ARCHITECTURE「快捷行动面板」).
  function rebind(nextAccelerator) {
    const previous = active;
    const previousConfigured = configured;
    if (typeof nextAccelerator === 'string' && nextAccelerator) configured = nextAccelerator;
    releaseActive();
    if (!enabled) return { ok: false, accelerator: null, reason: 'disabled' };

    const result = claimLadder(configured);
    if (result.ok) return result;

    if (previous && previous.accelerator) {
      const release = claimOne(previous.accelerator);
      if (release) {
        active = { accelerator: previous.accelerator, release };
        configured = previousConfigured;
        return { ok: true, accelerator: previous.accelerator, rolledBack: true };
      }
    }
    return result;
  }

  // quickPanelEnabled=false releases the chord; re-enabling re-runs the ladder.
  function setEnabled(value) {
    enabled = Boolean(value);
    if (!enabled) { releaseActive(); return { ok: true, enabled: false }; }
    return claim(configured);
  }

  // Runtime fact for the settings UI (ARCHITECTURE「快捷行动面板」 quickPanel:describeShortcut): the
  // accelerator that actually works, its label, and whether a fallback was used.
  // configuredLabel ships alongside the raw accelerator so the glyph table stays
  // in one place: the settings UI shows ⌥⇧Space on the recorder button without
  // keeping a second copy of MODIFIER_GLYPHS in the renderer.
  function describeShortcut() {
    return Object.freeze({
      configured,
      configuredLabel: acceleratorLabel(configured),
      accelerator: active ? active.accelerator : null,
      label: acceleratorLabel(active ? active.accelerator : null),
      enabled,
      registered: Boolean(active),
      usedFallback: Boolean(active && active.accelerator !== configured)
    });
  }

  function dispose() {
    clearPetCue();
    releaseActive();
  }

  return Object.freeze({
    claim,
    rebind,
    setEnabled,
    describeShortcut,
    panelDisplay,
    landingFor: (display, size) => focusLanding(display.workArea, size),
    hide,
    open,
    feedback: kind => releasePetCue?.feedback?.(kind),
    panelHidden: clearPetCue,
    dispose
  });
}

module.exports = { createQuickPanelHost, acceleratorLabel, BUILT_IN_CANDIDATES };
