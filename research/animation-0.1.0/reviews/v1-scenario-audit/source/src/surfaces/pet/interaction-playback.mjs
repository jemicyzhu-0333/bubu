'use strict';

// Manual input keeps the existing action and reward identities. Only this
// transient playback record carries the context needed by the presentation.
function resolveInteraction(content, id) {
  const match = /^click-(\d+)$/.exec(id || '');
  return match ? content?.INTERACTIONS?.clickCount?.[Number(match[1])]
    : ['longPress', 'fling'].includes(id) ? content?.INTERACTIONS?.[id] : null;
}

function createManualActionPlayback(content, actionId, { interactionId, formId } = {}) {
  const action = content?.PET_ACTIONS?.[actionId];
  if (!action) return null;
  const interaction = resolveInteraction(content, interactionId);
  const contextual = interaction?.action === actionId;
  const redesigned = contextual && formId === 'usagi';
  return Object.freeze({ id: actionId, duration: redesigned ? interaction.duration || action.duration : action.duration,
    manual: true, ...(contextual ? { interactionId } : {}),
    expression: redesigned && interactionId === 'longPress' ? 'react.petted'
      : redesigned && interactionId === 'click-30' ? 'react.happy' : action.expression });
}

function createInteractionParticles(effect, { calmVisual = false, random = Math.random, formId } = {}) {
  if (calmVisual || !['explode', 'purr'].includes(effect)) return [];
  // Usagi's contextual fireworks are deterministic, body-space blooms.
  // Dango retains the original one-shot particle performance.
  if (effect === 'explode' && formId === 'usagi') return [];
  const rand = (a, b) => a + random() * (b - a);
  const pick = values => values[Math.floor(random() * values.length)];
  const count = effect === 'explode' ? 30 : 5;
  return Array.from({ length: count }, () => effect === 'explode'
    ? { type: 'flash', x: 110, y: 110, vx: rand(-4, 4), vy: rand(-4, 4), gravity: .15,
      life: 40, baseLife: 40, color: pick(['#f7768e', '#e0af68', '#7dcfff']) }
    : { type: 'heart', x: 110 + rand(-14, 14), y: 98, vx: rand(-.25, .25), vy: rand(-.9, -.5),
      life: 40, baseLife: 40, color: pick(['#ffd5e0', '#f7768e', '#c8b3f5']) });
}

export { resolveInteraction, createManualActionPlayback, createInteractionParticles };
