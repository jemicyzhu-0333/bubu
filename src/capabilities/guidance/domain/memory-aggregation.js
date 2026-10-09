'use strict';

// The only writer of `aggregated` long-term memories (ARCHITECTURE「事实流与长期记忆」: "记忆的写入
// 者只有一个 —— guidance 能力，它是唯一决定'什么值得记'的地方").
//
// Pure by construction: it takes the recent-activity digest plus `now` and
// returns entries to upsert. No clock, no store, no I/O — so "what would be
// remembered from this week" is a table-driven question a test can ask.
//
// Three rules this module exists to enforce:
//
// 1. **A thin sample writes nothing.** Every derivation has a floor below which
//    it returns nothing at all, rather than a hedged sentence. A memory that
//    says "你好像有点…" is worse than no memory: it will be injected into model
//    requests as fact for 90 days and it reinforces itself (ARCHITECTURE「事实流与长期记忆」).
// 2. **Fixed subjects, so the row count is bounded.** Each derivation has one
//    constant subject, and `unique_key` is kind + subject — today's version
//    replaces yesterday's instead of accreting. The aggregated writer therefore
//    can never approach the 500-row cap, and the user never sees a growing pile
//    of near-duplicates.
// 3. **No user text is copied in.** Task titles stay out of memory bodies even
//    though the digest carries them. A digest is computed per request and can be
//    withheld by turning the setting off; a memory row persists for 90 days and
//    is injected on every later request. Only counts and day spans cross that
//    line.

// ARCHITECTURE「事实流与长期记忆」: aggregated memories expire; user-confirmed ones never do.
const AGGREGATED_TTL_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

// Below these, the corresponding memory is not written. They are floors on
// evidence, not on interestingness.
const MIN_STREAK_DAYS = 3;
const MIN_SESSIONS = 5;
const MIN_FRICTION_COUNT = 3;

// The friction kinds the timeline actually records, in the words the user used
// when they produced the event.
const FRICTION_PHRASES = Object.freeze({
  'task.stuck': '卡住',
  'task.avoided': '绕开不做',
  'task.deferred': '往后推'
});

function positiveInt(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : 0;
}

// Confidence rises with sample size and saturates. It is never 1: these are
// summaries of a two-week window, not facts about the person.
function sampleConfidence(sampleSize, base, per) {
  return Math.min(0.9, Math.round((base + per * sampleSize) * 100) / 100);
}

function dayCount(range) {
  if (!range || !range.fromDayKey || !range.toDayKey) return 0;
  const from = Date.parse(`${range.fromDayKey}T00:00:00Z`);
  const to = Date.parse(`${range.toDayKey}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return 0;
  return Math.round((to - from) / DAY_MS) + 1;
}

// One entry per derivation that clears its floor. Order is stable so a caller
// can diff two runs.
function aggregateMemories(digest, { now, ttlDays = AGGREGATED_TTL_DAYS } = {}) {
  if (!digest || typeof digest !== 'object') return [];
  if (!Number.isFinite(now)) return [];
  const expiresAt = now + Math.max(1, Math.trunc(ttlDays) || AGGREGATED_TTL_DAYS) * DAY_MS;
  const windowDays = dayCount(digest.range);
  const sessions = positiveInt(digest.sessionCount);
  const completed = positiveInt(digest.completedTaskCount);
  const abandoned = positiveInt(digest.abandonedSessionCount);
  const streak = positiveInt(digest.streakDays);
  const entries = [];

  if (streak >= MIN_STREAK_DAYS) {
    entries.push({
      kind: 'rhythm',
      subject: '连续投入的天数',
      body: windowDays
        ? `最近 ${windowDays} 天里，有连续 ${streak} 天开过专注。`
        : `有连续 ${streak} 天开过专注。`,
      source: 'aggregated',
      confidence: sampleConfidence(streak, 0.45, 0.05),
      expiresAt
    });
  }

  if (sessions >= MIN_SESSIONS) {
    // Two numbers, no interpretation. "完成率低" would be a judgement the
    // timeline cannot support: an abandoned session is not a failed one.
    const parts = [`开过 ${sessions} 段专注`, `完成了 ${completed} 件事`];
    if (abandoned > 0) parts.push(`${abandoned} 段提前停下`);
    entries.push({
      kind: 'pattern',
      subject: '专注与完成的量',
      body: windowDays
        ? `最近 ${windowDays} 天：${parts.join('，')}。`
        : `${parts.join('，')}。`,
      source: 'aggregated',
      confidence: sampleConfidence(sessions, 0.4, 0.01),
      expiresAt
    });
  }

  const signals = Array.isArray(digest.frictionSignals) ? digest.frictionSignals : [];
  // Only the most frequent one. A list of three friction kinds reads as a
  // verdict on the person; one counted fact reads as a record.
  const top = signals
    .filter(signal => signal && FRICTION_PHRASES[signal.kind] && positiveInt(signal.count) >= MIN_FRICTION_COUNT)
    .sort((a, b) => positiveInt(b.count) - positiveInt(a.count))[0];
  if (top) {
    const count = positiveInt(top.count);
    entries.push({
      kind: 'friction',
      subject: '最常出现的卡点',
      body: windowDays
        ? `最近 ${windowDays} 天里，有 ${count} 次任务被标成「${FRICTION_PHRASES[top.kind]}」。`
        : `有 ${count} 次任务被标成「${FRICTION_PHRASES[top.kind]}」。`,
      source: 'aggregated',
      confidence: sampleConfidence(count, 0.4, 0.03),
      expiresAt
    });
  }

  return entries;
}

module.exports = {
  aggregateMemories,
  AGGREGATED_TTL_DAYS,
  MIN_STREAK_DAYS,
  MIN_SESSIONS,
  MIN_FRICTION_COUNT,
  FRICTION_PHRASES
};
