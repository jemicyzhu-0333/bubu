import { readInputLeaseCapability, readInputLeaseRequest } from '../../../core/pet-input-lease.mjs';

const same = (a, b) => Boolean(a && b && a.epoch === b.epoch && a.viewRevision === b.viewRevision
  && a.contactGeneration === b.contactGeneration);
const contact = value => value && Number.isSafeInteger(value.contactGeneration) && value.contactGeneration > 0
  && Number.isSafeInteger(value.pointerId) && value.pointerId >= 0 && value.captured === true && value.domCaptured === true
  && ['pending', 'petting', 'drag'].includes(value.mode) ? value.contactGeneration : null;

/** One in-flight lease request. RAF supplies renewals; no timer, cursor or native-capture claim. */
export function createInputLeasePublisher({ now, send, cancelContact, cancelInput, onError = () => {} }) {
  let capability = null, observed = false, desired = null, session = null, inFlight = null;
  let sequence = 0, blockedThrough = 0, lastContact = null, lastNow = 0, closed = false;
  let requests = 0, rejected = 0, expired = 0;
  function time() {
    const value = now();
    if (!Number.isFinite(value) || value < lastNow) return null;
    lastNow = value; return value;
  }
  function block(id) {
    if (id === null) return;
    blockedThrough = Math.max(blockedThrough, id);
    if (desired?.contactGeneration === id) desired = null;
    try { cancelContact(id); } catch (error) { onError(error); } // Preserve released landing and newer contacts.
  }
  function observe(value, deferFlush = false) {
    if (closed) return;
    const next = readInputLeaseCapability(value);
    if (observed && JSON.stringify(next) === JSON.stringify(capability)) return;
    observed = true;
    if (lastContact !== null) blockedThrough = Math.max(blockedThrough, lastContact);
    desired = null;
    if (session) session.endWanted = true;
    capability = next;
    try { cancelInput(); } catch (error) { onError(error); } // Never reset an unowned visual tail.
    if (!deferFlush) flush();
  }
  function settle(ticket, response, error) {
    if (inFlight !== ticket) return;
    inFlight = null;
    const echoed = readInputLeaseRequest(response?.request);
    const replyCapability = readInputLeaseCapability(response?.capability);
    const valid = !error && typeof response?.ok === 'boolean' && echoed
      && JSON.stringify(echoed) === JSON.stringify(ticket.request) && replyCapability;
    const currentEpoch = capability?.epoch === ticket.request.epoch;
    if (valid && currentEpoch && JSON.stringify(replyCapability) !== JSON.stringify(capability)) observe(replyCapability, true);
    if (ticket.request.phase === 'end') {
      if (session === ticket.session) session = null;
      if (!valid || !response.ok) rejected++;
      if (!valid) onError(error ?? new Error('input-lease-response-invalid'));
      flush(); return;
    }
    if (!valid || !response.ok) {
      rejected++;
      block(ticket.request.contactGeneration);
      if (session === ticket.session) {
        // A rejected transport may have executed. Try one terminal request;
        // never replay begin/renew, and retain TTL as the independent fallback.
        if (!valid) { session.endWanted = true; session.held = false; }
        else session = null;
      }
      if (!valid) onError(error ?? new Error('input-lease-response-invalid'));
    } else if (session === ticket.session) {
      session.held = true;
      const at = time();
      if (at === null || at - ticket.sentAt >= ticket.capability.ttlMs) {
        expired++; block(ticket.request.contactGeneration); session.endWanted = true;
      }
    }
    flush();
  }
  function dispatch(phase, owner, at) {
    const request = readInputLeaseRequest({ schemaVersion: 1, epoch: owner.epoch, viewRevision: owner.viewRevision,
      contactGeneration: owner.contactGeneration, sequence: ++sequence, phase });
    if (!request) { block(owner.contactGeneration); session = null; return; }
    const ticket = { request, session: owner, sentAt: at, capability: { ...owner.capability }, timedOut: false };
    inFlight = ticket; owner.lastSent = at; requests++;
    Promise.resolve().then(() => send(request)).then(response => settle(ticket, response, null), error => settle(ticket, null, error));
  }
  function flush() {
    if (inFlight) return;
    const at = time();
    if (session && (session.endWanted || !same(session, desired) || closed || at === null)) {
      dispatch('end', session, at ?? lastNow); return;
    }
    if (closed || at === null || !desired || !capability?.available) return;
    if (!session) {
      // Desired identity was copied at observation, never relabelled after await.
      if (desired.epoch !== capability.epoch || desired.viewRevision !== capability.viewRevision) return;
      session = { ...desired, capability: { ...capability }, held: false, endWanted: false, lastSent: at };
      dispatch('begin', session, at); return;
    }
    if (session.held && at - session.lastSent >= session.capability.renewMs) dispatch('renew', session, at);
  }
  function update(value, enabled = true) {
    if (closed) return;
    lastContact = contact(value);
    const at = time();
    if (at === null) {
      if (lastContact !== null) block(lastContact);
      desired = null; if (session) session.endWanted = true; flush(); return;
    }
    if (inFlight && inFlight.request.phase !== 'end' && at - inFlight.sentAt >= inFlight.capability.ttlMs) {
      if (!inFlight.timedOut) { inFlight.timedOut = true; expired++; }
      block(lastContact); block(inFlight.request.contactGeneration);
      if (session) session.endWanted = true;
    } else if (session?.held && at - session.lastSent >= session.capability.ttlMs) {
      expired++; block(session.contactGeneration); session.endWanted = true;
    }
    const id = enabled && capability?.available && lastContact !== null && lastContact > blockedThrough ? lastContact : null;
    if (id === null) desired = null;
    else if (!desired || desired.contactGeneration !== id) desired = Object.freeze({ epoch: capability.epoch,
      viewRevision: capability.viewRevision, contactGeneration: id });
    if (session && !same(session, desired)) session.endWanted = true;
    flush();
  }
  return Object.freeze({ observe, update,
    dispose() { if (closed) return; closed = true; desired = null; if (session) session.endWanted = true; flush(); },
    snapshot: () => ({ scope: 'renderer-DOM-contact-request-not-OS-capture', capability: capability ? { ...capability } : null,
      observed, inFlight: Boolean(inFlight), pendingEnd: Boolean(session?.endWanted),
      contactGeneration: session?.contactGeneration ?? null, desiredContact: desired?.contactGeneration ?? null,
      requests, rejected, expired, closed }) });
}
