'use strict';

// Matches the persisted cap: an id longer than the schema can store could never
// name a real notice, so refusing it here costs nothing and keeps the lookup key
// bounded against a caller probing with a huge string.
const MAX_NOTICE_ID_LENGTH = 120;

function requireNoticeState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new TypeError('migration notice transition requires a state draft');
  }
  if (!Array.isArray(state.migrationNotices)) {
    throw new TypeError('migration notice transition requires a notice collection');
  }
  return state.migrationNotices;
}

function findNotice(state, noticeId) {
  const notices = requireNoticeState(state);
  const id = typeof noticeId === 'string' && noticeId && noticeId.length <= MAX_NOTICE_ID_LENGTH
    ? noticeId
    : '';
  return id ? notices.find(notice => notice && notice.id === id) || null : null;
}

/**
 * Acknowledge one migration notice.
 *
 * A notice reports something a past migration already did, so acknowledging it
 * removes it instead of flagging it read — there is no second thing to say. An
 * id nobody recognises gets the same answer as an id dismissed a moment ago,
 * which is what makes a duplicated click harmless rather than an error the
 * renderer has to reconcile.
 */
function dismissNotice(state, noticeId) {
  const notices = requireNoticeState(state);
  const notice = findNotice(state, noticeId);
  if (!notice) return { ok: false, reason: 'notice-not-found' };
  state.migrationNotices = notices.filter(candidate => candidate.id !== notice.id);
  return { ok: true, dismissedId: notice.id };
}

module.exports = { MAX_NOTICE_ID_LENGTH, dismissNotice, findNotice };
