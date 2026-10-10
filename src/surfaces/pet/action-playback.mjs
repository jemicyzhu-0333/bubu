'use strict';
import { formArt } from '../../capabilities/companion/index.mjs';
import { createMirrorPlayback, resolveMirrorBodyPose } from './mirror-playback.mjs';
import { createPaperReturnExit } from './paper-return-exit.mjs';
import { attachActivityCombination } from './activity-combination.mjs';

// Select the existing presentation source, then sample form-specific story
// beats. Selection remains independent of drawing and adds no mutable state.
function resolveActionPlayback({ content, preview, egg, sessionSnapshot, now,
  previewStartedAt = 0, actionStartedAt = 0, calmVisual = false, form,
  mirrorPlayback = null, visualBridge = null, mirrorBlocked = false, combinationContext = null } = {}) {
  let previewConfig = null;
  if (preview?.category === 'action') previewConfig = content?.PET_ACTIONS?.[preview.id] || null;
  else if (preview?.category === 'session') previewConfig = content?.SESSION_ACTIVITIES?.[preview.id] || null;
  else if (preview?.category === 'prop') {
    previewConfig = [...Object.values(content?.PET_ACTIONS || {}), ...Object.values(content?.SESSION_ACTIVITIES || {})]
      .find(action => action.prop === preview.id) || null;
  }
  let source = preview ? previewConfig : egg ? content?.PET_ACTIONS?.[egg.id] : sessionSnapshot?.activity;
  // Diagnostic action previews may carry the same validated manual record as input.
  if (form?.id === 'usagi' && egg?.manual && egg.interactionId && source?.id === egg.id) {
    source = { ...source, interactionId: egg.interactionId };
  }
  let progress = 0;
  if (preview && ['action', 'session', 'prop'].includes(preview.category)) {
    progress = calmVisual ? (source?.staticProgress ?? .5)
      : (Math.max(0, now - previewStartedAt) / Math.max(1, (egg?.interactionId && source?.id === egg.id ? egg.duration : 0) || source?.duration || source?.durationMs || 8000)) % 1;
  } else if (egg) {
    progress = egg.static || calmVisual ? (source?.staticProgress ?? .5)
      : Math.max(0, Math.min(1, (now - actionStartedAt) / Math.max(1, egg.duration)));
  } else if (sessionSnapshot) progress = calmVisual ? .5 : sessionSnapshot.progress;
  const mirrored = mirrorPlayback?.sample({ action: sessionSnapshot?.activity || null,
    progress: calmVisual ? .5 : sessionSnapshot?.progress || 0, now, formId: form?.id,
    blocked: Boolean(preview || egg || mirrorBlocked), calmVisual });
  if (mirrored && !preview && !egg) { source = mirrored.action; progress = mirrored.progress; }
  if (combinationContext && !preview && !egg) {
    source = attachActivityCombination(source, { ...combinationContext, calmVisual, blocked: mirrorBlocked });
  }
  // Remap raw global progress before story decomposition; never clamp a local cycle.
  const visual = visualBridge?.step({ actionConfig: source || null, actionT: progress },
    { preview, egg, now, actionStartedAt, calmVisual, form, combinationContext,
      viewFor: action => formArt.resolveView(form, 'auto', { action, state: combinationContext?.state?.state }) });
  const sampled = formArt.sampleAction(form, visual ? visual.actionConfig : source || null,
    visual ? visual.actionT : progress, { calmVisual });
  return Object.freeze({ previewConfig, actionConfig: sampled.action, actionT: sampled.progress, phase: sampled.phase, viewHint: visual?.viewHint });
}
function createActionPlayback() {
  const mirrorPlayback = createMirrorPlayback();
  const paperExit = createPaperReturnExit();
  let combination = null;
  function resolve(options) {
    const result = resolveActionPlayback({ ...options, mirrorPlayback, visualBridge: paperExit });
    combination = result.actionConfig?.activityCombination || null;
    return result;
  }
  function reset() { mirrorPlayback.reset(); paperExit.reset(); combination = null; }
  return Object.freeze({ resolve, reset, snapshot: mirrorPlayback.snapshot,
    combinationSnapshot: () => combination });
}
// A story's face cue also owns its small accent. Higher-priority feedback
// retains the winning expression, exactly as the independent face sampler does.
function resolvePlaybackAccent(registry, expressionId, action) {
  const selected = registry?.get(expressionId);
  const expected = action?.baseExpression || action?.expression;
  const phase = action?.faceCue && expressionId === expected ? registry?.get(action.faceCue) : null;
  return (phase || selected)?.accent || 'none';
}
export { resolveActionPlayback, resolvePlaybackAccent, createActionPlayback, resolveMirrorBodyPose };
