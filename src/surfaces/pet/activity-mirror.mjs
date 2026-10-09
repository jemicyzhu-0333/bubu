// ARCHITECTURE「活动镜像」: the chosen primary shares the existing activity
// controller; concurrent accessories are composed without a second action clock.
export { applyActivityMirrorSync } from './activity-combination.mjs';
const MIRROR_MODES = Object.freeze({ music: 'mirror-music', coding: 'mirror-coding', ai: 'mirror-ai' });

function normalizeMirror(value) {
  return Object.prototype.hasOwnProperty.call(MIRROR_MODES, value) ? value : null;
}

function activityModeFor(sessionState, mirror) {
  if (sessionState === 'focused' || sessionState === 'resting') return sessionState;
  return MIRROR_MODES[normalizeMirror(mirror)] || 'idle';
}

// Session activities and mirror activities share one controller.
function activityControllerContent(content) {
  return {
    activities: { ...(content.SESSION_ACTIVITIES || {}), ...(content.MIRROR_ACTIVITIES || {}) },
    rotations: { ...(content.SESSION_ACTIVITY_ROTATIONS || {}), ...(content.MIRROR_ROTATIONS || {}) }
  };
}

// Mirror faces belong to the idle base, below session and manual feedback.
// Sleep, hunger, peeking and late-night status keep their existing expression.
function mirrorBaseExpressionFor(baseExpression, activity, mirror) {
  const mode = MIRROR_MODES[normalizeMirror(mirror)];
  return baseExpression === 'life.idle' && mode && activity?.id === mode
    && activity.state === mode && typeof activity.expression === 'string'
    ? activity.expression : baseExpression;
}

function activityLabelFor(activity) {
  if (!activity) return '';
  const prefix = activity.state === 'focused' ? '专注 · ' : activity.state === 'resting' ? '休息 · ' : '';
  return `${activity.icon} ${prefix}${activity.label}`;
}

export { MIRROR_MODES, normalizeMirror, activityModeFor, activityControllerContent, activityLabelFor, mirrorBaseExpressionFor };
