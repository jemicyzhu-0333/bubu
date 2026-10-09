'use strict';

function createNotificationHost({
  Notification = require('electron').Notification,
  isSuppressed,
  isSoundEnabled,
  presentCompanion = null,
  onError = () => {}
}) {
  if (!Notification || typeof Notification.isSupported !== 'function') {
    throw new TypeError('Notification must expose isSupported()');
  }
  if (typeof isSuppressed !== 'function') throw new TypeError('isSuppressed must be a function');
  if (typeof isSoundEnabled !== 'function') throw new TypeError('isSoundEnabled must be a function');
  if (typeof onError !== 'function') throw new TypeError('onError must be a function');
  if (presentCompanion !== null && typeof presentCompanion !== 'function') throw new TypeError('presentCompanion must be a function');

  const active = new Map();

  // The pet speaks in short hand-written lines without emoji (PRODUCT「界面语言」).
  function companionLine({ title, body }) {
    return [title, body].filter(Boolean).join(' · ')
      .replace(/[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\uFE0F\u200D]/gu, '').replace(/\s+/g, ' ').trim();
  }

  function report(error) {
    try {
      onError(error);
    } catch (_) {
      // Optional feedback cannot fail because its diagnostic sink failed.
    }
  }

  // System delivery is the default: due times, deadlines and failures must never depend on
  // whether the pet is visible. Only callers that opt into `companion` (everyday feedback
  // such as level-up or a saved capture) go to the pet, and are dropped when it is hidden
  // (PRODUCT「面板交互」).
  function show({ delivery = 'system', ...options } = {}, receipt = null) {
    let notification = null;
    let settled = false;
    function settle(result) {
      if (settled) return;
      settled = true;
      if (notification) {
        notification.removeListener('show', onShow);
        notification.removeListener('failed', onFailed);
      }
      if (typeof receipt === 'function') {
        try { receipt(result); } catch (error) { report(error); }
      }
    }
    function onShow() { settle({ shown: true }); }
    function onFailed() {
      active.delete(notification);
      settle({ shown: false, reason: 'failed' });
    }
    function onClose() {
      active.delete(notification);
      settle({ shown: false, reason: 'closed' });
    }

    try {
      if (isSuppressed()) {
        settle({ shown: false, reason: 'suppressed' });
        return null;
      }
      if (delivery === 'companion') {
        if (presentCompanion) presentCompanion(companionLine(options));
        settle({ shown: false, reason: 'companion' });
        return null;
      }
      if (!Notification.isSupported()) {
        settle({ shown: false, reason: 'unsupported' });
        return null;
      }
      const silent = Object.prototype.hasOwnProperty.call(options, 'silent')
        ? options.silent
        : !isSoundEnabled();
      notification = new Notification({ ...options, silent });
      active.set(notification, () => settle({ shown: false, reason: 'closed' }));
      // ARCHITECTURE「日常与能量」: invocation alone cannot attest delivery.
      notification.on('show', onShow);
      notification.on('failed', onFailed);
      notification.on('close', onClose);
      notification.show();
      return notification;
    } catch (error) {
      if (notification) active.delete(notification);
      settle({ shown: false, reason: 'error' });
      report(error);
      return null;
    }
  }

  function closeAll() {
    for (const [notification, cancel] of [...active]) {
      if (!active.delete(notification)) continue;
      cancel();
      try {
        notification.close();
      } catch (error) {
        report(error);
      }
    }
  }

  return Object.freeze({ show, closeAll });
}

module.exports = { createNotificationHost };
