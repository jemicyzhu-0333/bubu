import { DANGO_ACTION_VIEWS } from '../content/companion/dango-action-views.mjs';

const VIEWS = new Set(['front', 'three-quarter', 'back']);

// Resolve the whole pose before body, face, outfit and equipment sampling.
// Fallback is semantic: binoculars stay frontal and carry retains two paws.
function resolveDangoView(requested, { action = null, state = 'idle' } = {}) {
  const policy = DANGO_ACTION_VIEWS[action?.id];
  const view = requested === 'profile' ? 'three-quarter' : requested;
  if (policy) {
    return VIEWS.has(view) && policy.allowed.includes(view) ? view : policy.preferred;
  }
  if (VIEWS.has(view)) return view;
  return state === 'walking' || state === 'dragged' ? 'three-quarter' : 'front';
}

export { resolveDangoView };
