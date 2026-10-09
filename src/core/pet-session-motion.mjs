import { COMPANION_ACTIVITY_STORIES } from '../content/companion/activity-stories.mjs';

const clamp = value => Math.max(0, Math.min(1, value));
const ease = value => { const t = clamp(value); return t * t * (3 - 2 * t); };

function translation(motion, progress) {
  const phase = progress * Math.PI * 2;
  if (motion === 'doze') return { x: 0, y: 5 + Math.round(Math.sin(phase)) };
  if (motion === 'daydream' || motion === 'look') return { x: Math.round(Math.sin(phase)), y: 0 };
  return { x: 0, y: Math.round(Math.sin(phase * 2)) };
}

// A story beat changes intent without teleporting the whole pixel character.
// Sample the prior beat's settled endpoint, then approach the new live pose.
// The shared activity clock supplies all time; no remembered state or timer.
function sessionBodyTranslation(action, progress, { calmVisual = false } = {}) {
  if (calmVisual) return { x: 0, y: 0 };
  const current = translation(action.motion, progress);
  const phase = action.sequencePhase, story = COMPANION_ACTIVITY_STORIES[action.id];
  if (!phase || !story || !phase.index) return current;
  const beat = story.stages[phase.index], previous = story.stages[phase.index - 1];
  const elapsed = phase.progress * (beat.until - previous.until) * (action.durationMs || action.duration || 30000);
  const amount = ease(elapsed / 240);
  const from = translation(previous.motion, 1);
  return { x: from.x + (current.x - from.x) * amount, y: from.y + (current.y - from.y) * amount };
}

export { sessionBodyTranslation };
