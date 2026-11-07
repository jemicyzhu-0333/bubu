import { DANGO_ACTION_VIEWS } from '../content/companion/dango-action-views.mjs';

const VIEWS = new Set(['front', 'three-quarter', 'back']);

// Resolve the whole pose before body, face, outfit and equipment sampling.
// Fallback is semantic: binoculars stay frontal and carry retains two paws.
function baseDangoView(requested, action, state) {
  const policy = DANGO_ACTION_VIEWS[action?.id];
  const view = requested === 'profile' ? 'three-quarter' : requested;
  if (policy) {
    return VIEWS.has(view) && policy.allowed.includes(view) ? view : policy.preferred;
  }
  if (VIEWS.has(view)) return view;
  return state === 'walking' || state === 'dragged' ? 'three-quarter' : 'front';
}

// `outfitViews`: views in which every worn piece has art. When the semantic
// choice would hide the outfit, take another view the action also allows, so
// a front-only set (e.g. 南瓜之夜) stays visible. Only a genuine conflict (the
// action allows no such view, or the body is walking/dragged) still hides it.
function resolveDangoView(requested, { action = null, state = 'idle', outfitViews = null } = {}) {
  const view = baseDangoView(requested, action, state);
  if (!Array.isArray(outfitViews) || !outfitViews.length || outfitViews.includes(view)) return view;
  const policy = DANGO_ACTION_VIEWS[action?.id];
  if (!policy && (state === 'walking' || state === 'dragged')) return view;
  const allowed = policy ? policy.allowed : ['front', 'three-quarter', 'back'];
  return ['front', 'three-quarter', 'back'].find(candidate => allowed.includes(candidate) && outfitViews.includes(candidate)) || view;
}

export { resolveDangoView };
