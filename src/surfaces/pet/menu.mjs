'use strict';

import petInput from '../../core/pet-input.mjs';
import keyboardNavigation from '../../core/keyboard-navigation.mjs';
import { createSurfaceMotion } from '../shared/motion.mjs';

function createPetMenu({
  window,
  document,
  petHit,
  stage,
  commandMenu,
  feedQuick,
  client,
  isDevtoolsOpen = () => false,
  requestAnimationFrame,
  cancelAnimationFrame,
  setTimeout,
  clearTimeout,
  callbacks = {}
} = {}) {
  if (!window || !document || !petHit || !stage || !commandMenu) {
    throw new TypeError('pet menu elements are required');
  }
  if (!client || typeof client.pet_setMenuOpen !== 'function') throw new TypeError('pet menu client is required');
  if (typeof requestAnimationFrame !== 'function' || typeof cancelAnimationFrame !== 'function') {
    throw new TypeError('pet menu animation ports are required');
  }
  if (typeof setTimeout !== 'function' || typeof clearTimeout !== 'function') {
    throw new TypeError('pet menu timer ports are required');
  }

  let commandMenuOpen = false;
  let menuKeyboardActive = false;
  let pointerInsidePet = false;
  let menuReturnFocus = petHit;
  let stageExpanded = false;
  let lastStageGeo = null;
  let disposed = false;
  let menuRevision = 0;
  let expansionTask = Promise.resolve();
  const listeners = [];
  const focusFrames = new Set();
  const motion = createSurfaceMotion(document);
  const foodPanel = document.querySelector?.('#foodPanel');
  const Observer = window.MutationObserver;
  const foodObserver = Observer && foodPanel ? new Observer(() => {
    if (disposed) return;
    if (foodPanel.classList.contains('show')) void motion.enter(foodPanel.querySelector('.fp-list'));
  }) : null;
  foodObserver?.observe(foodPanel, { attributes: true, attributeFilter: ['class'] });

  function listen(target, type, handler) {
    const activeHandler = event => { if (!disposed) handler(event); };
    target.addEventListener(type, activeHandler);
    listeners.push(() => target.removeEventListener(type, activeHandler));
  }

  function queueFocus(callback) {
    const ticket = { revision: menuRevision, frame: null };
    focusFrames.add(ticket);
    ticket.frame = requestAnimationFrame(() => {
      if (!focusFrames.delete(ticket) || disposed || ticket.revision !== menuRevision) return;
      callback();
    });
  }

  function cancelFocusFrames() {
    const pending = [...focusFrames];
    focusFrames.clear();
    for (const ticket of pending) cancelAnimationFrame(ticket.frame);
  }

  const menuAutoClose = petInput.createMenuAutoClose({
    setTimeout(callback, delay) {
      const ticket = { active: true, timer: null };
      ticket.timer = setTimeout(() => {
        if (disposed || !ticket.active) return;
        ticket.active = false;
        callback();
      }, delay);
      return ticket;
    },
    clearTimeout(ticket) {
      ticket.active = false;
      clearTimeout(ticket.timer);
    },
    isFocusInside: () => menuKeyboardActive && commandMenu.contains(document.activeElement),
    isPointerInside: () => pointerInsidePet,
    onClose: () => { void toggle(false).catch(() => {}); }
  });

  function publishState() {
    callbacks.onStateChange?.({ commandMenuOpen, menuKeyboardActive, pointerInsidePet, stageExpanded, lastStageGeo });
  }

  // The main process keeps the expanded window on screen and reports how far
  // that moved it; the stage moves back by the same amount so the pet itself
  // does not jump. The menu column opens toward the roomier side.
  function applyStageGeometry(geo) {
    const offset = geo && geo.stageOffset ? geo.stageOffset : { x: 0, y: 0 };
    const root = document.documentElement.style;
    root.setProperty('--stage-dx', `${Number(offset.x) || 0}px`);
    root.setProperty('--stage-dy', `${Number(offset.y) || 0}px`);
    const width = geo?.width || window.innerWidth || 220;
    const height = geo?.height || window.innerHeight || 220;
    root.setProperty('--pet-stage-left', `${width / 2 - 110 + (Number(offset.x) || 0)}px`);
    root.setProperty('--pet-stage-top', `${height / 2 - 110 + (Number(offset.y) || 0)}px`);
    commandMenu.dataset.side = geo && geo.side === 'left' ? 'left' : 'right';
  }

  function syncStageExpansion() {
    if (disposed) return Promise.resolve(lastStageGeo);
    // Re-evaluate after the preceding native resize. An old open response must
    // never overwrite the geometry of a newer close (or menu -> food switch).
    expansionTask = expansionTask.catch(() => {}).then(async () => {
      if (disposed) return lastStageGeo;
      const needExpanded = commandMenuOpen || Boolean(callbacks.isFoodMenuOpen?.()) || Boolean(isDevtoolsOpen());
      if (needExpanded !== stageExpanded) {
        let geometry;
        try { geometry = await client.pet_setMenuOpen(needExpanded); }
        catch (error) {
          if (disposed) return lastStageGeo;
          throw error;
        }
        if (disposed) return lastStageGeo;
        lastStageGeo = geometry;
        applyStageGeometry(lastStageGeo);
        stageExpanded = needExpanded;
        stage.classList.toggle('menu-open', needExpanded);
        publishState();
      }
      return lastStageGeo;
    });
    return expansionTask;
  }

  const unsubscribeViewport = client.onPetViewport?.(geo => {
    if (disposed) return;
    lastStageGeo = geo;
    applyStageGeometry(geo);
  });

  async function toggle(show, { focus = false, restoreFocus = true, keyboard = false } = {}) {
    if (disposed) return;
    if (show === undefined) show = !commandMenuOpen;
    if (show === commandMenuOpen) {
      if (show) {
        if (keyboard) menuKeyboardActive = true;
        menuAutoClose.arm();
      }
      publishState();
      return syncStageExpansion();
    }
    const revision = ++menuRevision;
    cancelFocusFrames();
    if (show) {
      callbacks.cancelFeedPresentation?.('menu-open');
      callbacks.cancelCurrentAction?.('menu-open');
    }
    commandMenuOpen = show;
    menuKeyboardActive = show && keyboard;
    publishState();
    callbacks.onPolicyChange?.();
    if (!show) { motion.stop(); commandMenu.classList.remove('show'); }
    commandMenu.setAttribute('aria-hidden', String(!show));
    petHit.setAttribute('aria-expanded', String(show));
    menuAutoClose.cancel();
    if (!show) {
      if (restoreFocus && commandMenu.contains(document.activeElement)) menuReturnFocus.focus({ preventScroll: true });
      await syncStageExpansion();
      if (disposed || revision !== menuRevision) return;
      callbacks.reportRuntime?.();
      publishState();
      return;
    }
    menuReturnFocus = petHit;
    const dndItem = commandMenu.querySelector('[data-act="dnd"]');
    if (dndItem) {
      const dnd = Boolean(callbacks.isDnd?.());
      dndItem.setAttribute('aria-checked', String(dnd));
      dndItem.querySelector('.ci-text').textContent = dnd ? '关闭免打扰' : '免打扰';
    }
    await syncStageExpansion();
    if (!commandMenuOpen || disposed || revision !== menuRevision) return;
    commandMenu.classList.add('show');
    void motion.enter(commandMenu);
    if (focus) queueFocus(() => commandMenu.querySelector('[role^="menuitem"]:not(:disabled)')?.focus());
    menuAutoClose.arm();
    callbacks.reportRuntime?.();
    publishState();
  }

  function trackPointerPresence(element) {
    if (!element) return;
    listen(element, 'pointerenter', () => {
      pointerInsidePet = true;
      if (commandMenuOpen) menuAutoClose.arm();
      publishState();
    });
    listen(element, 'pointerleave', () => {
      pointerInsidePet = false;
      if (commandMenuOpen) menuAutoClose.arm();
      publishState();
    });
  }

  function onPetKeydown(event) {
    if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) {
      event.preventDefault();
      callbacks.handleClick?.();
    } else if ((event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) && !event.repeat) {
      event.preventDefault();
      callbacks.openCommandMenuOnce?.('keyboard');
    }
  }

  function onCommandItemClick(event) {
    event.stopPropagation();
    Promise.resolve(callbacks.runCommand?.(event.currentTarget.dataset.act)).catch(() => {});
  }

  function onCommandKeydown(event) {
    const items = [...commandMenu.querySelectorAll('[role^="menuitem"]:not(:disabled)')];
    const current = items.indexOf(document.activeElement);
    const nextIndex = keyboardNavigation.nextRovingIndex(current, event.key, items.length, 'vertical');
    const next = nextIndex === null ? null : items[nextIndex];
    if (next) {
      event.preventDefault();
      next.focus();
    }
    if (commandMenuOpen) {
      menuKeyboardActive = true;
      menuAutoClose.arm();
      publishState();
    }
  }

  function onFocusIn() {
    if (commandMenuOpen) menuAutoClose.arm();
  }

  function onFocusOut() {
    queueFocus(() => {
      if (commandMenuOpen) menuAutoClose.arm();
    });
  }

  listen(petHit, 'keydown', onPetKeydown);
  trackPointerPresence(petHit);
  trackPointerPresence(commandMenu);
  trackPointerPresence(feedQuick);
  for (const item of document.querySelectorAll('.command-item')) listen(item, 'click', onCommandItemClick);
  listen(commandMenu, 'keydown', onCommandKeydown);
  listen(commandMenu, 'focusin', onFocusIn);
  listen(commandMenu, 'focusout', onFocusOut);
  listen(feedQuick, 'click', event => {
    event.stopPropagation();
    Promise.resolve(callbacks.openFoodMenu?.()).catch(() => {});
  });

  function cancel(reason = 'cancelled') {
    if (disposed) return;
    cancelFocusFrames();
    menuAutoClose.cancel();
    if (commandMenuOpen) void toggle(false, { restoreFocus: false }).catch(() => {});
    callbacks.onCancel?.(reason);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    menuRevision += 1;
    menuAutoClose.cancel();
    cancelFocusFrames();
    motion.dispose();
    foodObserver?.disconnect();
    if (typeof unsubscribeViewport === 'function') unsubscribeViewport();
    for (const remove of listeners.splice(0)) remove();
    commandMenuOpen = false;
    menuKeyboardActive = false;
    pointerInsidePet = false;
    stageExpanded = false;
    lastStageGeo = null;
    commandMenu.classList.remove('show');
    commandMenu.setAttribute('aria-hidden', 'true');
    petHit.setAttribute('aria-expanded', 'false');
    stage.classList.remove('menu-open');
    delete commandMenu.dataset.side;
    // Release this owner's geometry without starting a native resize after stop.
    for (const property of ['--stage-dx', '--stage-dy', '--pet-stage-left', '--pet-stage-top']) {
      document.documentElement.style.setProperty(property, '');
    }
  }

  return Object.freeze({
    toggle,
    syncStageExpansion,
    cancel,
    dispose,
    snapshot: () => Object.freeze({ commandMenuOpen, menuKeyboardActive, pointerInsidePet, stageExpanded, lastStageGeo })
  });
}

export { createPetMenu };
export default Object.freeze({ createPetMenu });
