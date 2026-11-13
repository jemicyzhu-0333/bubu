// Research-only oracle. Never imported by production and never grants capability.
const inside = (p, b) => p.x >= b.x && p.y >= b.y && p.x < b.x + b.width && p.y < b.y + b.height;
const number = x => Number.isFinite(x) && Math.abs(x) <= 100000;
export function createTopologyOracle() {
  let revision = 0, epoch = 1, sequence = 0, pendingEnumeration = null, key = null, state = null;
  const oracle = {
    beginEnumeration() {
      pendingEnumeration = Object.freeze({ epoch, sequence: ++sequence });
      return pendingEnumeration;
    },
    observe(displays, ticket) {
      const current = () => ticket && ticket === pendingEnumeration && ticket.epoch === epoch;
      const stale = () => ({ accepted: false, reason: 'stale-enumeration', productionCapability: false });
      if (!current()) return stale();
      pendingEnumeration = null; // Consume on the first attempt, including exceptions.
      const owned = () => ticket.epoch === epoch && ticket.sequence === sequence;
      let reason = null, canonical = null;
      try {
      const length = Array.isArray(displays) ? displays.length : 0;
      if (!Number.isSafeInteger(length) || length < 1 || length > 8) reason = 'invalid-topology';
      else {
        // Visit every original slot; map/some would skip holes or deleted entries.
        canonical = [];
        for (let i = 0; i < length; i++) {
          if (!Object.prototype.hasOwnProperty.call(displays, i)) throw new TypeError('sparse-display-array');
          const d = displays[i];
          canonical.push({ id: d?.id, scale: d?.scaleFactor, rotation: d?.rotation,
            bounds: d?.bounds && { x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height } });
        }
        if (canonical.some(d => !Number.isSafeInteger(d.id) || !d.bounds || !Object.values(d.bounds).every(x => Number.isSafeInteger(x) && number(x))
          || d.bounds.width <= 0 || d.bounds.height <= 0 || !Number.isFinite(d.scale) || d.scale < .5 || d.scale > 4
          || ![0, 90, 180, 270].includes(d.rotation)) || new Set(canonical.map(d => d.id)).size !== canonical.length) reason = 'invalid-topology';
        else {
          canonical.sort((a, b) => a.id - b.id);
          if (canonical.some(d => d.rotation !== 0)) reason = 'rotation-unverified';
          else if (new Set(canonical.map(d => d.scale)).size !== 1) reason = 'mixed-DPI-unverified';
          else if (canonical.some((a, i) => canonical.slice(i + 1).some(b => Math.max(a.bounds.x, b.bounds.x) < Math.min(a.bounds.x + a.bounds.width, b.bounds.x + b.bounds.width)
            && Math.max(a.bounds.y, b.bounds.y) < Math.min(a.bounds.y + a.bounds.height, b.bounds.y + b.bounds.height)))) reason = 'overlap-unverified';
        }
      }
      } catch { reason = 'enumeration-failed'; canonical = null; }
      if (reason) canonical = null; // No caller objects/functions in failure state.
      const next = JSON.stringify([reason, canonical]);
      // Normalization may call getters. Recheck after any caller-controlled work,
      // with the consumed request epoch/sequence before publishing.
      if (!owned()) return stale();
      const nextRevision = revision + (next !== key ? 1 : 0);
      const candidate = { revision: nextRevision, epoch, reason, displays: canonical, productionCapability: false };
      const output = structuredClone(candidate);
      revision = nextRevision; key = next; state = candidate;
      return output;
    },
    invalidateEvent(event) {
      if (!['display-added', 'display-removed', 'display-metrics-changed', 'resume', 'unlock-screen', 'suspend', 'lock-screen'].includes(event)) throw new TypeError('unsupported-event');
      // Revoke synchronously before a caller re-enumerates or publishes anything.
      epoch++; revision++; pendingEnumeration = null; state = null; key = null;
      return { epoch, revision, requiresNewContact: true, productionCapability: false };
    },
    commitSegment(from, to, expectedRevision, expectedEpoch) {
      if (expectedEpoch !== epoch) return { accepted: false, reason: 'stale-epoch' };
      return oracle.segment(from, to, expectedRevision);
    },
    segment(from, to, expectedRevision) {
      if (!state) return { accepted: false, reason: 'revoked-awaiting-enumeration' };
      if (expectedRevision !== revision) return { accepted: false, reason: 'stale-topology' };
      if (state.reason) return { accepted: false, reason: state.reason };
      if (![from?.x, from?.y, to?.x, to?.y].every(number)) return { accepted: false, reason: 'invalid-DIP-point' };
      const a = state.displays.filter(d => inside(from, d.bounds)), b = state.displays.filter(d => inside(to, d.bounds));
      if (a.length !== 1 || b.length !== 1) return { accepted: false, reason: 'outside-or-ambiguous-display' };
      if (a[0].id !== b[0].id) return { accepted: false, reason: 'cross-display-unverified' };
      return { accepted: true, productionCapability: false, scope: 'synthetic-same-display-DIP-only', delta: { x: to.x - from.x, y: to.y - from.y } };
    }
  };
  return Object.freeze(oracle);
}
