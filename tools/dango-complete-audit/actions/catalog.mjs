import { PET_ACTIONS } from '../../../src/content/behaviors.mjs';
import { SESSION_ACTIVITIES } from '../../../src/content/session-activities.mjs';
import { EXPRESSIONS } from '../../../src/content/expressions.mjs';
import { COMPANION_ACTIVITY_STORIES } from '../../../src/content/companion/activity-stories.mjs';
import { DANGO_ACTION_VIEWS } from '../../../src/content/companion/dango-action-views.mjs';
import dangoArtist from '../../../src/capabilities/companion/presentation/dango-raster-production.mjs';
import { EXPRESSION_PHRASES } from '../../../src/capabilities/companion/presentation/expression-phrases.mjs';

export const catalog = [
  ...Object.values(PET_ACTIONS).map(item => ({ kind: 'action', item })),
  ...Object.values(SESSION_ACTIVITIES).map(item => ({ kind: 'session', item })),
  ...EXPRESSIONS.map(item => ({ kind: 'expression', item }))
].map(({ kind, item }) => ({ kind, id: item.id, label: item.name || item.label,
  durationMs: item.duration || item.durationMs || Math.max(6400, (EXPRESSION_PHRASES[item.id]?.[0] || 0) + 400), item,
  story: COMPANION_ACTIVITY_STORIES[item.id] || null,
  views: ['auto', 'front', 'three-quarter', 'profile', 'back', 'three-quarter-left'].map(requested => ({
    requested, effective: dangoArtist.resolveView(requested, { action: kind === 'expression' ? null : item, state: item.state }),
    policy: DANGO_ACTION_VIEWS[item.id] || { preferred: 'front', allowed: ['front', 'three-quarter', 'back', 'three-quarter-left', 'three-quarter-right'] }
  }))
}));

export function proofTimes(entry) {
  if (!entry.story) {
    const keyPhases = entry.id === 'photo-pose' ? [.02, .15, .32, .46, .5, .68, .85, .98]
      : entry.id === 'build-blocks' ? [.02, .15, .32, .5, .6, .68, .85, .98]
      : [.02, .15, .32, .5, .68, .85, .98];
    return keyPhases.map(p => ({ atMs: p * entry.durationMs, phase: 'action', progress: p }));
  }
  let start = 0;
  return entry.story.stages.flatMap((stage, index) => {
    const begin = start; start = stage.until;
    return [.12, .5, .88].map(local => ({ atMs: (begin + (stage.until - begin) * local) * entry.durationMs,
      phase: `${index + 1}: ${stage.label}`, motion: stage.motion, prop: stage.prop, progress: local }));
  });
}
