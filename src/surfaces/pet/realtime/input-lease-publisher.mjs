import { readInputLeaseCapability, readInputLeaseRequest } from '../../../core/pet-input-lease.mjs';
import { readFixtureTranslation } from '../../../core/pet-fixture-transport.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const same = (a, b) => Boolean(a && b && a.epoch === b.epoch && a.viewRevision === b.viewRevision
  && a.contactGeneration === b.contactGeneration);
const contact = value => value && Number.isSafeInteger(value.contactGeneration) && value.contactGeneration > 0
  && Number.isSafeInteger(value.pointerId) && value.pointerId >= 0 && value.captured === true && value.domCaptured === true
  && ['pending', 'petting', 'drag'].includes(value.mode) ? value.contactGeneration : null;
function readHold(value) {
  try {
    if (!value || Object.getPrototypeOf(value) !== Object.prototype) return null;
    const fields = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(fields).length !== 2 || !Object.hasOwn(fields.probeId ?? {}, 'value')
        || !Object.hasOwn(fields.contactGeneration ?? {}, 'value')) return null;
    const probeId = fields.probeId.value, contactGeneration = fields.contactGeneration.value;
    return typeof probeId === 'string' && UUID.test(probeId) && Number.isSafeInteger(contactGeneration)
      && contactGeneration > 0 ? { probeId, contactGeneration } : null;
  } catch { return null; }
}

