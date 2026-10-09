import { BASELINE, createScenario, scenarioAt } from './scenario.mjs';
import { createTimingHistogram } from './statistics.mjs';
import { createFrameClock } from './frame-clock.mjs';
import { observeResources } from './resource-observer.mjs';
import { loadProduction, createPainterHost } from './painter-host.mjs';

const resources = observeResources();
const intervals = createTimingHistogram(), paints = createTimingHistogram();
const windowIntervals = createTimingHistogram(), windowPaints = createTimingHistogram();
const clock = createFrameClock();
let host, scenario, firstFrameReady, firstFrameTimestamp, elapsed = 0, activeStep = -1, handle, running = false;
let errorCount = 0, hiddenFrames = 0, dprChanges = 0, skippedSteps = 0, dpr;
const errors = [];
function recordError(error) { errorCount++; if (errors.length < 20) errors.push(String(error?.stack || error)); }
window.addEventListener('error', event => recordError(event.error || event.message));
window.addEventListener('unhandledrejection', event => recordError(event.reason));

function frame(now) {
  if (!running) return;
  try {
    const tick = clock.tick(now);
    elapsed = tick.elapsedMs;
    if (!tick.first) { intervals.add(tick.deltaMs); windowIntervals.add(tick.deltaMs); }
    if (document.visibilityState !== 'visible') hiddenFrames++;
    if (window.devicePixelRatio !== dpr) dprChanges++;
    const entry = scenarioAt(scenario, elapsed);
    if (entry.step !== activeStep) {
      if (activeStep >= 0) skippedSteps += Math.max(0, entry.step - activeStep - 1);
      host.select(entry.entry, entry.startedAt); activeStep = entry.step;
    }
    const before = performance.now();
    host.draw(elapsed, tick.deltaMs);
    const drawMs = performance.now() - before;
    paints.add(drawMs); windowPaints.add(drawMs);
    handle = requestAnimationFrame(frame);
    if (firstFrameReady) {
      firstFrameTimestamp = tick.origin;
      const ready = firstFrameReady; firstFrameReady = null; ready.resolve();
    }
  } catch (error) {
    recordError(error); running = false; cancelAnimationFrame(handle);
    if (firstFrameReady) {
      const ready = firstFrameReady; firstFrameReady = null; ready.reject(error);
    }
  }
}

export async function start() {
  if (host) throw new Error('Memory renderer already started');
  const source = await loadProduction(); dpr = window.devicePixelRatio;
  scenario = createScenario({ skins: source.skins.SKINS, actions: source.behaviors.PET_ACTIONS,
    sessions: source.sessions.SESSION_ACTIVITIES, outfits: source.outfits.USAGI_OUTFIT_SETS });
  host = createPainterHost(source, dpr, BASELINE.seed);
  await new Promise((resolve, reject) => {
    firstFrameReady = { resolve, reject }; running = true;
    handle = requestAnimationFrame(frame);
  });
  return { firstFrameTimestamp, clockOrigin: 'first-genuine-rAF', dpr, scenario, stageCssSize: 220, instances: 1, seed: BASELINE.seed,
    painter: 'src/surfaces/pet/renderer.mjs:createPetRenderer',
    timing: 'actual rAF intervals; production executeFrame CPU draw duration separately; no forced GC',
    resources: 'weak references only; observed at sampling boundaries; no screenshots or PNG encoding' };
}

export function sample() {
  const result = { elapsedMs: elapsed, running, step: activeStep,
    errorCount, errors: [...errors], hiddenFrames, dprChanges, skippedSteps,
    frameIntervals: intervals.snapshot(), drawDurations: paints.snapshot(),
    windowFrameIntervals: windowIntervals.snapshot(), windowDrawDurations: windowPaints.snapshot(),
    ...host.snapshot(), resources: resources.snapshot() };
  windowIntervals.reset(); windowPaints.reset(); return result;
}

export function stop() {
  running = false; cancelAnimationFrame(handle);
  const result = sample(); host.dispose(); return result;
}
