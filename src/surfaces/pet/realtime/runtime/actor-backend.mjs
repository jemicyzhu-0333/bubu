// Public realtime runtime boundary (ARCHITECTURE「V2 动画研究底座」).
// This is the ONLY production module allowed to reference research/ code.
// G4 replaces this re-export with a stable runtime package; callers keep
// importing createActorPool from ./index.mjs and do not change.
import { FoundationPool } from '../../../../../research/animation-0.1.0/animation-foundation-v1/integration/browser-assets.mjs';

export const ACTOR_BACKEND = Object.freeze({ id: 'foundation-v1-research', stable: false });
export function createActorPool(options) { return new FoundationPool(options); }