/** One in-flight lease request. RAF supplies renewals; no timer, cursor or native-capture claim. */
export function createInputLeasePublisher({ now, send, cancelContact, cancelInput, onError = () => {} }) {
  let capability = null, observed = false, desired = null, session = null, inFlight = null;
  let fixtureHold = null;
  let sequence = 0, blockedThrough = 0, lastContact = null, lastNow = 0, closed = false;
  let requests = 0, rejected = 0, expired = 0;
  function time(commit = true) {
    try {
      const value = now();
      if (!Number.isFinite(value) || value < lastNow) return null;
      if (commit) lastNow = value;
      return value;
    } catch { return null; }
  }
  function endSession() {
    fixtureHold = null;
    if (session) session.endWanted = true;
  }
  function remaining(at) {
    return at !== null && session?.held && !session.endWanted
      ? Math.max(0, session.capability.ttlMs - (at - session.lastSent)) : 0;
  }
  function block(id) {
    if (id === null) return;
    if (fixtureHold?.contactGeneration === id) fixtureHold = null;
    blockedThrough = Math.max(blockedThrough, id);
    if (desired?.contactGeneration === id) desired = null;
    try { cancelContact(id); } catch (error) { onError(error); } // Preserve released landing and newer contacts.
  }
  function checkDeadline(at) {
    if (at === null) {
      block(lastContact); desired = null; endSession(); return false;
    }
    if (inFlight && inFlight.request.phase !== 'end' && at - inFlight.sentAt >= inFlight.capability.ttlMs) {
      if (!inFlight.timedOut) { inFlight.timedOut = true; expired++; }
      block(lastContact); block(inFlight.request.contactGeneration); endSession();
    } else if (session?.held && !session.endWanted && remaining(at) === 0) {
      expired++; block(session.contactGeneration); endSession();
    }
    return true;
  }
  function observe(value, deferFlush = false) {
    if (closed) return;
    const next = readInputLeaseCapability(value);
    if (observed && JSON.stringify(next) === JSON.stringify(capability)) return;
    observed = true;
    if (lastContact !== null) blockedThrough = Math.max(blockedThrough, lastContact);
    desired = null;
    endSession();
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
      if (session === ticket.session) { fixtureHold = null; session = null; }
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
        if (!valid) { endSession(); session.held = false; }
        else session = null;
      }
      if (!valid) onError(error ?? new Error('input-lease-response-invalid'));
    } else if (session === ticket.session) {
      session.held = true;
      const at = time();
      if (at === null || at - ticket.sentAt >= ticket.capability.ttlMs) {
        expired++; block(ticket.request.contactGeneration); endSession();
      }
    }
    flush();
  }
  function dispatch(phase, owner, at) {
    if (phase === 'end') endSession();
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
    checkDeadline(at);
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
    if (!fixtureHold && session.held && at - session.lastSent >= session.capability.renewMs) dispatch('renew', session, at);
  }
  function update(value, enabled = true) {
    if (closed) return;
    lastContact = contact(value);
    const at = time();
    if (!checkDeadline(at)) { flush(); return; }
    const id = enabled && capability?.available && lastContact !== null && lastContact > blockedThrough ? lastContact : null;
    if (id === null) desired = null;
    else if (!desired || desired.contactGeneration !== id) desired = Object.freeze({ epoch: capability.epoch,
      viewRevision: capability.viewRevision, contactGeneration: id });
    if (session && !same(session, desired)) endSession();
    flush();
  }
  function fixtureReady(at) {
    checkDeadline(at);
    if (closed || inFlight || !capability?.available || !session?.held || session.endWanted
        || !same(session, desired) || session.epoch !== capability.epoch
        || session.viewRevision !== capability.viewRevision || remaining(at) <= 0) {
      flush(); return false;
    }
    return true;
  }
  function holdFixture(value) {
    const identity = readHold(value);
    if (!identity || !fixtureReady(time()) || fixtureHold || identity.contactGeneration !== session.contactGeneration) return { ok: false };
    fixtureHold = Object.freeze({ ...identity, epoch: session.epoch, viewRevision: session.viewRevision, step: 0, after: null });
    return { ok: true, epoch: session.epoch, viewRevision: session.viewRevision,
      contactGeneration: session.contactGeneration, remainingMs: remaining(lastNow) };
  }
  function migrateFixtureView(value) {
    const receipt = readFixtureTranslation(value);
    if (!receipt || !fixtureHold || !fixtureReady(time())) return false;
    if (receipt.probeId !== fixtureHold.probeId || receipt.epoch !== fixtureHold.epoch
        || receipt.contactGeneration !== fixtureHold.contactGeneration || !same(session, fixtureHold)
        || receipt.fromRevision !== session.viewRevision || receipt.step !== fixtureHold.step + 1
        || (fixtureHold.after && JSON.stringify(receipt.before) !== JSON.stringify(fixtureHold.after))) return false;
    // Only the acknowledged fixture view changes. No request, clock, deadline or sequence is rebased.
    capability = readInputLeaseCapability({ ...capability, viewRevision: receipt.toRevision });
    session = { ...session, capability: { ...capability }, viewRevision: receipt.toRevision };
    desired = Object.freeze({ ...desired, viewRevision: receipt.toRevision });
    fixtureHold = Object.freeze({ ...fixtureHold, viewRevision: receipt.toRevision, step: receipt.step, after: receipt.after });
    return true;
  }
  function releaseFixtureHold(probeId) {
    if (!fixtureHold || fixtureHold.probeId !== probeId) return false;
    fixtureHold = null; flush(); return true;
  }
  return Object.freeze({ observe, update, holdFixture, migrateFixtureView, releaseFixtureHold,
    dispose() { if (closed) return; closed = true; desired = null; endSession(); flush(); },
    snapshot: () => ({ scope: 'renderer-DOM-contact-request-not-OS-capture', capability: capability ? { ...capability } : null,
      observed, inFlight: Boolean(inFlight), pendingEnd: Boolean(session?.endWanted),
      held: Boolean(session?.held && !session.endWanted), remainingMs: remaining(time(false)),
      fixtureHold: fixtureHold ? { probeId: fixtureHold.probeId, epoch: fixtureHold.epoch,
        viewRevision: fixtureHold.viewRevision, contactGeneration: fixtureHold.contactGeneration, step: fixtureHold.step } : null,
      contactGeneration: session?.contactGeneration ?? null, desiredContact: desired?.contactGeneration ?? null,
      requests, rejected, expired, closed }) });
}
