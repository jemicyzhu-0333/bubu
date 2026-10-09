'use strict';

const {
  normalizeCompanionState,
  appendRecent,
  addDiscovery
} = require('./companion-state');
const { hardGateReason, selectSurprise, recordIssued } = require('./surprise-rules');
const { indexContentManifest } = require('./content-pack');

const ACK_STATUS = Object.freeze({ received: 1, started: 2, completed: 3, cancelled: 3, rejected: 3 });

class SurpriseDirector {
  constructor(options) {
    if (!options || typeof options.loadState !== 'function' || typeof options.saveState !== 'function') {
      throw new TypeError('loadState and saveState are required');
    }
    if (!options.clock || typeof options.clock.now !== 'function') throw new TypeError('clock is required');
    if (typeof options.rng !== 'function' || typeof options.deliver !== 'function') throw new TypeError('rng and deliver are required');
    this.loadState = options.loadState;
    this.saveState = options.saveState;
    this.clock = options.clock;
    this.monotonicClock = options.monotonicClock || this.clock;
    if (typeof this.monotonicClock.now !== 'function') throw new TypeError('monotonicClock is invalid');
    this.rng = options.rng;
    this.deliver = options.deliver;
    this.schedule = options.setTimeout || setTimeout;
    this.unschedule = options.clearTimeout || clearTimeout;
    this.retryDelayMs = options.retryDelayMs || 1_000;
    this.ttlMs = options.ttlMs || 15_000;
    this.idFactory = options.idFactory || (() => `decision-${this.wallNow().toString(36)}-${Math.floor(this.rng() * 0xfffffff).toString(36)}`);
    this.manifest = options.manifest;
    this.content = indexContentManifest(this.manifest);
    this.timer = null;
    this.timerGeneration = 0;
    this.context = {};
    this.envelopes = new Map();
    this.deliveryDeadlines = new Map();
    this.lastWallNow = 0;
    this.lastMonotonicNow = 0;
    this.disposed = false;
  }

  wallNow() {
    const candidate = this.clock.now();
    if (!Number.isSafeInteger(candidate) || candidate < 0) {
      throw new RangeError('clock.now must return a non-negative safe integer');
    }
    this.lastWallNow = Math.max(this.lastWallNow, candidate);
    return this.lastWallNow;
  }

  monotonicNow() {
    const candidate = this.monotonicClock.now();
    if (!Number.isFinite(candidate) || candidate < 0) {
      throw new RangeError('monotonicClock.now must return a non-negative number');
    }
    this.lastMonotonicNow = Math.max(this.lastMonotonicNow, candidate);
    return this.lastMonotonicNow;
  }

  state() {
    return normalizeCompanionState(this.loadState());
  }

  persist(state) {
    const normalized = normalizeCompanionState(state);
    // Every runtime write must satisfy the same exact schema accepted during
    // startup; this keeps a malformed Director mutation from being repaired
    // silently on the next launch.
    normalizeCompanionState(normalized, { strict: true });
    this.saveState(normalized);
    return normalized;
  }

  clearTimer() {
    if (this.timer !== null) this.unschedule(this.timer);
    this.timer = null;
    this.timerGeneration += 1;
  }

  recoverAfterRestart() {
    this.clearTimer();
    this.envelopes.clear();
    this.deliveryDeadlines.clear();
    const state = this.state();
    const pending = state.surprise.pending;
    if (!pending) return { cleaned: false, state };
    const now = Math.max(this.wallNow(), pending.issuedAt);
    state.surprise.pending = null;
    const cleaned = appendRecent(state, {
      decisionId: pending.decisionId,
      cueId: pending.cueId,
      familyId: pending.familyId,
      finishedAt: now,
      outcome: 'cancelled'
    });
    this.persist(cleaned);
    return { cleaned: true, state: cleaned };
  }

  tick(context = this.context) {
    if (this.disposed) return { issued: false, reason: 'disposed' };
    this.context = { ...context };
    const now = this.wallNow();
    const selectionClock = { now: () => now };
    if (typeof this.clock.dayKey === 'function') {
      selectionClock.dayKey = timestamp => this.clock.dayKey(timestamp);
    }
    const selection = selectSurprise({
      companion: this.state(), manifest: this.manifest,
      context: this.context, clock: selectionClock, rng: this.rng
    });
    if (!selection.cue) {
      this.persist(selection.state);
      return { issued: false, reason: selection.reason };
    }
    const decisionId = this.idFactory();
    const issuedAt = now;
    const state = recordIssued(selection.state, selection.cue, issuedAt, decisionId, this.ttlMs);
    this.persist(state);
    const envelope = {
      version: 1,
      decisionId,
      cueId: selection.cue.id,
      familyId: selection.cue.familyId,
      issuedAt,
      expiresAt: state.surprise.pending.expiresAt,
      variant: selection.variant.id
    };
    this.envelopes.set(decisionId, envelope);
    this.deliveryDeadlines.set(decisionId, this.monotonicNow() + (envelope.expiresAt - issuedAt));
    this.presentCue(envelope);
    return { issued: true, envelope };
  }

