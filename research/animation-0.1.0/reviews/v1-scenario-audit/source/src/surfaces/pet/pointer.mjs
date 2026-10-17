'use strict';

import petInput from '../../core/pet-input.mjs';

const PRESS_MS = 550;
const DRAG_THRESHOLD = 14;

function createPetPointer({
  window,
  document,
  petHit,
  petLayer,
  client,
  requestAnimationFrame,
  cancelAnimationFrame,
  setTimeout,
  clearTimeout,
  callbacks = {}
} = {}) {
  if (!window || !document || !petHit || !petLayer) throw new TypeError('pet pointer elements are required');
  if (!client || typeof client.pet_getBounds !== 'function') throw new TypeError('pet pointer client is required');
  if (typeof requestAnimationFrame !== 'function' || typeof cancelAnimationFrame !== 'function') {
    throw new TypeError('pet pointer animation ports are required');
  }
  if (typeof setTimeout !== 'function' || typeof clearTimeout !== 'function') {
    throw new TypeError('pet pointer timer ports are required');
  }

  const state = {
    dragging: false,
    dragStartX: 0,
    dragStartY: 0,
    dragStartWinX: Number.NaN,
    dragStartWinY: Number.NaN,
    dragVx: 0,
    dragVy: 0,
    mouseVelocity: 0
  };
  let lastMouseMoveT = 0;
  let lastMouseMoveX = 0;
  let lastMouseMoveY = 0;
  let pendingMove = null;
  let moveFrame = null;
  let pressedExpressionEventId = null;
  let heldExpressionEventId = null;
  let disposed = false;
  let gesture = 0;
  // Pointerup resets the press gesture, but its native landing receipt still
  // belongs to this owner until cancellation, a new press, or disposal.
  let dragReceipt = 0;
  let nativeDragOwned = false;
  let capturedPointerId = null;
  const listeners = [];

  const emitState = patch => {
    Object.assign(state, patch);
    if (!disposed && typeof callbacks.onStateChange === 'function') callbacks.onStateChange({ ...state });
  };

  function listen(target, type, handler) {
    const activeHandler = event => { if (!disposed) handler(event); };
    target.addEventListener(type, activeHandler);
    listeners.push(() => target.removeEventListener(type, activeHandler));
  }

  function releasePointer() {
    const pointerId = capturedPointerId;
    capturedPointerId = null;
    if (pointerId !== null && petHit.hasPointerCapture(pointerId)) petHit.releasePointerCapture(pointerId);
  }

  function setPetDraggingClass(active) {
    petLayer.classList.toggle('dragging', active);
    petHit.classList.toggle('dragging', active);
  }

  function setPressRingProgress(progress) {
    const ring = document.getElementById('pressRing');
    const circle = ring && ring.querySelector('circle');
    if (!ring || !circle) return;
    ring.classList.toggle('show', progress > 0 && progress < 1);
    ring.classList.toggle('charging', progress > 0 && progress < 1);
    circle.style.strokeDashoffset = String(289 * (1 - Math.max(0, Math.min(1, progress))));
  }

  function queueMove(x, y) {
    pendingMove = { x, y };
    if (moveFrame !== null) return;
    const ticket = { frame: null };
    moveFrame = ticket;
    ticket.frame = requestAnimationFrame(() => {
      if (disposed || moveFrame !== ticket) return;
      moveFrame = null;
      const move = pendingMove;
      pendingMove = null;
      if (move) Promise.resolve(client.pet_setPosition(move.x, move.y)).catch(() => {});
    });
  }

  function flushMove() {
    if (moveFrame !== null) {
      const ticket = moveFrame;
      moveFrame = null;
      cancelAnimationFrame(ticket.frame);
    }
    pendingMove = null;
  }

  function releaseNativeDrag() {
    if (!nativeDragOwned) return;
    nativeDragOwned = false;
    return client.pet_dragEnd?.();
  }

  async function beginDrag(event) {
    const token = gesture;
    const current = () => !disposed && state.dragging && token === gesture;
    await callbacks.toggleCommandMenu?.(false);
    if (!current()) return;
    if (callbacks.isFoodMenuOpen?.()) await callbacks.closeFoodMenu?.();
    if (!current()) return;
    nativeDragOwned = true;
    await client.pet_dragStart?.();
    if (!current()) return;
    const bounds = await client.pet_getBounds();
    if (!bounds || !current()) return;
    emitState({
      dragStartX: event.screenX,
      dragStartY: event.screenY,
      dragStartWinX: bounds.x,
      dragStartWinY: bounds.y
    });
  }

  async function finishDrag() {
    const receipt = dragReceipt;
    const current = () => !disposed && receipt === dragReceipt;
    if (!current()) return;
    const fling = state.mouseVelocity > 2;
    emitState({ dragging: false });
    setPetDraggingClass(false);
    callbacks.cancelDraggedPresentation?.('drag-ended');
    callbacks.setState?.(callbacks.getSessionState?.());
    if (fling) {
      callbacks.startManualAction?.('spin', 'YEEEEE！转一圈，稳稳着陆。');
      Promise.resolve(client.pet_interaction?.('fling')).then(result => {
        if (current() && result && result.text) callbacks.say?.(result.text, 2200);
      }).catch(() => {});
    } else {
      callbacks.showExpression?.('react.satisfied', 'interaction', 1600);
    }
    const last = pendingMove;
    emitState({ mouseVelocity: 0 });
    flushMove();
    if (last) await client.pet_setPosition(last.x, last.y);
    if (!current()) return;
    await releaseNativeDrag();
    if (!current()) return;
    const bounds = await client.pet_getBounds();
    if (!current()) return;
    if (bounds) Promise.resolve(client.pet_savePosition?.(bounds.x, bounds.y)).catch(() => {});
    callbacks.markInteraction?.();
  }

  function cancelDrag() {
    // The host remains owned while pointerup awaits its final position receipt.
    // Release before checking visual drag state, and before any new owner starts.
    Promise.resolve(releaseNativeDrag()).catch(() => {});
    if (!state.dragging) return;
    emitState({ dragging: false, dragVx: 0, dragVy: 0 });
    flushMove();
    setPetDraggingClass(false);
    callbacks.cancelDraggedPresentation?.('drag-cancelled');
    callbacks.setState?.(callbacks.getSessionState?.());
  }

  const controller = petInput.createPetInputController({
    longPressMs: PRESS_MS,
    dragThreshold: DRAG_THRESHOLD,
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
    callbacks: {
      onPressChange(pressed) {
        petLayer.classList.toggle('pressed', pressed);
        setPressRingProgress(pressed ? 0.02 : 0);
        if (pressed) {
          callbacks.cancelFeedPresentation?.('interaction');
          callbacks.cancelCurrentAction?.('interaction');
          pressedExpressionEventId = callbacks.showExpression?.('life.attentive', 'interaction', 600_000) || null;
        } else if (pressedExpressionEventId) {
          callbacks.cancelExpression?.(pressedExpressionEventId, 'press-ended');
          pressedExpressionEventId = null;
        }
        if (!callbacks.calmMotionRequested?.()) callbacks.setSquashTarget?.(pressed ? 1 : 0);
      },
      onLongPress() {
        setPressRingProgress(1);
        const longPress = callbacks.getPetContent?.()?.INTERACTIONS?.longPress;
        heldExpressionEventId = callbacks.showExpression?.('react.petted', 'interaction', 600_000, { minHoldMs: 300 }) || null;
        callbacks.onHeldExpressionChange?.(heldExpressionEventId);
        if (!callbacks.startManualAction?.(longPress?.action, longPress?.text, { interactionId: 'longPress' })) {
          callbacks.say?.(longPress?.text || '~♪ 舒服...', 2200);
          callbacks.setTemporaryState?.('talking', 900);
        }
        if (longPress?.effect === 'purr') callbacks.emitPurrParticles?.();
      },
      onCommand(_event, source) {
        callbacks.openCommandMenuOnce?.(source);
      },
      onDragStart(event) {
        emitState({ dragging: true, dragVx: 0, dragVy: 0, dragStartWinX: Number.NaN, dragStartWinY: Number.NaN });
        // 快速“抓起即拖”（未到长按阈值）时，按压压缩弹簧还在朝 1 冲；转入拖动虽已把
        // target 归零，但值要过 ~300ms 才衰减完，拖动头几帧身体会“啪”地压扁（最高
        // 1.06 宽 / 0.90 高）。这里把 squash 弹簧连值带速度瞬时归零，拖动全程不再残留
        // 形变，只保留跟手的速度倾斜。（静态降级下交互弹簧不介入，由渲染器归静）
        if (!callbacks.calmMotionRequested?.()) callbacks.setSquash?.(0, 0);
        setPetDraggingClass(true);
        callbacks.setState?.('dragged');
        callbacks.resetGaze?.();
        callbacks.reportRuntime?.();
        void beginDrag(event).catch(() => {});
      },
      onDragMove(event) {
        if (!state.dragging) return;
        if (Number.isFinite(state.dragStartWinX)) {
          queueMove(
            state.dragStartWinX + event.screenX - state.dragStartX,
            state.dragStartWinY + event.screenY - state.dragStartY
          );
        }
        const now = callbacks.readWallClock?.() ?? Date.now();
        const vx = (event.screenX - lastMouseMoveX) / Math.max(1, now - lastMouseMoveT);
        const vy = (event.screenY - lastMouseMoveY) / Math.max(1, now - lastMouseMoveT);
        emitState({
          mouseVelocity: Math.sqrt(vx * vx + vy * vy),
          dragVx: vx,
          dragVy: vy
        });
        if (Math.abs(vx) > 0.2) callbacks.setFacing?.(vx >= 0 ? 1 : -1);
        // 被拎着时身体像挂在光标上的钟摆：倾斜跟随拖动速度，幅度放大到 ±0.28 rad（约 16°），
        // 让“被拎起来晚”更明显（Shimeji 的 Dragged 也靠随速度摆动读出“被抓着”）。
        if (!callbacks.calmMotionRequested?.()) callbacks.setTiltTarget?.(Math.max(-0.28, Math.min(0.28, vx * 0.5)));
        lastMouseMoveT = now;
        lastMouseMoveX = event.screenX;
        lastMouseMoveY = event.screenY;
      },
      onDragEnd() {
        if (!callbacks.calmMotionRequested?.()) {
          callbacks.setSquash?.(0.9, 0);
          callbacks.setSquashTarget?.(0);
        }
        callbacks.setTiltTarget?.(0);
        emitState({ dragVx: 0, dragVy: 0 });
        void finishDrag().catch(() => {});
        callbacks.reportRuntime?.();
      },
      onDragCancel() {
        callbacks.setTiltTarget?.(0);
        emitState({ dragVx: 0, dragVy: 0 });
        cancelDrag();
        callbacks.reportRuntime?.();
      },
      onTap() {
        callbacks.setState?.(callbacks.getSessionState?.());
        callbacks.markInteraction?.();
        if (!callbacks.calmMotionRequested?.()) {
          callbacks.setSquash?.(0.7, 0);
          callbacks.setSquashTarget?.(0);
        }
        callbacks.handleClick?.();
      },
      onReset() {
        gesture += 1;
        if (heldExpressionEventId) callbacks.cancelExpression?.(heldExpressionEventId, 'pointer-released');
        heldExpressionEventId = null;
        callbacks.onHeldExpressionChange?.(null);
      }
    }
  });

  function onPointerDown(event) {
    const result = controller.pointerDown(event);
    if (!result.capture || disposed) return;
    dragReceipt += 1;
    Promise.resolve(releaseNativeDrag()).catch(() => {});
    emitState({
      dragStartX: event.screenX,
      dragStartY: event.screenY,
      dragStartWinX: Number.NaN,
      dragStartWinY: Number.NaN,
      mouseVelocity: 0,
      dragVx: 0,
      dragVy: 0
    });
    gesture += 1;
    const now = callbacks.readWallClock?.() ?? Date.now();
    lastMouseMoveT = now;
    lastMouseMoveX = event.screenX;
    lastMouseMoveY = event.screenY;
    releasePointer();
    capturedPointerId = event.pointerId;
    petHit.setPointerCapture(capturedPointerId);
  }

  function onPointerMove(event) {
    controller.pointerMove(event);
  }

  function onPointerUp(event) {
    controller.pointerUp(event);
    if (capturedPointerId === event.pointerId) releasePointer();
  }

  function onPointerCancel(event) {
    controller.cancel('pointercancel', event);
  }

  function onLostPointerCapture(event) {
    if (capturedPointerId === event.pointerId) capturedPointerId = null;
    controller.cancel('lostpointercapture', event);
  }

  function onWindowBlur(event) {
    controller.cancel('blur', event);
  }

  listen(petHit, 'pointerdown', onPointerDown);
  listen(petHit, 'pointermove', onPointerMove);
  listen(petHit, 'pointerup', onPointerUp);
  listen(petHit, 'pointercancel', onPointerCancel);
  listen(petHit, 'lostpointercapture', onLostPointerCapture);
  listen(window, 'blur', onWindowBlur);

  function cancel(reason = 'cancelled') {
    if (disposed) return;
    cancelInput(reason);
  }

  function cancelInput(reason) {
    gesture += 1;
    dragReceipt += 1;
    controller.cancel(reason);
    cancelDrag();
    flushMove();
    releasePointer();
    petLayer.classList.remove('pressed');
    setPressRingProgress(0);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelInput('disposed');
    for (const remove of listeners.splice(0)) remove();
  }

  return Object.freeze({ cancel, dispose, snapshot: () => Object.freeze({ ...state }) });
}

export { createPetPointer, PRESS_MS, DRAG_THRESHOLD };
export default Object.freeze({ createPetPointer, PRESS_MS, DRAG_THRESHOLD });
