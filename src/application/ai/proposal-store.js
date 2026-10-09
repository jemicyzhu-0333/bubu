'use strict';

const { trimmedString } = require('../../core/field-normalizers');
const { MAX_PROPOSALS, PROPOSAL_TTL_MS, validateProposal } = require('../../core/breakdown-proposal');

// The store is proposal-kind agnostic: a caller supplies the validator for the
// shape it puts in, so a breakdown and an enrich suggestion cannot be confused
// for one another while still sharing one TTL, one size cap and one identity
// space. It is called with the context too, because some constraints (which
// tags may be reused) only exist relative to the request.
class ProposalStore {
  constructor(options = {}) {
    const max = Number.isInteger(options.max) ? options.max : MAX_PROPOSALS;
    if (Number.isInteger(max) && max < 0) throw new RangeError('max must be a non-negative integer');
    this.max = max;
    this.ttlMs = Number.isInteger(options.ttlMs) ? options.ttlMs : PROPOSAL_TTL_MS;
    this.now = typeof options.now === 'function' ? options.now : Date.now;
    this.validate = typeof options.validate === 'function' ? options.validate : validateProposal;
    this.idFactory = typeof options.idFactory === 'function'
      ? options.idFactory
      : (() => `proposal-${this.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`);
    this.items = new Map();
  }

  prune(now = this.now()) {
    for (const [id, entry] of this.items) if (entry.expiresAt <= now) this.items.delete(id);
    while (this.items.size > this.max) this.items.delete(this.items.keys().next().value);
  }

  put(proposal, context = {}) {
    const now = this.now();
    this.prune(now);
    const id = this.idFactory();
    const normalizedContext = Object.freeze({
      kind: context.kind === 'enrich' ? 'enrich' : 'breakdown',
      title: trimmedString(context.title, null, 100),
      description: trimmedString(context.description, null, 1000),
      taskId: trimmedString(context.taskId, null, 100),
      allowedTags: Object.freeze(Array.isArray(context.allowedTags)
        ? [...new Set(context.allowedTags.map(tag => trimmedString(tag, null, 20)).filter(Boolean))]
        : [])
    });
    const entry = Object.freeze({
      id,
      createdAt: now,
      expiresAt: now + this.ttlMs,
      proposal: this.validate(proposal, normalizedContext),
      context: normalizedContext
    });
    this.items.set(id, entry);
    this.prune(now);
    return entry;
  }

  get(id) {
    this.prune();
    return this.items.get(id) || null;
  }

  consume(id) {
    const entry = this.get(id);
    if (entry) this.items.delete(id);
    return entry;
  }

  get size() { this.prune(); return this.items.size; }
}

module.exports = { ProposalStore };
