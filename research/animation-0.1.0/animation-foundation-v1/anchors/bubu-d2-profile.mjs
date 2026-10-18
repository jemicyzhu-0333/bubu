import { DEFINITIONS } from './definitions.mjs';
import { createAnchorRegistry } from './registry.mjs';

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

export const BUBU_D2_PROFILE = freeze({
  id: 'bubu-d2-hybrid-v1',
  sourceSHA256: '84ec5d8608f21e43bf06df26b8b2f81124909ebb39c77bb9cc153aca17319a3a',
  hybridSHA256: '52a080d81606fbe92e9cd71593bd703f356eb50a0e1c74ccc34547a0db308e67',
  boneCount: 7,
  parts: {
    'Bubu_body': { mode: 'skinned', vertexCount: 32036 },
    'Bubu_hand-left': { mode: 'rigid', vertexCount: 2237 },
    'Bubu_hand-right': { mode: 'rigid', vertexCount: 2228 },
    'Bubu_foot-left': { mode: 'skinned', vertexCount: 4440 },
    'Bubu_foot-right': { mode: 'skinned', vertexCount: 4470 }
  },
  anchors: DEFINITIONS
});

export const ANCHOR_DEFINITIONS = BUBU_D2_PROFILE.anchors;
export const ANCHOR_IDS = Object.freeze(ANCHOR_DEFINITIONS.map(d => d.id));

/** Explicit admitted-character convenience factory; generic registry has no default. */
export function createBubuD2AnchorRegistry(options) {
  return createAnchorRegistry({ ...options, profile: BUBU_D2_PROFILE });
}
