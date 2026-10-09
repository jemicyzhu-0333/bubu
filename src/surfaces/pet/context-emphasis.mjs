'use strict';

import { createStatusFooter } from './status-footer.mjs';
import { activityCategories, primaryActivityCategory, activityCombinationBlocked, planActivityCombination } from './activity-combination.mjs';

const CONTEXT_COPY = Object.freeze({
  music: Object.freeze({ badge: '音乐疗愈中', phrase: '音乐陪你慢慢来' }),
  ai: Object.freeze({ badge: 'AI协作中', phrase: '一起理理思路' })
});
// Default-stage diagnostic bounds, derived from the shared footer grid.
// This is a geometry proxy contract, not evidence of browser CSS layout.
const CONTEXT_BADGE_BOUNDS = Object.freeze({ left: 88, top: 187, width: 90, height: 20 });
const CONTEXT_COMBINATION_COPY = Object.freeze({
  'music+ai': Object.freeze({ badge: '音乐 · AI协作', phrase: '音乐陪你理思路' }),
  'coding+music': Object.freeze({ badge: '编程 · 音乐', phrase: '音乐陪你慢慢来' }),
  'focus+music': Object.freeze({ badge: '专注 · 音乐', phrase: '音乐陪你慢慢来' }),
  'focus+ai': Object.freeze({ badge: '专注 · AI', phrase: '一起理理思路' }),
  'focus+music+ai': Object.freeze({ badge: '专注 · 音乐 · AI', phrase: '音乐陪你理思路' })
});

function contextCopyFor(plan) {
  if (!plan) return null;
  const { music, coding, ai } = plan.categories;
  const copy = plan.primary.startsWith('focus-')
    ? CONTEXT_COMBINATION_COPY[ai && music ? 'focus+music+ai' : ai ? 'focus+ai' : 'focus+music']
    : music && ai ? CONTEXT_COMBINATION_COPY['music+ai']
      : music && coding ? CONTEXT_COMBINATION_COPY['coding+music']
        : CONTEXT_COPY[ai ? 'ai' : 'music'];
  // The same retained categories drive icons and names, including coding when
  // it is a secondary signal. This does not infer a new activity or collector.
  return coding && !copy.badge.includes('编程')
    ? Object.freeze({ ...copy, badge: `${copy.badge} · 编程` }) : copy;
}

const contextMirrorBlocked = activityCombinationBlocked;

// Surface-owned ephemeral text only. The existing category and action clock
// remain authoritative; there is no TTL, queue, notification or second timer.
function createContextEmphasis({ stage, label, next, badge, speech, foodToast = null } = {}) {
  if (!stage?.classList || !badge?.classList || !badge?.style || !speech?.showContext) {
    throw new TypeError('context emphasis requires stage, badge and speech ports');
  }
  let category = null;
  let categories = activityCategories(null);
  let consumed = true;
  let previousForm = null;
  const footer = createStatusFooter({ stage, label, next, badge });
  let currentBadge = null;

  function hideBadge() {
    currentBadge = null;
    footer.hideContext();
  }

  function observeCategory(value, { suspended = false, concurrent = null } = {}) {
    const next = activityCategories(value, concurrent);
    if (['music', 'coding', 'ai'].some(key => categories[key] !== next[key])) {
      // A removal cannot repeat the remaining signal's phrase. Rising signals
      // get one opportunity, consumed even while hidden or interrupted.
      consumed = suspended || !((next.music && !categories.music) || (next.ai && !categories.ai));
      categories = next;
      category = primaryActivityCategory(next);
      speech.cancelContext();
      hideBadge();
    }
  }

  const syncActivity = footer.syncActivity;

  function blocked(input = {}) {
    return contextMirrorBlocked({ ...input, externalSpeech: speech.hasExternal(),
      transientUi: stage.classList.contains('peek') || stage.classList.contains('is-docked')
        || Boolean(foodToast?.classList.contains('show')) });
  }

  function update({ activity, action, state = {}, source, expressionId, formId, calmVisual = false } = {}) {
    syncActivity(activity);
    const interrupted = blocked({ state, activity, source, expressionId });
    const formChanged = previousForm !== null && previousForm !== formId;
    previousForm = formId;
    const plan = planActivityCombination({ activity, concurrent: categories, state, source, expressionId, calmVisual });
    const copy = contextCopyFor(plan);
    const matches = Boolean(copy && action && action.id === activity?.id);
    // Resuming a menu, session, form, hidden window or repeated sync never queues speech.
    if (!consumed) {
      consumed = true;
      if (matches && !interrupted && !formChanged && !calmVisual && !state.dnd && state.stimulationMode !== 'low') {
        speech.showContext(copy.phrase);
      }
    }
    if (interrupted || !matches || formChanged || calmVisual || state.dnd || state.stimulationMode === 'low') {
      speech.cancelContext();
    }
    const visible = matches && !interrupted
      && action.mirrorPresentation?.phase !== 'exit' && !speech.visible();
    if (!visible) { hideBadge(); return; }
    currentBadge = Object.entries(plan.categories).filter(([, active]) => active).map(([key]) => key).join('+');
    footer.showContext({ copy: copy.badge, context: currentBadge, calmVisual,
      opacity: action.mirrorPresentation ? action.propOpacity ?? 1 : 1 });
  }

  function suspend() {
    consumed = true;
    hideBadge();
    speech.cancelContext();
  }

  hideBadge();
  return Object.freeze({ observeCategory, syncActivity, blocked, update, suspend, dispose: footer.dispose,
    snapshot: () => Object.freeze({ category, badge: currentBadge, phraseConsumed: consumed }) });
}

export { createContextEmphasis, contextMirrorBlocked, contextCopyFor, CONTEXT_COPY, CONTEXT_COMBINATION_COPY, CONTEXT_BADGE_BOUNDS };
