import { createRenderHarness } from '../usagi-gallery/runtime-harness.mjs';

export const CYCLE_DURATION_MS = 28000;
export const CYCLE_PHASES = Object.freeze([
  { label: 'Idle', expression: 'life.idle', state: 'idle', start: 0, end: 5200 },
  { label: 'Focus', expression: 'work.focus', state: 'focused', start: 5200, end: 11200 },
  { label: 'Idle again', expression: 'life.idle', state: 'idle', start: 11200, end: 15000 },
  { label: 'Sleep', expression: 'life.sleep', state: 'sleeping', start: 15000, end: 23400 },
  { label: 'Wake', expression: 'life.wake', state: 'idle', start: 23400, end: CYCLE_DURATION_MS }
].map(Object.freeze));

export function phaseAt(at) {
  return CYCLE_PHASES.find(phase => at < phase.end) || CYCLE_PHASES.at(-1);
}

// Diagnostic input driver, not a second painter or a business-state writer.
// Gallery select() is deliberately called once only. Returned state/current
// references remain owned by that harness, with its renderer, scheduler, springs,
// sprite cache and render channel alive for the entire monotonically timed run.
export function createStateCycleDriver(source, options = {}) {
  const harness = createRenderHarness(source, { skin: 'pink', dpr: 2, blink: true, ...options });
  const current = harness.select('expression', 'life.idle');
  const first = harness.draw(0);
  const state = first.state;
  const channel = state.renderChannel;
  let selected = CYCLE_PHASES[0], previous = -1;
  const transitions = [];
  if (!options.view || options.view === 'auto') state.devPreview = null;
  function selectPhase(phase, at) {
    if (phase === selected) return;
    const item = source.expressions.EXPRESSIONS.find(value => value.id === phase.expression);
    if (!item) throw new Error(`Unknown expression: ${phase.expression}`);
    transitions.push({ at, from: selected.expression, to: phase.expression,
      previousExpressionStart: state.exprStartAnimNow, channel });
    current.item = item;
    current.duration = phase.end - phase.start;
    state.state = phase.state;
    // Scene stays fixed; this sample measures character state and live face.
    // In pinned views only, use the production expression-preview input.
    if (state.devPreview) {
      state.devPreview.id = phase.expression;
      state.devPreviewStartedAt = at;
    }
    selected = phase;
  }
  return {
    harness, transitions, state, current, stage: harness.stage, body: harness.body,
    draw(at) {
      if (!Number.isFinite(at) || at < previous) throw new Error('Continuous cycle clock must be monotonic');
      selectPhase(phaseAt(at), at);
      const result = harness.draw(at);
      if (result.state !== state || result.current !== current || state.renderChannel !== channel) {
        throw new Error('Continuous renderer context was replaced');
      }
      previous = at;
      return { ...result, phase: selected };
    },
    get elapsed() { return previous; },
    dispose() { harness.dispose(); }
  };
}