  presentCue(envelope) {
    try {
      this.deliver({ ...envelope });
    } finally {
      this.armDeliveryTimer(envelope.decisionId);
    }
  }

  armDeliveryTimer(decisionId) {
    this.clearTimer();
    const pending = this.state().surprise.pending;
    if (!pending || pending.decisionId !== decisionId) return;
    const now = this.wallNow();
    const monotonicNow = this.monotonicNow();
    const monotonicDeadline = this.deliveryDeadlines.get(decisionId)
      ?? monotonicNow + Math.max(0, pending.expiresAt - Math.max(now, pending.issuedAt));
    this.deliveryDeadlines.set(decisionId, monotonicDeadline);
    if (now >= pending.expiresAt || monotonicNow >= monotonicDeadline) {
      this.finish('cancelled', Math.max(now, pending.issuedAt));
      return;
    }
    const remaining = Math.min(pending.expiresAt - now, monotonicDeadline - monotonicNow);
    const wait = pending.status === 'issued' && pending.attempts < 3
      ? Math.min(this.retryDelayMs, remaining)
      : remaining;
    const generation = this.timerGeneration;
    this.timer = this.schedule(() => {
      if (generation !== this.timerGeneration || this.disposed) return;
      this.timer = null;
      const state = this.state();
      const current = state.surprise.pending;
      if (!current || current.decisionId !== decisionId) return;
      const tickNow = this.wallNow();
      const tickMonotonicNow = this.monotonicNow();
      if (tickNow >= current.expiresAt || tickMonotonicNow >= monotonicDeadline) {
        this.finish('cancelled', Math.max(tickNow, current.issuedAt));
        return;
      }
      if (current.status === 'issued' && current.attempts < 3) {
        current.attempts += 1;
        this.persist(state);
        const envelope = this.envelopes.get(decisionId);
        if (envelope) {
          try { this.deliver({ ...envelope }); }
          finally { this.armDeliveryTimer(decisionId); }
          return;
        }
      }
      this.armDeliveryTimer(decisionId);
    }, Math.max(1, wait));
  }

  acknowledge({ decisionId, status }) {
    const state = this.state();
    const pending = state.surprise.pending;
    if (!pending || pending.decisionId !== decisionId) {
      const terminal = state.surprise.recent.find(item => item.decisionId === decisionId);
      return terminal ? { ok: true, duplicate: true, status: terminal.outcome } : { ok: false, reason: 'unknown-decision' };
    }
    if (!Object.prototype.hasOwnProperty.call(ACK_STATUS, status)) return { ok: false, reason: 'invalid-status' };
    const currentRank = pending.status === 'issued' ? 0 : pending.status === 'received' ? 1 : 2;
    const nextRank = ACK_STATUS[status];
    if (nextRank < currentRank || (nextRank === currentRank && status === pending.status)) {
      return { ok: true, duplicate: true, status: pending.status };
    }
    if (status === 'received' && pending.status !== 'issued') return { ok: true, stale: true, status: pending.status };
    if (status === 'started' && pending.status !== 'received') return { ok: false, reason: 'out-of-order' };
    if (['completed', 'cancelled', 'rejected'].includes(status) && status === 'completed' && pending.status !== 'started') {
      return { ok: false, reason: 'out-of-order' };
    }
    if (status === 'received' || status === 'started') {
      pending.status = status;
      this.persist(state);
      this.armDeliveryTimer(decisionId);
      return { ok: true, status };
    }
    return this.finish(status, Math.max(this.wallNow(), pending.issuedAt));
  }

  finish(outcome, finishedAt) {
    this.clearTimer();
    const state = this.state();
    const pending = state.surprise.pending;
    if (!pending) return { ok: true, duplicate: true, status: outcome };
    this.envelopes.delete(pending.decisionId);
    this.deliveryDeadlines.delete(pending.decisionId);
    state.surprise.pending = null;
    let next = state;
    let terminalOutcome = outcome;
    const cue = this.content.get(pending.cueId);
    if (outcome === 'completed' && cue && cue.discoveryId) {
      try { next = addDiscovery(next, cue.discoveryId, finishedAt); }
      catch (_) { terminalOutcome = 'rejected'; }
    }
    next = appendRecent(next, {
      decisionId: pending.decisionId,
      cueId: pending.cueId,
      familyId: pending.familyId,
      finishedAt,
      outcome: terminalOutcome
    });
    this.persist(next);
    return { ok: true, status: terminalOutcome };
  }

  updateContext(context) {
    this.context = { ...context };
    const state = this.state();
    const pending = state.surprise.pending;
    if (!pending) return { cancelled: false };
    const cue = this.content.get(pending.cueId);
    const reason = cue ? hardGateReason(cue, this.context) : 'missing-content';
    if (!reason) return { cancelled: false };
    this.deliver({ version: 1, decisionId: pending.decisionId, cancel: true, reason });
    this.finish('cancelled', Math.max(this.wallNow(), pending.issuedAt));
    return { cancelled: true, reason };
  }

  dispose() {
    this.disposed = true;
    this.clearTimer();
    this.envelopes.clear();
    this.deliveryDeadlines.clear();
  }
}

module.exports = { ACK_STATUS, SurpriseDirector };
