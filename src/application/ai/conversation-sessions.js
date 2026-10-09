'use strict';

const { COLLABORATION_BUDGET, unicodeLength, serializedBytes } = require('./run-budget');
const { SNAPSHOT_VERSION, MAX_INPUT_DRAFT_CHARS, MAX_SNAPSHOT_BYTES, PURPOSES, MODES, id, time, text, sourceRefsValid, proposalValid, provenanceValid,
  relatedEntityValid, retentionValid, validateConversationSnapshot, clone, immutable, mergeSourceRefs } = require('./conversation-record');
const { listConversationCatalog } = require('./conversation-catalog');
const { deriveConversationSummary } = require('./conversation-summary');
const { createConversationPersistence } = require('./conversation-persistence');

const RESPONSE_RESERVE_BYTES = 128 * 1024;
const DAY_MS = 86400000;
const MAX_TIMER_MS = 2147483647;
const TOKEN_KEYS = ['conversationId', 'turnId', 'requestId', 'authGeneration', 'providerId'];

// This use case owns the transcript lifecycle. The repository is a narrow port,
// and neither saved text nor a renderer claim can authorize a new request.
function createCollaborationSessions({ ownerId, repository = null, now, idFactory, maxCached = 3,
  schedule = setTimeout, cancelSchedule = clearTimeout, admission } = {}) {
  if (!id(ownerId) || typeof now !== 'function' || typeof idFactory !== 'function'
    || typeof schedule !== 'function' || typeof cancelSchedule !== 'function'
    || !Number.isSafeInteger(maxCached) || maxCached < 1 || maxCached > 100) throw new TypeError('conversation-options-invalid');
  const entries = new Map();
  const issuedIds = new Set();
  const expiredIds = new Map();
  let retentionTimer = null;
  let retentionFailure = null;
  let sequence = 0;
  let disposed = false;
  let disposalResult = null;
  const persistence = createConversationPersistence({ repository, ownerId, now: timestamp });

  function timestamp() {
    const at = now();
    if (!time(at)) throw new TypeError('conversation-clock-invalid');
    return at;
  }
  function deadline(record) {
    return record.retention.mode === 'saved' && !record.retention.pinned
      ? record.updatedAt + record.retention.days * DAY_MS : null;
  }
  function expiryResult(conversationId) {
    const expiry = expiredIds.get(conversationId);
    return { ok: false, reason: 'conversation-expired', deletion: expiry?.deletion || 'pending',
      ...(expiry?.cleanupReason ? { cleanupReason: expiry.cleanupReason } : {}) };
  }
  function armRetention() {
    if (retentionTimer !== null) cancelSchedule(retentionTimer);
    retentionTimer = null;
    if (disposed) return;
    const deadlines = [...entries.values()].map(entry => entry.retentionDeadline).filter(value => value !== null);
    if (!deadlines.length) return;
    const delay = Math.max(1, Math.min(MAX_TIMER_MS, Math.min(...deadlines) - timestamp()));
    retentionTimer = schedule(() => { retentionTimer = null; if (!disposed) enforceRetention(); }, delay);
    retentionTimer?.unref?.();
  }
  function enforceRetention() {
    const at = timestamp();
    for (const [conversationId, entry] of entries) {
      if (entry.retentionDeadline === null || entry.retentionDeadline > at) continue;
      abort(entry, 'conversation-expired', true);
      entry.expired = true;
      entries.delete(conversationId);
      expiredIds.set(conversationId, { deletion: 'pending', cleanupReason: null,
        pendingEntry: entry.pendingSave ? { pendingSave: entry.pendingSave, savedRevision: entry.savedRevision } : null });
    }
    // Keep only the private exact proof/deletion intent after hiding expired text.
    // A proved save may have extended or pinned disk retention; prune alone cannot remove it.
    for (const [conversationId, expiry] of expiredIds) {
      const entry = expiry.pendingEntry;
      if (!entry) continue;
      const settled = persistence.reconcile(entry);
      if (!settled.ok) { expiry.cleanupReason = settled.reason; continue; }
      let removed;
      try { removed = entry.savedRevision > 0
        ? repository?.delete({ ownerId, conversationId, expectedRevision: entry.savedRevision }) : { ok: true }; }
      catch (_) { removed = null; }
      if (removed?.ok) expiry.pendingEntry = null;
      else expiry.cleanupReason = removed?.reason || 'conversation-delete-failed';
    }
    let pruned;
    try { pruned = repository ? repository.pruneRetention?.({ ownerId, now: at }) : { ok: true }; }
    catch (_) { pruned = null; }
    retentionFailure = pruned?.ok ? null : pruned?.reason || 'conversation-retention-unavailable';
    for (const [conversationId, expiry] of expiredIds) {
      if (expiry.deletion === 'confirmed') continue;
      if (expiry.pendingEntry) { retentionFailure = expiry.cleanupReason || 'conversation-save-unknown'; continue; }
      if (retentionFailure) { expiry.cleanupReason = retentionFailure; continue; }
      let stored;
      try { stored = repository ? repository.load({ ownerId, conversationId }) : { ok: false, reason: 'conversation-not-found' }; }
      catch (_) { stored = null; }
      if (!stored?.ok && stored?.reason === 'conversation-not-found') {
        expiry.deletion = 'confirmed'; expiry.cleanupReason = null;
      } else {
        expiry.cleanupReason = stored?.reason || 'conversation-retention-failed';
        retentionFailure = expiry.cleanupReason;
      }
    }
    armRetention();
    return retentionFailure ? { ok: false, reason: retentionFailure } : { ok: true };
  }
  function nextId(kind) {
    for (let attempt = 0; attempt < 1000; attempt += 1) {
      const value = idFactory(++sequence, kind);
      if (id(value) && !issuedIds.has(value)) { issuedIds.add(value); return value; }
    }
    throw new Error('conversation-id-exhausted');
  }
  function snapshot(entry) {
    if (entry.expired) return null;
    const record = clone(entry.record);
    // Runtime authorization is never restored from a transcript. Old derived
    // source text remains readable but cannot replay through a fresh grant.
    if (!entry.active && record.status === 'generating') record.status = 'paused';
    const blocked = new Set();
    for (const message of record.messages) {
      if ((message.sequence <= entry.restoredThrough || entry.contextEligibilityPending === true)
        && message.role !== 'user' && message.sourceRefs.length) message.contextAllowed = false;
      if (!message.contextAllowed) blocked.add(message.id);
    }
    for (const summary of record.summaries) {
      if ((entry.contextEligibilityPending === true && summary.sourceRefs.length)
        || summary.coveredMessageIds.some(messageId => blocked.has(messageId))) summary.contextAllowed = false;
    }
    return immutable({ ...record, authGeneration: entry.authGeneration,
      requiresAuthorization: entry.requiresAuthorization, contextEligibilityPending: entry.contextEligibilityPending === true,
      savedRevision: entry.savedRevision,
      recoverable: entry.record.retention.mode === 'saved' && entry.savedRevision === entry.record.revision,
      saveState: entry.record.retention.mode === 'ephemeral' ? 'ephemeral'
        : entry.savedRevision === entry.record.revision ? 'saved' : 'unsaved',
      saveError: entry.saveError });
  }
  function persist(entry) {
    if (entry.expired || (entry.retentionDeadline !== null && entry.retentionDeadline <= timestamp())) {
      enforceRetention();
      return expiryResult(entry.record.id);
    }
    if (entry.record.retention.mode === 'ephemeral') return { ok: true };
    if (entry.savedRevision === entry.record.revision) return { ok: true };
    const saved = persistence.save(entry);
    if (!saved.ok) return saved;
    armRetention();
    return { ok: true };
  }
  function touch(entry) {
    entry.record.revision += 1;
    entry.record.updatedAt = Math.max(timestamp(), entry.record.updatedAt);
  }
  function abort(entry, reason, invalidate = false) {
    const active = entry.active;
    entry.active = null;
    if (invalidate) { entry.authGeneration += 1; entry.requiresAuthorization = true; }
    // Abort listeners run synchronously; retire the captured authority first.
    if (active) active.controller.abort(reason);
  }
  function makeRoom() {
    if (entries.size < maxCached) return true;
    // An eviction only releases a verified durable snapshot. Unsaved or ephemeral
    // content is never discarded merely to make room for another window.
    const candidate = [...entries.values()].filter(entry => !entry.active
      && entry.record.retention.mode === 'saved' && entry.savedRevision === entry.record.revision)
      .sort((a, b) => a.lastAccess - b.lastAccess)[0];
    if (!candidate) return false;
    abort(candidate, 'conversation-cache-released', true);
    entries.delete(candidate.record.id);
    return true;
  }
  function owned(conversationId) {
    if (disposed) return { ok: false, reason: 'conversation-sessions-disposed' };
    if (!id(conversationId)) return { ok: false, reason: 'conversation-id-invalid' };
    enforceRetention();
    if (expiredIds.has(conversationId)) return expiryResult(conversationId);
    let entry = entries.get(conversationId);
    if (!entry) {
      let result;
      try { result = repository?.load({ ownerId, conversationId, now: timestamp() }); } catch (_) { result = null; }
      if (!result?.ok) {
        if (result?.reason === 'conversation-expired') {
          expiredIds.set(conversationId, { deletion: 'pending', cleanupReason: retentionFailure });
          return expiryResult(conversationId);
        }
        return { ok: false, reason: result?.reason || 'conversation-not-found' };
      }
      if (!validateConversationSnapshot(result.conversation) || result.conversation.ownerId !== ownerId) {
        return { ok: false, reason: 'conversation-storage-corrupt' };
      }
      if (deadline(result.conversation) !== null && deadline(result.conversation) <= timestamp()) {
        expiredIds.set(conversationId, { deletion: 'pending', cleanupReason: retentionFailure });
        return expiryResult(conversationId);
      }
      if (!makeRoom()) return { ok: false, reason: 'conversation-cache-full' };
      entry = { record: clone(result.conversation), savedRevision: result.conversation.revision,
        saveError: null, authGeneration: 1, requiresAuthorization: true, providerId: null, active: null, lastAccess: timestamp(),
        restoredThrough: result.conversation.messages.length, retentionDeadline: deadline(result.conversation),
        retentionInitialized: true, expired: false };
      for (const item of [entry.record, ...entry.record.messages, ...entry.record.summaries]) issuedIds.add(item.id);
      entries.set(conversationId, entry);
      armRetention();
    }
    entry.lastAccess = timestamp();
    return { ok: true, entry };
  }
  function result(entry, extra = {}) { return entry.expired ? expiryResult(entry.record.id)
    : { ok: true, conversation: snapshot(entry), ...extra }; }

  function start({ purpose = 'task', mode = 'talk', relatedEntity = null } = {}) {
    if (disposed) return { ok: false, reason: 'conversation-sessions-disposed' };
    if (!PURPOSES.includes(purpose) || !MODES.includes(mode) || !relatedEntityValid(relatedEntity)) return { ok: false, reason: 'conversation-start-invalid' };
    enforceRetention();
    if (!makeRoom()) return { ok: false, reason: 'conversation-cache-full' };
    let conversationId;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      conversationId = nextId('conversation');
      let existing;
      try { existing = repository?.load({ ownerId, conversationId }); } catch (_) { existing = null; }
      if (!existing?.ok) break;
      conversationId = null;
    }
    if (!conversationId) return { ok: false, reason: 'conversation-id-exhausted' };
    const at = timestamp();
    const entry = { record: { version: SNAPSHOT_VERSION, id: conversationId, ownerId, revision: 1,
      purpose, mode, relatedEntity: clone(relatedEntity), createdAt: at, updatedAt: at, status: 'idle',
      retention: { mode: 'ephemeral', days: 30, pinned: false }, messages: [], summaries: [],
      inputDraft: '', selectedProposalId: null, scrollTop: 0, segment: { index: 0, turns: 0, bytes: 0 }, softNoticeShown: false },
    savedRevision: 0, saveError: null, authGeneration: 0, requiresAuthorization: true,
    providerId: null, active: null, lastAccess: at, restoredThrough: 0,
    retentionDeadline: null, retentionInitialized: false, expired: false };
    entries.set(conversationId, entry);
    return result(entry);
  }
  function get({ conversationId } = {}) {
    const found = owned(conversationId);
    return found.ok ? result(found.entry) : found;
  }
  function list({ limit = 20, cursor = null } = {}) {
    if (disposed) return { ok: false, reason: 'conversation-sessions-disposed' };
    const retention = enforceRetention();
    if (!retention.ok) {
      // Expired entries have already been retired. Storage degradation must not
      // hide the remaining verified local work or pretend saved history is empty.
      const local = listConversationCatalog({ repository: null, ownerId, entries, limit, cursor, localOnly: true });
      return { ...local, availability: 'unavailable', reason: retention.reason, deletion: 'pending' };
    }
    const at = timestamp();
    const currentRepository = repository ? { listPage: request => repository.listPage({ ...request, now: at }) } : null;
    return listConversationCatalog({ repository: currentRepository, ownerId, entries, limit, cursor });
  }
  function applyDraft(entry, inputDraft, selectedProposalId, scrollTop) {
    if (inputDraft !== undefined && !text(inputDraft, MAX_INPUT_DRAFT_CHARS)) return false;
    if (scrollTop !== undefined && (!Number.isFinite(scrollTop) || scrollTop < 0 || scrollTop > 1e7)) return false;
    if (selectedProposalId !== undefined && selectedProposalId !== null
      && !entry.record.messages.some(message => message.proposal?.id === selectedProposalId)) return false;
    if (inputDraft !== undefined) entry.record.inputDraft = inputDraft;
    if (selectedProposalId !== undefined) entry.record.selectedProposalId = selectedProposalId;
    if (scrollTop !== undefined) entry.record.scrollTop = scrollTop;
    return true;
  }
  function setRetention({ conversationId, mode, retentionDays = 30, pinned = false, inputDraft, selectedProposalId, scrollTop } = {}) {
    const found = owned(conversationId);
    if (!found.ok) return found;
    const entry = found.entry;
    const retention = { mode, days: retentionDays, pinned };
    if (!retentionValid(retention)) return { ok: false, reason: 'conversation-retention-invalid' };
    const candidate = { record: clone(entry.record) };
    if (!applyDraft(candidate, inputDraft, selectedProposalId, scrollTop)) return { ok: false, reason: 'conversation-draft-invalid' };
    if (mode === 'ephemeral') {
      const settled = persistence.reconcile(entry);
      if (!settled.ok) return { ...settled, conversation: snapshot(entry) };
    }
    if (mode === 'ephemeral' && entry.savedRevision > 0) {
      let removed;
      try { removed = repository?.delete({ ownerId, conversationId, expectedRevision: entry.savedRevision }); } catch (_) { removed = null; }
      if (!removed?.ok) return { ok: false, reason: removed?.reason || 'conversation-delete-failed', conversation: snapshot(entry) };
      entry.savedRevision = 0;
    }
    entry.record = candidate.record;
    entry.record.retention = retention;
    if (mode === 'ephemeral') {
      entry.saveError = null; entry.retentionDeadline = null; entry.retentionInitialized = false;
    }
    touch(entry);
    if (mode === 'saved' && !entry.retentionInitialized) {
      entry.retentionDeadline = deadline(entry.record); entry.retentionInitialized = true;
    }
    const saved = persist(entry);
    return { ...saved, conversation: snapshot(entry) };
  }
  function rotateSegment(entry, candidate, upcomingBytes) {
    const current = candidate.segment;
    if (current.turns < COLLABORATION_BUDGET.maxSegmentTurns
      && current.bytes + upcomingBytes + RESPONSE_RESERVE_BYTES <= COLLABORATION_BUDGET.maxSegmentBytes) return { ok: true };
    const durable = persist(entry);
    if (!durable.ok) return durable;
    const messages = candidate.messages.filter(message => message.segment === current.index);
    if (messages.length) candidate.summaries.push(deriveConversationSummary({ messages,
      selectedProposalId: candidate.selectedProposalId, id: nextId('summary'), segment: current.index }));
    candidate.segment = { index: current.index + 1, turns: 0, bytes: 0 };
    return { ok: true };
  }
  function witness(entry) {
    return { record: entry.record, revision: entry.record.revision, active: entry.active,
      generation: entry.authGeneration, providerId: entry.providerId };
  }
  function matches(entry, captured) {
    return !disposed && !entry.expired && entries.get(captured.record.id) === entry
      && entry.record === captured.record && entry.record.revision === captured.revision
      && entry.active === captured.active && entry.authGeneration === captured.generation
      && entry.providerId === captured.providerId;
  }
  function accepted(entry, applied, extra) {
    if (matches(entry, applied)) {
      try { persist(entry); } catch (_) { /* Canonical acceptance cannot become a retry. */ }
    }
    let conversation = null;
    try { if (!disposed && !entry.expired && entries.get(applied.record.id) === entry) conversation = snapshot(entry); } catch (_) {}
    return { ok: true, conversation, ...extra };
  }
  function beginTurn({ conversationId, message, providerId, authorizationGeneration, sourceRefs = [], selectedProposalId, admissionTicket } = {}) {
    const ticket = admissionTicket === undefined ? admission?.captureAdmission() : admissionTicket;
    const allowed = () => !admission || admission.isAdmissionCurrent(ticket);
    if (!allowed()) return { ok: false, reason: 'authorization-busy' };
    const found = owned(conversationId);
    if (!found.ok) return found;
    const entry = found.entry;
    const captured = witness(entry);
    if (!allowed()) return { ok: false, reason: 'conversation-turn-stale' };
    if (entry.contextEligibilityPending === true) {
      return { ok: false, reason: 'conversation-context-pending', conversation: snapshot(entry) };
    }
    if (typeof message !== 'string' || !message.trim()) return { ok: false, reason: 'message-required' };
    if (unicodeLength(message) > COLLABORATION_BUDGET.maxMessageChars) return { ok: false, reason: 'message-too-long' };
    if (!id(providerId) || !sourceRefsValid(sourceRefs)) return { ok: false, reason: 'conversation-context-invalid' };
    if (selectedProposalId !== undefined && selectedProposalId !== null
      && !entry.record.messages.some(item => item.proposal?.id === selectedProposalId)) return { ok: false, reason: 'conversation-draft-invalid' };
    if (authorizationGeneration !== entry.authGeneration) return { ok: false, reason: 'conversation-authorization-required' };
    if (entry.providerId !== null && entry.providerId !== providerId) {
      revoke({ conversationId });
      return { ok: false, reason: 'provider-changed', conversation: snapshot(entry) };
    }
    const turnId = nextId('turn');
    const requestId = nextId('request');
    const user = { id: nextId('message'), role: 'user', sequence: entry.record.messages.length + 1,
      content: message, proposal: null, requestId, turnId, segment: entry.record.segment.index,
      createdAt: Math.max(timestamp(), entry.record.updatedAt), sourceRefs: [], contextAllowed: true, provenance: null };
    if (serializedBytes(entry.record) + serializedBytes(user) + RESPONSE_RESERVE_BYTES > MAX_SNAPSHOT_BYTES) {
      return { ok: false, reason: 'conversation-capacity', conversation: snapshot(entry) };
    }
    const candidate = clone(captured.record);
    if (!allowed() || !matches(entry, captured)) return { ok: false, reason: 'conversation-turn-stale' };
    const rotated = rotateSegment(entry, candidate, serializedBytes(user));
    if (!rotated.ok) return { ...rotated, conversation: snapshot(entry) };
    user.segment = candidate.segment.index;
    if (selectedProposalId !== undefined) candidate.selectedProposalId = selectedProposalId;
    const token = immutable({ conversationId, turnId, requestId, authGeneration: entry.authGeneration, providerId });
    const active = { token, controller: new AbortController(), sourceRefs: clone(sourceRefs) };
    candidate.messages.push(user);
    candidate.inputDraft = '';
    candidate.status = 'generating';
    candidate.segment.turns += 1;
    candidate.segment.bytes += serializedBytes(user);
    candidate.revision += 1;
    candidate.updatedAt = Math.max(timestamp(), candidate.updatedAt);
    if (!allowed() || !matches(entry, captured) || entry.contextEligibilityPending === true) {
      return { ok: false, reason: 'conversation-turn-stale' };
    }
    entry.record = candidate;
    entry.active = active;
    entry.providerId = providerId;
    entry.requiresAuthorization = false;
    const applied = witness(entry);
    try { captured.active?.controller.abort('turn-superseded'); } catch (_) {}
    return accepted(entry, applied, { token, signal: active.controller.signal, acceptedMessageId: user.id });
  }
  function completeTurn({ token, providerId, content, proposal = null, sourceRefs = [], provenance = null, admissionTicket } = {}) {
    const allowed = () => !admission || admission.isExistingCurrent(admissionTicket);
    if (!allowed()) return { ok: false, reason: 'conversation-turn-stale' };
    const found = owned(token?.conversationId);
    if (!found.ok) return found;
    const entry = found.entry;
    const captured = witness(entry);
    if (!allowed()) return { ok: false, reason: 'conversation-turn-stale' };
    if (!token || Object.keys(token).length !== TOKEN_KEYS.length || !entry.active
      || !TOKEN_KEYS.every(key => token[key] === entry.active.token[key])
      || token.authGeneration !== entry.authGeneration || entry.active.controller.signal.aborted) {
      return { ok: false, reason: 'conversation-turn-stale' };
    }
    if (providerId !== token.providerId || providerId !== entry.providerId) {
      revoke({ conversationId: token.conversationId });
      return { ok: false, reason: 'provider-changed', conversation: snapshot(entry) };
    }
    if (!text(content, COLLABORATION_BUDGET.maxOutputChars) || (!content.trim() && proposal === null)
      || !proposalValid(proposal) || !sourceRefsValid(sourceRefs) || !provenanceValid(provenance)
      || (provenance?.source === 'provider' && provenance.providerId !== token.providerId)) return { ok: false, reason: 'conversation-response-invalid' };
    // The orchestrator supplies the sources it actually included. Inferring
    // dependencies from an excluded old answer would reintroduce stale versions.
    const sources = mergeSourceRefs([entry.active.sourceRefs, sourceRefs]);
    if (sources.length > 50) return { ok: false, reason: 'conversation-source-budget' };
    const assistant = { id: nextId('message'), role: 'assistant', sequence: entry.record.messages.length + 1,
      content, proposal: clone(proposal), requestId: token.requestId, turnId: token.turnId,
      segment: entry.record.segment.index, createdAt: Math.max(timestamp(), entry.record.updatedAt), sourceRefs: clone(sources.slice(0, 50)), contextAllowed: sources.length <= 50, provenance: clone(provenance) };
    if (serializedBytes(assistant) > RESPONSE_RESERVE_BYTES) return { ok: false, reason: 'conversation-output-budget' };
    const candidate = clone(captured.record);
    candidate.messages.push(assistant);
    candidate.segment.bytes += serializedBytes(assistant);
    candidate.status = proposal ? 'awaiting-confirmation' : 'responding';
    let notice = null;
    if (!candidate.softNoticeShown && candidate.messages.filter(item => item.role === 'assistant').length >= COLLABORATION_BUDGET.softTurnNotice
      && candidate.messages.some(item => item.proposal)) {
      candidate.softNoticeShown = true;
      notice = 'summary-available';
    }
    candidate.revision += 1;
    candidate.updatedAt = Math.max(timestamp(), candidate.updatedAt);
    if (!allowed() || !matches(entry, captured) || captured.active.controller.signal.aborted) {
      return { ok: false, reason: 'conversation-turn-stale' };
    }
    entry.record = candidate;
    entry.active = null;
    return accepted(entry, witness(entry), { notice, acceptedMessageId: assistant.id });
  }
  function excludeContext(record, sourceRefs) {
    const matches = refs => refs.length > 0 && (sourceRefs === null || refs.some(ref => sourceRefs.some(source => source.kind === ref.kind && source.id === ref.id)));
    const blocked = new Set();
    for (const message of record.messages) {
      const dependsOnBlocked = message.sourceRefs.some(ref => ref.kind === 'message' && blocked.has(ref.id));
      if (message.role !== 'user' && (matches(message.sourceRefs) || dependsOnBlocked)) message.contextAllowed = false;
      if (!message.contextAllowed) blocked.add(message.id);
    }
    record.segment.bytes = record.messages.filter(message => message.segment === record.segment.index)
      .reduce((sum, message) => sum + serializedBytes(message), 0);
    for (const summary of record.summaries) {
      if (matches(summary.sourceRefs) || summary.coveredMessageIds.some(messageId => record.messages.some(message => message.id === messageId && !message.contextAllowed))) summary.contextAllowed = false;
    }
  }
  function retiringTransition({ conversationId, kind, status = 'paused', mode, sourceRefs = null,
    inputDraft, selectedProposalId, scrollTop }, capturedEntry = null) {
    // owned() has existing retention effects. The isolated transition starts
    // after capture; this is not a zero-system-writes or persistence guarantee.
    const found = capturedEntry ? (entries.get(conversationId) === capturedEntry && !disposed && !capturedEntry.expired
      ? { ok: true, entry: capturedEntry } : { ok: false, reason: 'conversation-target-changed' }) : owned(conversationId);
    if (!found.ok) return found;
    const entry = found.entry;
    if (kind === 'mode' && !MODES.includes(mode)) return { ok: false, reason: 'conversation-mode-invalid' };
    if (kind === 'mode' && entry.record.mode === mode) return result(entry);
    if (kind === 'revoke' && sourceRefs !== null && !sourceRefsValid(sourceRefs)) return { ok: false, reason: 'conversation-context-invalid' };
    const captured = { record: entry.record, revision: entry.record.revision,
      generation: entry.authGeneration, active: entry.active, providerId: entry.providerId };
    function current(witness) {
      return !disposed && entries.get(conversationId) === entry && !entry.expired
        && entry.record === witness.record && entry.record.revision === witness.revision
        && entry.authGeneration === witness.generation && entry.active === witness.active
        && entry.providerId === witness.providerId;
    }
    function readable() {
      if (disposed || entries.get(conversationId) !== entry || entry.expired) return null;
      try { return snapshot(entry); } catch (_) { return null; }
    }
    function saveStatus() {
      if (entry.pendingSave) return 'unknown';
      if (entry.record.retention.mode === 'ephemeral') return 'ephemeral';
      return entry.savedRevision === entry.record.revision ? 'saved' : 'unsaved';
    }
    const reason = kind === 'revoke' ? 'conversation-revoked' : kind === 'mode' ? 'conversation-mode-changed' : status;
    function notifyCaptured() {
      if (!captured.active) return 'not-needed';
      try {
        captured.active.controller.abort(reason);
        return captured.active.controller.signal.aborted ? 'signal-aborted' : 'unconfirmed';
      } catch (_) { return 'unconfirmed'; }
    }
    let candidate;
    try {
      candidate = clone(captured.record);
      if (kind === 'stop' && !applyDraft({ record: candidate }, inputDraft, selectedProposalId, scrollTop)) {
        return { ok: false, reason: 'conversation-draft-invalid' };
      }
      if (kind === 'revoke') excludeContext(candidate, sourceRefs);
      if (kind === 'mode') candidate.mode = mode;
      candidate.status = status;
      candidate.revision = captured.revision + 1;
      candidate.updatedAt = Math.max(timestamp(), candidate.updatedAt);
      if (!validateConversationSnapshot(candidate)) throw new Error('conversation-transition-invalid');
    } catch (_) {
      if (!current(captured)) return { ok: false, reason: 'conversation-target-changed', conversation: readable(),
        transition: { applied: false, revision: null, notification: 'not-needed', persistence: 'superseded' } };
      // No canonical candidate was applied. Retire only this captured runtime
      // token; failed privacy preparation additionally blocks fresh admission.
      if (kind === 'revoke') { entry.contextEligibilityPending = true; entry.providerId = null; }
      entry.active = null;
      entry.authGeneration += 1;
      entry.requiresAuthorization = true;
      const retired = { record: entry.record, revision: entry.record.revision,
        generation: entry.authGeneration, active: null, providerId: entry.providerId };
      const notification = notifyCaptured();
      return { ok: false, reason: kind === 'revoke' ? 'conversation-context-pending' : 'conversation-transition-unavailable',
        conversation: readable(), transition: { applied: false, revision: null, notification,
          persistence: current(retired) ? saveStatus() : 'superseded' } };
    }
    if (!current(captured)) return { ok: false, reason: 'conversation-target-changed', conversation: readable(),
      transition: { applied: false, revision: null, notification: 'not-needed', persistence: 'superseded' } };
    // Callback-free canonical replacement and runtime retirement. Never edit
    // this record or a newer active token after the captured abort notification.
    entry.record = candidate;
    entry.active = null;
    entry.authGeneration += 1;
    entry.requiresAuthorization = true;
    if (kind === 'revoke') {
      entry.providerId = null;
      if (sourceRefs === null) entry.contextEligibilityPending = false;
    }
    const applied = { record: candidate, revision: candidate.revision,
      generation: entry.authGeneration, active: null, providerId: entry.providerId };
    const notification = notifyCaptured();
    let persistenceStatus = 'superseded';
    if (current(applied)) {
      // Existing pendingSave and repository callbacks keep their own protocol.
      // This fence covers supersession already observed before entering it.
      try { persist(entry); } catch (_) { /* Known apply is not a retryable failure. */ }
      persistenceStatus = current(applied) ? saveStatus() : 'superseded';
    }
    return { ok: true, conversation: readable(), transition: { applied: true,
      revision: applied.revision, notification, persistence: persistenceStatus } };
  }
  function stop(payload = {}, status) {
    return retiringTransition({ ...payload, kind: 'stop', status });
  }
  function revoke({ conversationId, sourceRefs = null } = {}) {
    return retiringTransition({ conversationId, sourceRefs, kind: 'revoke' });
  }
  function setMode({ conversationId, mode } = {}) {
    return retiringTransition({ conversationId, mode, kind: 'mode' });
  }
  function capturePrivacyTargets() {
    return [...entries].map(([conversationId, entry]) => Object.freeze({ conversationId,
      matchesAuthorization: generation => !disposed && !entry.expired && entries.get(conversationId) === entry
        && entry.authGeneration === generation && entry.contextEligibilityPending !== true,
      matchesActive: token => entries.get(conversationId) === entry && Boolean(entry.active)
        && TOKEN_KEYS.every(key => entry.active.token[key] === token?.[key]),
      markPending() {
        if (entries.get(conversationId) === entry && !disposed && !entry.expired) entry.contextEligibilityPending = true;
      },
      revoke: () => retiringTransition({ conversationId, kind: 'revoke', sourceRefs: null }, entry)
    }));
  }
  function prepareDelete({ conversationId, expectedRevision } = {}) {
    const found = owned(conversationId);
    if (!found.ok) return found;
    const entry = found.entry;
    if (expectedRevision !== entry.record.revision) return { ok: false, reason: 'conversation-delete-conflict' };
    // ARCHITECTURE「可恢复会话存储」: withdraw runtime authority before receipt
    // cleanup without changing the confirmed revision or exact pending save.
    abort(entry, 'conversation-deleted', true);
    return expectedRevision === entry.record.revision ? { ok: true }
      : { ok: false, reason: 'conversation-delete-conflict' };
  }
  function remove({ conversationId, expectedRevision } = {}) {
    const found = owned(conversationId);
    if (!found.ok) return found;
    const entry = found.entry;
    if (expectedRevision !== undefined && expectedRevision !== entry.record.revision) {
      return { ok: false, reason: 'conversation-delete-conflict' };
    }
    const deletingRevision = entry.record.revision;
    abort(entry, 'conversation-deleted', true);
    if (entry.record.revision !== deletingRevision) return { ok: false, reason: 'conversation-delete-conflict' };
    const settled = persistence.reconcile(entry);
    if (!settled.ok) return { ...settled, conversation: snapshot(entry) };
    if (entry.savedRevision > 0) {
      let deleted;
      try { deleted = repository?.delete({ ownerId, conversationId, expectedRevision: entry.savedRevision }); } catch (_) { deleted = null; }
      if (!deleted?.ok) return { ok: false, reason: deleted?.reason || 'conversation-delete-failed', conversation: snapshot(entry) };
    }
    entries.delete(conversationId);
    armRetention();
    return { ok: true };
  }
  function dispose() {
    if (disposed) return disposalResult;
    enforceRetention();
    const unsaved = [];
    for (const entry of entries.values()) {
      abort(entry, 'conversation-disposed', true);
      entry.record.status = 'paused';
      touch(entry);
      if (!persist(entry).ok && !entry.expired) unsaved.push(entry.record.id);
    }
    enforceRetention();
    const pending = unsaved.filter(id => entries.has(id));
    disposed = true;
    if (retentionTimer !== null) cancelSchedule(retentionTimer);
    retentionTimer = null;
    disposalResult = immutable({ ok: pending.length === 0 && !retentionFailure, unsaved: pending,
      ...(retentionFailure ? { retentionError: retentionFailure } : {}) });
    return disposalResult;
  }
  return Object.freeze({ start, get, list, setRetention, setMode, beginTurn, completeTurn, capturePrivacyTargets,
    cancel: request => stop(request, 'canceled'), pause: request => stop(request, 'paused'), revoke, prepareDelete, delete: remove, dispose });
}

module.exports = { createCollaborationSessions };
