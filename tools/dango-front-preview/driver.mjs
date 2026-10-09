import { createRenderHarness } from '../usagi-gallery/runtime-harness.mjs';

export const FRONT_DURATION_MS = 14000;
export const FRONT_PHASES = Object.freeze([
  { label: '待机', expression: 'life.idle', state: 'idle', start: 0, end: 4000 },
  { label: '专注', expression: 'work.focus', state: 'focused', start: 4000, end: 7000 },
  { label: '回到待机', expression: 'life.idle', state: 'idle', start: 7000, end: 8000 },
  { label: '睡眠', expression: 'life.sleep', state: 'sleeping', start: 8000, end: 11000 },
  { label: '醒来', expression: 'life.wake', state: 'idle', start: 11000, end: FRONT_DURATION_MS }
].map(Object.freeze));
export const frontPhaseAt = at => FRONT_PHASES.find(phase => at < phase.end) || FRONT_PHASES.at(-1);
export const OUTFITS = Object.freeze([
  { key: 'bare', label: '原样团子', itemIds: [] },
  { key: 'sunhat', label: '小草帽 + 彩虹围巾', itemIds: ['milestone.scarf', 'milestone.sunhat'] },
  { key: 'sprout', label: '小芽 + 彩虹围巾', itemIds: ['milestone.scarf', 'milestone.sprout'] }
].map(Object.freeze));

// Same retained production-harness contract as the full state-cycle driver.
// Only diagnostic state holds are shorter; no animation clocks are accelerated.
export function createFrontReviewDriver(source, options = {}) {
  const harness = createRenderHarness(source, { skin: 'pink', dpr: 2, blink: true, ...options });
  const current = harness.select('expression', 'life.idle');
  const state = harness.draw(0).state, channel = state.renderChannel;
  let selected = FRONT_PHASES[0], previous = -1;
  const transitions = [];
  if (!options.view || options.view === 'auto') state.devPreview = null;
  return {
    harness, state, current, transitions, stage: harness.stage, body: harness.body,
    draw(at) {
      if (!Number.isFinite(at) || at < previous) throw Error('Front preview clock must be monotonic');
      const phase = frontPhaseAt(at);
      if (phase !== selected) {
        const item = source.expressions.EXPRESSIONS.find(value => value.id === phase.expression);
        if (!item) throw Error(`Unknown production expression: ${phase.expression}`);
        transitions.push({ at, from: selected.expression, to: phase.expression, channel });
        current.item = item;
        current.duration = phase.end - phase.start;
        state.state = phase.state;
        if (state.devPreview) {
          state.devPreview.id = phase.expression;
          state.devPreviewStartedAt = at;
        }
        selected = phase;
      }
      const result = harness.draw(at);
      if (result.state !== state || result.current !== current || state.renderChannel !== channel) {
        throw Error('Front preview replaced its production renderer context');
      }
      previous = at;
      return { ...result, phase };
    },
    dispose() { harness.dispose(); }
  };
}
