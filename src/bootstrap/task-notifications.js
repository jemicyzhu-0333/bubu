'use strict';
const { nativeCopy } = require('../platform/electron/interface-copy');

// Native notifications may be visible on a locked or shared screen. Task titles,
// descriptions, tags and next actions stay inside 小步 by default; this boundary
// accepts only an event kind and an aggregate count. Deadlines and due times stay
// system notifications whether or not the pet is visible.
function createPrivateTaskNotifications(showNotification) {
  if (typeof showNotification !== 'function') throw new TypeError('task notifications require a notification sink');
  return function showPrivateTaskNotification(kind, count = 1) {
    const safeCount = Number.isInteger(count) && count > 0 ? count : 1;
    if (kind === 'expired') {
      return showNotification({ title: nativeCopy('⌛ {count} 个任务到期', { count: safeCount }), body: nativeCopy('打开 小步 查看并选择顺延或归档。') });
    }
    if (kind === 'scheduled') {
      return showNotification({ title: nativeCopy('⏰ {count} 个预约已到时间', { count: safeCount }), body: nativeCopy('打开 小步 查看预约内容。') });
    }
    if (kind === 'recurrence-ready') {
      return showNotification({ delivery: 'companion', title: nativeCopy('下一次已经排好'), body: nativeCopy('打开 小步 查看下一次安排。') });
    }
    return null;
  };
}

module.exports = { createPrivateTaskNotifications };
