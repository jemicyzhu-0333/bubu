// PET_VISUAL「动画表达方式与片段契约」: one finite
// five-minute input cycle, repeated unchanged after the first warm-up cycle.
export const BASELINE = Object.freeze({ durationMs: 30 * 60_000, sampleMs: 5 * 60_000,
  warmupMs: 5 * 60_000, stepMs: 5_000, steps: 60, seed: 0x5eed2026,
  maxFrameP95Ms: 20, maxFinalGrowthFraction: 0.10, linearGrowthRSquared: 0.8 });

function shuffle(values, seed) {
  const result = [...values]; let state = seed >>> 0;
  for (let i = result.length - 1; i > 0; i--) {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    const j = (state >>> 0) % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function createScenario({ skins, actions, sessions, outfits }) {
  const skinIds = shuffle(Object.keys(skins).filter(id => id !== 'usagi').sort(), BASELINE.seed);
  const activityIds = shuffle([
    { kind: 'expression', id: 'life.idle' },
    ...Object.keys(actions).sort().map(id => ({ kind: 'action', id })),
    ...Object.keys(sessions).sort().map(id => ({ kind: 'session', id }))
  ], BASELINE.seed ^ 0x913a7);
  if (!skinIds.length || !skins.usagi || activityIds.length > BASELINE.steps) {
    throw new Error('The frozen memory scenario requires review for this content catalog');
  }
  const dangoOutfits = [[], ['milestone.sunhat', 'milestone.scarf', 'milestone.boots'],
    ['milestone.cape', 'milestone.satchel', 'milestone.halo']];
  let dangoIndex = 0, usagiIndex = 0;
  return Object.freeze(Array.from({ length: BASELINE.steps }, (_, index) => {
    const usagi = index % 3 === 2;
    const outfit = usagi ? [[], ...outfits.map(item => item.itemIds)][usagiIndex++ % (outfits.length + 1)]
      : dangoOutfits[Math.floor(dangoIndex / skinIds.length) % dangoOutfits.length];
    return Object.freeze({ ...activityIds[index % activityIds.length],
      skin: usagi ? 'usagi' : skinIds[dangoIndex++ % skinIds.length],
      outfit: Object.freeze([...outfit]), view: ['front', 'three-quarter', 'profile', 'back'][index % 4],
      facing: index % 2 ? -1 : 1 });
  }));
}

export function scenarioAt(scenario, elapsedMs) {
  const step = Math.floor(Math.max(0, elapsedMs) / BASELINE.stepMs);
  return { entry: scenario[step % scenario.length], step,
    startedAt: step * BASELINE.stepMs, cycle: Math.floor(step / scenario.length) };
}

export function parseOptions(args) {
  const options = { smoke: false, out: null };
  for (const argument of args) {
    if (argument === '--smoke') options.smoke = true;
    else if (argument.startsWith('--out=') && argument.length > 6) options.out = argument.slice(6);
    else throw new Error(`Unknown memory-harness argument: ${argument}`);
  }
  return Object.freeze({ ...options, durationMs: options.smoke ? 60_000 : BASELINE.durationMs,
    sampleMs: options.smoke ? 15_000 : BASELINE.sampleMs });
}
