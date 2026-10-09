'use strict';

// 完成之后几秒钟内的“撤销”（ARCHITECTURE「任务会话与奖励」）。
//
// 不是再写一份“反向逻辑”去倒扣奖励——那样每加一种奖励就要多记得倒扣一种。做法是：提交那一刻
// 工作单元就知道这次到底改了哪几个顶层字段（changedPaths），这里把这些字段的“之前”和“之后”存在
// 内存里几秒钟。撤销时逐个检查这些字段现在是不是还等于“之后”——是，说明这几秒里没有别的东西碰过
// 它们，就整体放回“之前”；有任何一个变了（比如这几秒里又喂了宠物），就拒绝，绝不在别人的改动上覆盖。
//
// 只存在内存里：重启就没了，不进持久化，也不增加任何 schema 字段。凭据一次有效，用过或过期即作废。
const { isDeepStrictEqual } = require('node:util');

const DEFAULT_TTL_MS = 5000;
// 界面上的倒计时是 5 秒；IPC 一来一回会吃掉一点，给一小段宽限，免得点在最后一刻却被拒。
const DEFAULT_GRACE_MS = 1500;
const MAX_ENTRIES = 5;

function pick(state, paths) {
  const picked = {};
  for (const path of paths) if (Object.prototype.hasOwnProperty.call(state, path)) picked[path] = state[path];
  return picked;
}

function createUndoRegistry({ unitOfWork, clock, idFactory, ttlMs = DEFAULT_TTL_MS, graceMs = DEFAULT_GRACE_MS } = {}) {
  if (!unitOfWork || typeof unitOfWork.run !== 'function') throw new TypeError('undo registry requires a unit of work');
  if (!clock || typeof clock.now !== 'function') throw new TypeError('undo registry requires a clock');
  if (typeof idFactory !== 'function') throw new TypeError('undo registry requires an id source');

  const entries = new Map();

  function prune(now) {
    for (const [token, entry] of entries) if (now > entry.expiresAt + graceMs) entries.delete(token);
    while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value);
  }

  // before：提交前这些字段的值；after：提交后的值；paths：这次提交实际改动的字段。
  function capture({ kind, subject, paths, before, after, meta = {} } = {}) {
    if (typeof kind !== 'string' || !kind || !Array.isArray(paths) || paths.length === 0) return null;
    const now = clock.now();
    prune(now);
    // 凭据不能覆盖还在有效期内的另一张：id 来源再靠谱，撞上一次就会让别人的撤销悄悄失效或撤错事。
    let token = idFactory('undo');
    for (let attempt = 0; entries.has(token) && attempt < 8; attempt += 1) token = idFactory('undo');
    if (entries.has(token)) return null;
    entries.set(token, {
      kind,
      subject,
      paths: [...paths],
      before: structuredClone(pick(before, paths)),
      after: structuredClone(pick(after, paths)),
      meta: structuredClone(meta),
      expiresAt: now + ttlMs
    });
    prune(now);
    return Object.freeze({ token, ttlMs });
  }

  function undo(token) {
    const now = clock.now();
    const entry = typeof token === 'string' ? entries.get(token) : undefined;
    if (!entry) return { ok: false, reason: 'undo-unavailable' };
    entries.delete(token);
    if (now > entry.expiresAt + graceMs) return { ok: false, reason: 'undo-expired' };
    const transaction = unitOfWork.run({
      writes: entry.paths,
      context: { now },
      transition: state => {
        for (const path of entry.paths) {
          if (!isDeepStrictEqual(state[path], entry.after[path])) return { ok: false, reason: 'undo-state-changed' };
        }
        for (const path of entry.paths) {
          if (Object.prototype.hasOwnProperty.call(entry.before, path)) state[path] = structuredClone(entry.before[path]);
          else delete state[path];
        }
        return { ok: true };
      }
    });
    if (!transaction.ok) return { ok: false, reason: transaction.reason };
    return { ok: true, kind: entry.kind, subject: entry.subject, meta: entry.meta };
  }

  return Object.freeze({ capture, undo, size: () => entries.size });
}

module.exports = { DEFAULT_TTL_MS, DEFAULT_GRACE_MS, MAX_ENTRIES, pick, createUndoRegistry };
