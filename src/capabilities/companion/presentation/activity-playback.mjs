'use strict';
import { COMPANION_ACTIVITY_STORIES } from '../../../content/companion/activity-stories.mjs';

const clamp = value => Math.max(0, Math.min(1, Number(value) || 0));
const smooth = value => value * value * (3 - 2 * value);

// Pure sampling, independent of frame rate. It never selects a new activity,
// owns no wall clock, and cannot change the Presentation Director's priority.
function sampleActivityStory(action, progress, { calmVisual = false } = {}) {
  const timeline = COMPANION_ACTIVITY_STORIES[action?.id];
  if (!timeline) return Object.freeze({ action, progress: clamp(progress), phase: null });
  const t = calmVisual ? timeline.hold : clamp(progress);
  let start = 0;
  for (let index = 0; index < timeline.stages.length; index += 1) {
    const beat = timeline.stages[index];
    if (t < beat.until || index === timeline.stages.length - 1) {
      const local = clamp((t - start) / (beat.until - start));
      const cycles = calmVisual ? .5 : local * beat.cycles;
      const stageMs = (action.durationMs || action.duration || 30000) * (beat.until - start);
      // Hold shared tools across beats; only a real equipment change gets a
      // short put-down/pick-up fade while the existing rig blends the paws.
      const previous = timeline.stages[index - 1], next = timeline.stages[index + 1];
      const appear = previous && previous.prop !== beat.prop ? clamp(local * stageMs / 220) : 1;
      const disappear = next && next.prop !== beat.prop ? clamp((1 - local) * stageMs / 220) : 1;
      const propOpacity = calmVisual ? 1 : smooth(Math.min(appear, disappear));
      const phase = Object.freeze({ index, count: timeline.stages.length, label: beat.label,
        progress: local, timelineProgress: t, expression: beat.expression });
      return Object.freeze({
        action: Object.freeze({ ...action, motion: beat.motion, prop: beat.prop,
          baseExpression: action.expression, viewMotion: action.motion, faceCue: beat.expression, sequencePhase: phase, propOpacity }),
        progress: calmVisual ? .5 : (local === 1 ? 1 : cycles % 1), phase
      });
    }
    start = beat.until;
  }
  return Object.freeze({ action, progress: t, phase: null });
}
export { sampleActivityStory };
