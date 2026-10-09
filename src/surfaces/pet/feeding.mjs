'use strict';
export { FOOD_ORDER } from '../../content/food-progression.mjs';
import { foodRitual } from '../../content/food-rituals.mjs';
import { createFoodRequestLifecycle, isFeedSnapshot, foodRequestMessage } from '../companion/food-request-lifecycle.mjs';

function foodPresentationSteps(foodId) {
  const ritual = foodRitual(foodId);
  let atMs = 0;
  return Object.freeze(ritual.durations.map((duration, index) => {
    const step = Object.freeze({ atMs, endMs: atMs + duration, expressionId: ritual.expressions[index] });
    atMs += duration;
    return step;
  }));
}
const FEED_PRESENTATION_STEPS = foodPresentationSteps('basic');

function foodEffectText(food) {
  return `饱食+${Math.max(0, Number(food && food.satiation) || 0)}`;
}

function foodInventorySummary(feedState, total) {
  return total > 0
    ? `库存 ${total} 份 · 总喂食 ${Math.max(0, Number(feedState && feedState.totalFeeds) || 0)}`
    : '库存空了 · 伙伴页可用食物券兑换';
}

function createPetFeeding({
  client,
  content,
  clock,
  present,
  say,
  render,
  now = Date.now,
  nonce,
  refresh = () => client.pet_getFeedState(),
  onBusyChanged,
  canPresent = () => true,
  canPresentAutomatic = canPresent,
  calm = () => false,
  presentAction,
  onFeedAccepted,
  onPresentationComplete,
  scheduleReaction,
  clearReaction = clearTimeout
} = {}) {
  if (!client || typeof client.pet_feed !== 'function') throw new TypeError('pet feeding client is required');
  if (!clock || typeof clock.read !== 'function') throw new TypeError('pet feeding clock is required');
  if (typeof present !== 'function') throw new TypeError('pet feeding presentation callback is required');
  let sequence = null;
  let sequenceId = 0;
  let visit = 0;
  let disposed = false;
  let reactionTimer = null, cancelSpeech = null, automaticPresentation = false;
  const requests = createFoodRequestLifecycle({ send: request => client.pet_feed(request),
    refresh: read, validateRefresh: isFeedSnapshot, now, nonce });

  function read() {
    if (disposed) throw new Error('pet-feeding-disposed');
    return refresh();
  }

  function normalizeFoodId(foodId) {
    return typeof foodId === 'string' ? foodId.trim().toLowerCase() : '';
  }

  function cancel(reason = 'cancelled') {
    if (disposed) return false;
    return clearPresentation(reason);
  }

  function clearPresentation(reason) {
    visit += 1;
    const timer = reactionTimer, speech = reason === 'completed' ? null : cancelSpeech, previous = sequence;
    reactionTimer = null;
    sequence = null;
    if (reason !== 'completed') {
      automaticPresentation = false;
      cancelSpeech = null;
    }
    if (timer !== null) clearReaction(timer);
    try {
      if (typeof speech === 'function') speech();
    } finally {
      try {
        if (previous?.activeEventId) present({ cancel: true, eventId: previous.activeEventId, reason });
      } finally {
        if (typeof previous?.cancelAction === 'function') previous.cancelAction(reason);
      }
    }
    return Boolean(previous);
  }

  function reconcile() {
    if (disposed) return false;
    if (!automaticPresentation || (canPresent() && canPresentAutomatic())) return false;
    cancel('policy-changed');
    return true;
  }

  function advance() {
    if (disposed) return false;
    if (reconcile()) return true;
    if (!sequence) return false;
    if (!canPresent() || (sequence.automatic && !canPresentAutomatic())) return cancel('policy-changed');
    const elapsed = Math.max(0, clock.read() - sequence.startedAt);
    const last = sequence.steps.at(-1);
    if (elapsed >= last.endMs) {
      const completed = sequence;
      cancel('completed');
      if (!disposed && completed.celebrationDurationMs > 0 && typeof onPresentationComplete === 'function') {
        onPresentationComplete(completed.celebrationDurationMs);
      }
      return true;
    }
    let phaseIndex = 0;
    for (let index = sequence.steps.length - 1; index >= 0; index -= 1) {
      if (elapsed >= sequence.steps[index].atMs) {
        phaseIndex = index;
        break;
      }
    }
    const step = sequence.steps[phaseIndex];
    const current = sequence;
    if (sequence.activeEventId && sequence.activeEventId !== `feed.${sequence.id}.${phaseIndex}`) {
      present({ cancel: true, eventId: sequence.activeEventId, reason: 'feed-next-phase' });
    }
    if (disposed || sequence !== current) return false;
    sequence.phaseIndex = phaseIndex;
    sequence.activeEventId = `feed.${sequence.id}.${phaseIndex}`;
    present({
      eventId: sequence.activeEventId,
      expressionId: sequence.favorite && phaseIndex === 2 ? 'react.happy' : step.expressionId,
      source: 'interaction',
      ttlMs: Math.max(1, step.endMs - elapsed)
    });
    return true;
  }

  function start(animation, foodId = 'basic', automatic = false) {
    if (disposed) return false;
    cancel('replaced');
    if (disposed) return false;
    sequenceId += 1;
    const ritual = foodRitual(foodId);
    const steps = calm() ? [{ atMs: 0, endMs: 1600, expressionId: ritual.expressions[2] }] : foodPresentationSteps(foodId);
    const cancelAction = !calm() && typeof presentAction === 'function' ? presentAction(ritual.actionId, steps.at(-1).endMs) : null;
    if (disposed) {
      if (typeof cancelAction === 'function') cancelAction('disposed');
      return false;
    }
    sequence = {
      id: sequenceId, automatic,
      steps, cancelAction,
      startedAt: clock.read(),
      phaseIndex: -1,
      activeEventId: null,
      favorite: animation === 'favorite',
      celebrationDurationMs: automatic ? 0 : animation === 'favorite' ? 4500 : animation === 'dance' || animation === 'happy' ? 2500 : 0
    };
    return advance();
  }

  function presentAccepted(id, result, automatic = false) {
    if (disposed || !canPresent() || (automatic && !canPresentAutomatic())) return false;
    const accepted = onFeedAccepted?.(id, result);
    if (disposed || !start(result.animation, id, automatic) || disposed) return false;
    automaticPresentation = automatic;
    const reaction = accepted && typeof accepted.reaction === 'string' ? accepted.reaction : result.reaction || '';
    const presentationOwner = visit;
    const showReaction = () => {
      if (disposed || presentationOwner !== visit) return;
      reactionTimer = null;
      if (canPresent() && (!automatic || canPresentAutomatic()) && typeof say === 'function') {
        const release = say(reaction, 3000);
        if (disposed || presentationOwner !== visit) {
          if (typeof release === 'function') release();
        } else cancelSpeech = release;
      }
    };
    if (reaction && typeof scheduleReaction === 'function') reactionTimer = scheduleReaction(showReaction, 400);
    else if (reaction) showReaction();
    return true;
  }

  // A selfMeal is a post-commit presentation fact, never a feed command or a
  // second canonical satiation/inventory update.
  function presentMeal(meal) {
    if (disposed) return false;
    const id = normalizeFoodId(meal?.foodId);
    if (meal?.automatic !== true || !content?.()?.FOODS?.[id]) return false;
    try { return presentAccepted(id, meal, true); } catch (_) { return false; }
  }

  async function feedPet(foodId) {
    if (disposed) return { ignored: true };
    const id = normalizeFoodId(foodId);
    const owner = visit;
    const pending = requests.run(id);
    if (!disposed) onBusyChanged?.();
    const outcome = await pending;
    if (outcome.ignored) return outcome;
    if (disposed) return outcome.result;
    onBusyChanged?.();
    if (disposed || owner !== visit) return outcome.result;
    if (outcome.snapshot && typeof render === 'function') render(outcome.snapshot);
    const result = outcome.result;
    if (disposed) return result;
    if (!result?.ok) {
      if (typeof say === 'function' && canPresent()) say(foodRequestMessage(outcome), 3500);
      return result;
    }
    // These are post-receipt effects. A failed animation/read never changes the
    // successful receipt into an ambiguous failure or repeats the food command.
    try { presentAccepted(id, result); } catch (_) { /* the command is already committed */ }
    const refreshOwner = visit;
    try {
      const snapshot = await read();
      if (!disposed && refreshOwner === visit && isFeedSnapshot(snapshot) && typeof render === 'function') render(snapshot);
    } catch (_) { /* canonical push or the next menu read repairs presentation */ }
    return result;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    clearPresentation('disposed');
  }

  return Object.freeze({ cancel, dispose, reconcile, advance, start, feedPet, presentMeal, normalizeFoodId, steps: FEED_PRESENTATION_STEPS, content, busy: requests.busy, pending: requests.pending });
}

export { createPetFeeding, FEED_PRESENTATION_STEPS, foodEffectText, foodInventorySummary };
export default Object.freeze({
  createPetFeeding,
  FEED_PRESENTATION_STEPS,
  foodEffectText,
  foodInventorySummary
});
