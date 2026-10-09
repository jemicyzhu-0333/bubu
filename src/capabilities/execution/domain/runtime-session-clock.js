'use strict';

const ACTIVE_SESSION_STATUSES = new Set(['focus', 'quick-start', 'break']);

function finiteNonNegative(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function requireRuntimeTime(value, name) {
  const time = finiteNonNegative(value, null);
  if (time === null) throw new TypeError(`${name} must be a finite non-negative timestamp`);
  return time;
}

function isActiveRuntimeSession(session) {
  return Boolean(session && ACTIVE_SESSION_STATUSES.has(session.status));
}

function latestSessionEvidenceAt(session) {
  if (!session || typeof session !== 'object') return 0;
  let latest = 0;
  for (const candidate of [session.createdAt, session.startedAt, session.pausedAt, session.updatedAt]) {
    latest = Math.max(latest, finiteNonNegative(candidate, 0));
  }
  for (const segment of Array.isArray(session.activeSegments) ? session.activeSegments : []) {
    if (!segment || typeof segment !== 'object') continue;
    latest = Math.max(latest, finiteNonNegative(segment.endedAt, 0));
  }
  return latest;
}

function safeSessionWallTime(session, wallNow) {
  return Math.ceil(Math.max(
    requireRuntimeTime(wallNow, 'wallNow'),
    latestSessionEvidenceAt(session)
  ));
}

function sessionClockIdentity(session) {
  if (!isActiveRuntimeSession(session)) return null;
  return [
    session.sessionId,
    session.status,
    session.startedAt,
    session.elapsedBeforeStartMs,
    session.plannedDurationMs
  ].join('\u0000');
}

/**
 * Maps an active session onto a monotonic process clock.
 *
 * Wall time is sampled only through the injected port when a session starts,
 * resumes, or is recovered. Once anchored, clock corrections cannot remove
 * elapsed work or make a timer finish early.
 */
class RuntimeSessionClock {
  constructor({ wallNow, monotonicNow } = {}) {
    if (typeof wallNow !== 'function' || typeof monotonicNow !== 'function') {
      throw new TypeError('RuntimeSessionClock requires wallNow and monotonicNow functions');
    }
    this.wallNow = wallNow;
    this.monotonicNow = monotonicNow;
    this.anchorState = null;
  }

  clear() {
    this.anchorState = null;
  }

  anchor(session, wallAt = this.wallNow()) {
    if (!isActiveRuntimeSession(session)) {
      this.clear();
      return safeSessionWallTime(session, wallAt);
    }
    const logicalAt = safeSessionWallTime(session, wallAt);
    const monotonicAt = finiteNonNegative(this.monotonicNow(), 0);
    this.anchorState = {
      identity: sessionClockIdentity(session),
      logicalAt,
      monotonicAt,
      lastNow: logicalAt
    };
    return logicalAt;
  }

  now(session, wallAt = this.wallNow()) {
    if (!isActiveRuntimeSession(session)) {
      this.clear();
      return safeSessionWallTime(session, wallAt);
    }
    const identity = sessionClockIdentity(session);
    if (!this.anchorState || this.anchorState.identity !== identity) {
      return this.anchor(session, wallAt);
    }

    const monotonicAt = finiteNonNegative(this.monotonicNow(), this.anchorState.monotonicAt);
    const elapsed = Math.max(0, monotonicAt - this.anchorState.monotonicAt);
    const candidate = Math.floor(this.anchorState.logicalAt + elapsed);
    this.anchorState.lastNow = Math.max(
      this.anchorState.lastNow,
      candidate,
      Math.ceil(latestSessionEvidenceAt(session))
    );
    return this.anchorState.lastNow;
  }
}

module.exports = {
  RuntimeSessionClock,
  isActiveRuntimeSession,
  latestSessionEvidenceAt,
  safeSessionWallTime
};
