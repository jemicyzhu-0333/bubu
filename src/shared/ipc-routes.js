'use strict';

const KNOWN_SURFACES = Object.freeze([
  'popover', 'impulse', 'pet', 'nudgeCorner', 'nudgeFullscreen'
]);

function describeRoutes(capability, codec, surfaces, queries = []) {
  if (typeof capability !== 'string' || !capability) throw new TypeError('route capability is required');
  const queryChannels = new Set(queries);
  return Object.freeze(codec.channels.map(channel => {
    const allowed = surfaces[channel];
    if (!Array.isArray(allowed) || allowed.length === 0) {
      throw new Error(`IPC route ${channel} has no surface allowlist`);
    }
    for (const surface of allowed) {
      if (!KNOWN_SURFACES.includes(surface)) throw new Error(`IPC route ${channel} has unknown surface ${surface}`);
    }
    return Object.freeze({
      channel,
      capability,
      kind: queryChannels.has(channel) ? 'query' : 'command',
      surfaces: Object.freeze([...new Set(allowed)]),
      decode: (payload, context) => codec.decode(channel, payload, context)
    });
  }));
}

module.exports = { KNOWN_SURFACES, describeRoutes };
