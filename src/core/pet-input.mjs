'use strict';

const PRIMARY_BUTTON = 0;
const DEFAULT_LONG_PRESS_MS = 550;
const DEFAULT_DRAG_THRESHOLD = 14;
const DEFAULT_MENU_IDLE_MS = 5000;
const DEFAULT_MENU_AWAY_MS = 2000;
const DEFAULT_MENU_FOCUS_MS = 8000;

function createPetInputController(options = {}) {
  const longPressMs = options.longPressMs ?? DEFAULT_LONG_PRESS_MS;
  const dragThreshold = options.dragThreshold ?? DEFAULT_DRAG_THRESHOLD;
  const schedule = options.setTimeout || setTimeout;
  const unschedule = options.clearTimeout || clearTimeout;
  const callbacks = options.callbacks || {};
  let active = null;
  let longPressTimer = null;

  function emit(name, ...args) {
    if (typeof callbacks[name] === 'function') callbacks[name](...args);
  }

  function clearLongPress() {
    if (longPressTimer !== null) unschedule(longPressTimer);
    longPressTimer = null;
  }

  function reset(reason, event) {
    if (!active) return false;
    const previous = active;
    clearLongPress();
    active = null;
    emit('onPressChange', false, event, reason);
    if (previous.phase === 'dragging') emit('onDragCancel', event, reason);
    emit('onReset', reason, event);
    return true;
  }

  function pointerDown(event) {
    if (!event || event.isPrimary === false) return { accepted: false, reason: 'not-primary-pointer' };
    if (event.button !== PRIMARY_BUTTON) return { accepted: false, reason: 'not-primary-button' };
    if (event.ctrlKey) {
      emit('onCommand', event, 'control-click');
      return { accepted: false, reason: 'control-click' };
    }
    if (active) reset('replaced', event);
    active = {
      pointerId: event.pointerId,
      startX: event.screenX,
      startY: event.screenY,
      phase: 'pressed'
    };
    emit('onPressChange', true, event, 'pointerdown');
    longPressTimer = schedule(() => {
      if (!active || active.phase !== 'pressed') return;
      active.phase = 'long-pressed';
      longPressTimer = null;
      emit('onPressChange', false, event, 'long-press');
      emit('onLongPress', event);
    }, longPressMs);
    return { accepted: true, capture: true };
  }

  function pointerMove(event) {
    if (!active || event.pointerId !== active.pointerId) return { handled: false };
    const dx = event.screenX - active.startX;
    const dy = event.screenY - active.startY;
    const distance = Math.abs(dx) + Math.abs(dy);
    if (active.phase === 'pressed' && distance > dragThreshold) {
      clearLongPress();
      active.phase = 'dragging';
      emit('onPressChange', false, event, 'drag');
      emit('onDragStart', event, { dx, dy, distance });
    }
    if (active.phase === 'dragging') emit('onDragMove', event, { dx, dy, distance });
    return { handled: true, phase: active.phase };
  }

  function pointerUp(event) {
    if (!active || event.pointerId !== active.pointerId) return { handled: false };
    const previous = active;
    clearLongPress();
    active = null;
    emit('onPressChange', false, event, 'pointerup');
    if (previous.phase === 'dragging') emit('onDragEnd', event);
    else if (previous.phase === 'pressed') emit('onTap', event);
    emit('onReset', 'pointerup', event);
    return { handled: true, action: previous.phase };
  }

  function cancel(reason = 'cancelled', event) {
    return reset(reason, event);
  }

  function snapshot() {
    return active ? { ...active } : { phase: 'idle' };
  }

  return { pointerDown, pointerMove, pointerUp, cancel, snapshot };
}

// 菜单空闲自动收起。之前的实现在超时回调里发现焦点仍在菜单内就直接返回，
// 定时器已被消耗且不再排期，而菜单打开时会主动聚焦首项，于是永不关闭。
// 这里改为超时必定关闭，只根据焦点与指针位置选用不同的空闲时长：
// 键盘停留在菜单里给最长等待，指针已离开给最短。任何交互重新调用 arm() 即可重置计时。
function createMenuAutoClose(options = {}) {
  const idleMs = options.idleMs ?? DEFAULT_MENU_IDLE_MS;
  const awayMs = options.awayMs ?? DEFAULT_MENU_AWAY_MS;
  const focusMs = options.focusMs ?? DEFAULT_MENU_FOCUS_MS;
  const schedule = options.setTimeout || setTimeout;
  const unschedule = options.clearTimeout || clearTimeout;
  const isFocusInside = options.isFocusInside || (() => false);
  const isPointerInside = options.isPointerInside || (() => false);
  const onClose = options.onClose || (() => {});
  let timer = null;

  function cancel() {
    if (timer !== null) unschedule(timer);
    timer = null;
  }

  function delayFor() {
    if (isFocusInside()) return focusMs;
    return isPointerInside() ? idleMs : awayMs;
  }

  function arm() {
    cancel();
    const delay = delayFor();
    timer = schedule(() => {
      timer = null;
      onClose();
    }, delay);
    return delay;
  }

  return { arm, cancel, delayFor, pending: () => timer !== null };
}

// 渲染进程以 classic <script> 共享全局词法作用域加载本文件，
// 顶层标识符必须是本文件专属，否则同页面的后续脚本会在编译期整体失败。
const petInputApi = {
  PRIMARY_BUTTON,
  DEFAULT_LONG_PRESS_MS,
  DEFAULT_DRAG_THRESHOLD,
  DEFAULT_MENU_IDLE_MS,
  DEFAULT_MENU_AWAY_MS,
  DEFAULT_MENU_FOCUS_MS,
  createPetInputController,
  createMenuAutoClose
};



export default petInputApi;
export { PRIMARY_BUTTON, DEFAULT_LONG_PRESS_MS, DEFAULT_DRAG_THRESHOLD, DEFAULT_MENU_IDLE_MS, DEFAULT_MENU_AWAY_MS, DEFAULT_MENU_FOCUS_MS, createPetInputController, createMenuAutoClose };
