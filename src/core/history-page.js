'use strict';

const DEFAULT_HISTORY_PAGE_SIZE = 30;
const MAX_HISTORY_PAGE_SIZE = 100;
// User history is retained until the user explicitly restores/removes it. The
// renderer sees bounded pages, so retained history cannot make every state
// update grow without limit or freeze the popover.
const HISTORY_RETENTION_POLICY = 'retain-until-explicit-user-action';

function decodeCursor(cursor) {
  if (cursor === null || cursor === undefined || cursor === '') return 0;
  if (typeof cursor !== 'string' || !/^offset:\d+$/.test(cursor)) throw new TypeError('invalid-history-cursor');
  const offset = Number(cursor.slice(7));
  if (!Number.isSafeInteger(offset) || offset < 0) throw new TypeError('invalid-history-cursor');
  return offset;
}

function pageTaskHistory(items, options = {}) {
  const offset = decodeCursor(options.cursor);
  const limit = options.limit === undefined ? DEFAULT_HISTORY_PAGE_SIZE : options.limit;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_HISTORY_PAGE_SIZE) throw new RangeError('invalid-history-limit');
  const seriesId = options.seriesId || null;
  const source = (Array.isArray(items) ? items : [])
    .filter(task => task && (!seriesId || task.seriesId === seriesId))
    .sort((left, right) => Number(right.archivedAt || right.completedAt || right.skippedAt || right.updatedAt || 0)
      - Number(left.archivedAt || left.completedAt || left.skippedAt || left.updatedAt || 0)
      || String(left.id).localeCompare(String(right.id)));
  const page = source.slice(offset, offset + limit);
  const nextOffset = offset + page.length;
  return Object.freeze({
    items: page,
    nextCursor: nextOffset < source.length ? `offset:${nextOffset}` : null,
    total: source.length,
    retention: HISTORY_RETENTION_POLICY
  });
}

module.exports = {
  DEFAULT_HISTORY_PAGE_SIZE,
  MAX_HISTORY_PAGE_SIZE,
  HISTORY_RETENTION_POLICY,
  decodeCursor,
  pageTaskHistory
};
