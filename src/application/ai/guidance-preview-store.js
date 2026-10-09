'use strict';

// Local-only confirmation tickets. Caller-owned snapshot/version checks run again
// inside the canonical UoW; no renderer-supplied preview is ever committed.
const { id } = require('../../core/ai-change-protocol');
const PREVIEW_TTL_MS = 15 * 60000;
const MAX_PREVIEWS = 32;
function createGuidancePreviewStore({ clock, idFactory } = {}) {
  if (!clock || typeof clock.now !== 'function' || typeof idFactory !== 'function') throw new TypeError('guidance preview requires clock and IDs');
  const previews = new Map();
  const outcomes = new Map();
  let sequence = 0;
  function put(value) {
    const now = clock.now();
    for (const [key, entry] of previews) {
      if (entry.expiresAt <= now && (!entry.attempted || entry.result !== null)) previews.delete(key);
    }
    if (previews.size >= MAX_PREVIEWS) return { ok: false, reason: 'guidance-preview-capacity' };
    const seed = idFactory();
    if (!id(seed) || sequence >= Number.MAX_SAFE_INTEGER) throw new TypeError('guidance preview ID must be unique');
    // The monotonic suffix prevents an expired/cancelled ID from ever targeting
    // a later ticket, even when an injected ID port repeats a seed.
    const previewId = `${seed.slice(0, 160)}:preview:${++sequence}`;
    const entry = { value: structuredClone(value), expiresAt: now + PREVIEW_TTL_MS, result: null, attempted: false };
    previews.set(previewId, entry);
    return { ...structuredClone(value), previewId, confirmationExpiresAt: entry.expiresAt };
  }
  function get(previewId) {
    const entry = previews.get(previewId);
    if (!entry || entry.expiresAt <= clock.now()) return null;
    return structuredClone(entry);
  }
  function complete(previewId, result) {
    const entry = previews.get(previewId);
    if (entry) {
      entry.result = structuredClone(result);
      // Recovery proofs outlive confirmation authority, but remain bounded.
      // An evicted identity is unknown, never evidence of zero writes.
      outcomes.delete(previewId);
      outcomes.set(previewId, structuredClone(result));
      while (outcomes.size > MAX_PREVIEWS) outcomes.delete(outcomes.keys().next().value);
    }
  }
  function outcome(previewId, verifyUncommitted = () => false) {
    const entry = previews.get(previewId);
    const result = entry?.result || outcomes.get(previewId);
    if (result) return structuredClone(result);
    if (!entry || entry.expiresAt > clock.now()) return null;
    if (entry.attempted) {
      // Only a verified canonical version can resolve an interrupted attempt.
      // Expiration and a cached renderer projection cannot prove zero writes.
      let uncommitted = false;
      try { uncommitted = verifyUncommitted(structuredClone(entry.value)) === true; } catch (_) {}
      if (!uncommitted) return { ok: false, reason: 'guidance-confirmation-uncertain', uncertain: true };
      complete(previewId, { ok: false, reason: 'guidance-preview-expired', committed: false });
      return structuredClone(entry.result);
    }
    return { ok: false, reason: 'guidance-preview-expired', committed: false };
  }
  function start(previewId) {
    const ticket = get(previewId);
    if (ticket) previews.get(previewId).attempted = true;
    return ticket;
  }
  function cancel(previewId) {
    if (!id(previewId)) return { ok: false, reason: 'guidance-preview-id-invalid' };
    const entry = previews.get(previewId);
    // A completed confirmation remains recoverable after a lost IPC reply.
    if ((entry?.result || outcomes.get(previewId))?.ok) return { ok: false, reason: 'guidance-preview-already-confirmed', confirmed: true };
    if (!entry) return { ok: true, cancelled: false };
    if (entry.attempted && entry.result === null) return { ok: false, reason: 'guidance-confirmation-uncertain', uncertain: true };
    previews.delete(previewId);
    return { ok: true, cancelled: true };
  }
  return Object.freeze({ put, get, start, outcome, complete, cancel });
}
module.exports = { PREVIEW_TTL_MS, MAX_PREVIEWS, createGuidancePreviewStore };
