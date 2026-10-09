import { t, onLocaleChanged } from '../shared/interface/i18n.mjs';
'use strict';

import { activityLabelFor } from './activity-mirror.mjs';

// Presentation-only adapter. Eligibility and phrase consumption stay with
// context-emphasis; this module never invents or retains activity signals.
function createStatusFooter({ stage, label, next, badge } = {}) {
  const text = badge.querySelector?.('.context-label') || badge;
  const count = badge.querySelector?.('.context-count');
  let displayedLabel = null;
  let disposed = false;
  let activityCopy = null, contextCopy = null;

  function collapse() {
    if (disposed) return;
    badge.dataset.expanded = 'false';
    badge.setAttribute('aria-expanded', 'false');
  }
  function toggle(event) {
    if (disposed) return;
    event.stopPropagation();
    const expanded = badge.dataset.expanded !== 'true';
    badge.dataset.expanded = String(expanded);
    badge.setAttribute('aria-expanded', String(expanded));
  }
  function keydown(event) {
    if (disposed) return;
    if (event.key !== 'Escape') return;
    collapse();
    event.stopPropagation();
  }
  badge.addEventListener?.('click', toggle);
  badge.addEventListener?.('keydown', keydown);
  badge.addEventListener?.('blur', collapse);

  function syncActivity(activity) {
    if (disposed) return;
    stage.classList.toggle('session-focused', activity?.state === 'focused');
    stage.classList.toggle('session-resting', activity?.state === 'resting');
    const visible = ['focused', 'resting'].includes(activity?.state);
    next?.setAttribute('tabindex', visible ? '0' : '-1');
    next?.setAttribute('aria-hidden', String(!visible));
    activityCopy = activity;
    paintActivityCopy();
  }

  function paintActivityCopy() {
    const value = activityLabelFor(activityCopy);
    next?.setAttribute('title', t('{activity}，换一个陪伴动作', { activity: value }));
    next?.setAttribute('aria-label', t('{activity}，切换伙伴当前动作', { activity: value }));
    if (!label || displayedLabel === value) return;
    displayedLabel = value;
    label.textContent = value;
    label.setAttribute('title', value);
    label.setAttribute('aria-label', value);
  }

  function hideContext() {
    if (disposed) return;
    contextCopy = null;
    badge.classList.remove('show');
    badge.setAttribute('aria-hidden', 'true');
    badge.setAttribute('tabindex', '-1');
    badge.style.opacity = '0';
    collapse();
  }

  function showContext({ copy, context, calmVisual, opacity }) {
    if (disposed) return;
    if (badge.dataset.context !== context) collapse();
    contextCopy = copy;
    text.textContent = translateContext(copy);
    if (count) count.textContent = String(copy.split(' · ').filter(value => value !== '专注').length);
    badge.dataset.context = context;
    badge.dataset.motion = calmVisual ? 'static' : 'normal';
    badge.style.opacity = String(opacity);
    badge.setAttribute('aria-label', translateContext(copy));
    badge.setAttribute('title', translateContext(copy));
    badge.setAttribute('aria-hidden', 'false');
    badge.setAttribute('tabindex', '0');
    badge.classList.add('show');
  }

  const badgeParts = new Set(['音乐疗愈中', 'AI协作中', '音乐', 'AI协作', '编程', '专注', 'AI']);
  function translateContext(copy) { return String(copy).split(' · ').map(part => badgeParts.has(part) ? t(part) : part).join(' · '); }
  const stopLocale = onLocaleChanged(() => {
    if (disposed) return;
    if (activityCopy) paintActivityCopy();
    if (contextCopy !== null) {
      const copy = translateContext(contextCopy);
      text.textContent = copy; badge.setAttribute('aria-label', copy); badge.setAttribute('title', copy);
    }
  });
  return Object.freeze({ syncActivity, hideContext, showContext,
    dispose() {
      if (disposed) return;
      hideContext();
      disposed = true; stopLocale(); activityCopy = null; contextCopy = null;
      badge.removeEventListener?.('click', toggle);
      badge.removeEventListener?.('keydown', keydown);
      badge.removeEventListener?.('blur', collapse);
    } });
}

export { createStatusFooter };
