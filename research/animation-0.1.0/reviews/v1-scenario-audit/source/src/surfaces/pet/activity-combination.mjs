'use strict';

import { normalizeConcurrentActivity, EMPTY_CONCURRENT_ACTIVITY } from '../../capabilities/companion/index.mjs';

const CATEGORIES = Object.freeze(['music', 'coding', 'ai']);
const STATUS_EXPRESSIONS = new Set(['life.sleep', 'life.drowsy', 'life.peek', 'react.hungry', 'work.pause']);

// A supplied v1 projection is authoritative. Legacy senders have exactly one
// category; absence never invents concurrent signals or renderer-side expiry.
function activityCategories(mirror, concurrent) {
  if (concurrent !== null && concurrent !== undefined) {
    return normalizeConcurrentActivity(concurrent) || EMPTY_CONCURRENT_ACTIVITY;
  }
  return Object.freeze({ v: 1, music: mirror === 'music', coding: mirror === 'coding', ai: mirror === 'ai' });
}

function primaryActivityCategory(categories) {
  return categories.ai ? 'ai' : categories.coding ? 'coding' : categories.music ? 'music' : null;
}

function applyActivityMirrorSync(previous, update) {
  const hasConcurrent = Object.hasOwn(update, 'activityMirrorConcurrent');
  const concurrent = hasConcurrent
    ? normalizeConcurrentActivity(update.activityMirrorConcurrent) || EMPTY_CONCURRENT_ACTIVITY
    : Object.hasOwn(update, 'activityMirror') ? null : previous.activityMirrorConcurrent;
  const categories = activityCategories(Object.hasOwn(update, 'activityMirror')
    ? update.activityMirror : previous.activityMirror, concurrent);
  return Object.freeze({ activityMirror: primaryActivityCategory(categories), activityMirrorConcurrent: concurrent });
}

function activityCombinationBlocked({ state = {}, activity, source, expressionId,
  externalSpeech = false, transientUi = false } = {}) {
  const focused = state.sessionState === 'focused' && activity?.state === 'focused';
  return Boolean(externalSpeech || transientUi || state.dragging || state.sessionPaused
    || state.screenLocked || state.dockedEdge || state.commandMenuOpen || state.foodMenuOpen
    || state.devtoolsOpen || state.devPreview || state.currentEgg
    || (state.state && state.state !== 'idle' && !(focused && state.state === 'focused'))
    || state.sessionState === 'resting' || (state.sessionState === 'focused' && !focused)
    || (source && source !== 'base' && !(focused && source === 'session'))
    || STATUS_EXPRESSIONS.has(expressionId));
}

// One primary, two quiet extras, one hand-tool set. The chosen focus story is
// never replaced by a mirror story. Artists deduplicate intrinsic accessories.
function planActivityCombination({ activity, mirror = null, concurrent = null, calmVisual = false,
  blocked = false, ...context } = {}) {
  if (!activity || blocked || activityCombinationBlocked({ ...context, activity })) return null;
  const categories = activityCategories(mirror, concurrent);
  const focused = activity.state === 'focused' && context.state?.sessionState === 'focused';
  const primary = primaryActivityCategory(categories);
  if (!focused && (!primary || activity.id !== `mirror-${primary}` || activity.state !== activity.id)) return null;
  const extras = Object.freeze([
    ...(categories.music ? ['headphones'] : []), ...(categories.ai ? ['robot'] : [])
  ]);
  if (!extras.length) return null;
  return Object.freeze({ v: 1, primary: activity.id,
    categories: Object.freeze(Object.fromEntries(CATEGORIES.map(key => [key, categories[key]]))),
    extras, static: Boolean(calmVisual) });
}

function attachActivityCombination(action, options = {}) {
  if (!action) return null;
  const plan = planActivityCombination({ ...options, activity: action });
  if (plan) return Object.freeze({ ...action, activityCombination: plan });
  if (!Object.hasOwn(action, 'activityCombination')) return action;
  const { activityCombination: _discarded, ...primary } = action;
  return Object.freeze(primary);
}

export { activityCategories, primaryActivityCategory, applyActivityMirrorSync,
  activityCombinationBlocked, planActivityCombination, attachActivityCombination };
