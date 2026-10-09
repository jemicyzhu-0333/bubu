'use strict';

const DEFAULT_IDLE_BREAK_SECONDS = 5 * 60;
const DEFAULT_AWAY_SECONDS = 90;

function positiveSeconds(value, fallback) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : fallback;
}

function requireTimestamp(value) {
  const timestamp = value;
  if (!Number.isFinite(timestamp) || timestamp < 0) {
    throw new TypeError('sitting clock timestamps must be finite non-negative numbers');
  }
  return timestamp;
}

function createSittingClock(options = {}) {
  const idleBreakSeconds = positiveSeconds(options.idleBreakSeconds, DEFAULT_IDLE_BREAK_SECONDS);
  const awaySeconds = Math.min(
    positiveSeconds(options.awaySeconds, DEFAULT_AWAY_SECONDS),
    idleBreakSeconds
  );
  let sittingSince = null;
  let lastSampleAt = null;

  function sittingMs(now) {
    const at = requireTimestamp(now);
    return sittingSince === null ? 0 : Math.max(0, at - sittingSince);
  }

  return Object.freeze({
    idleBreakSeconds,
    awaySeconds,
    sample({ now, idleSeconds } = {}) {
      const at = requireTimestamp(now);
      if (lastSampleAt !== null && (at < lastSampleAt || at - lastSampleAt > idleBreakSeconds * 1000)) {
        sittingSince = null;
      }
      lastSampleAt = at;
      if (!Number.isFinite(idleSeconds) || idleSeconds < 0) {
        sittingSince = null;
        return { sittingMs: 0, atKeyboard: false, rested: false };
      }
      const idle = idleSeconds;
      if (idle >= idleBreakSeconds) {
        sittingSince = null;
        return { sittingMs: 0, atKeyboard: false, rested: true };
      }
      if (sittingSince === null) sittingSince = at - idle * 1000;
      return {
        sittingMs: sittingMs(at),
        atKeyboard: idle <= awaySeconds,
        rested: false
      };
    },
    restart(now) {
      sittingSince = requireTimestamp(now);
      lastSampleAt = sittingSince;
    },
    noteRested() {
      sittingSince = null;
      lastSampleAt = null;
    },
    sittingMs
  });
}

module.exports = {
  DEFAULT_IDLE_BREAK_SECONDS,
  DEFAULT_AWAY_SECONDS,
  createSittingClock
};
