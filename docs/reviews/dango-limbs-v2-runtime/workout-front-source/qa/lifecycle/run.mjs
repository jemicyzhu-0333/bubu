import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { fixture } from './fixture.mjs';
import { root, out } from '../qa-paths.mjs';
const reportPath = out + '/' + (process.env.WORKOUT_SCENARIO || 'report') + '.json';
const f = await fixture(root, out), F = f.F;
const scenarios = [
  { id: 'smoke', end: 1800, mode: ['full', 'high'], events: [[100, 'start', 'workout'], [500, 'mode', ['reduced', 'high']], [700, 'mode', ['full', 'high']], [900, 'drag', true], [1000, 'drag', false], [1100, 'start', 'workout'], [1400, 'hide', true], [1500, 'hide', false], [1600, 'start', 'workout']] },
  { id: 'full-natural-expiry', end: 10000, mode: ['full', 'high'], events: [[300, 'start', 'workout']] },
  { id: 'reduced-natural-expiry', end: 10000, mode: ['reduced', 'high'], events: [[300, 'start', 'workout']] },
  { id: 'low-stimulation-natural-expiry', end: 10000, mode: ['full', 'low'], events: [[300, 'start', 'workout']] },
  { id: 'mode-switches', end: 10000, mode: ['full', 'high'], events: [[300, 'start', 'workout'], [1600, 'mode', ['reduced', 'high']], [2800, 'mode', ['full', 'high']], [4000, 'mode', ['full', 'low']], [5200, 'mode', ['full', 'high']]] },
  { id: 'replace-retrigger', end: 13800, mode: ['full', 'high'], events: [[300, 'start', 'workout'], [2300, 'start', 'wave'], [3400, 'start', 'workout'], [4600, 'start', 'workout']] },
  { id: 'drag-cancel-retrigger', end: 13800, mode: ['full', 'high'], facing: -1, events: [[300, 'start', 'workout'], [2600, 'drag', true], [3400, 'drag', false], [4000, 'start', 'workout']] },
  { id: 'hide-menu-cancel-retrigger', end: 16800, mode: ['full', 'high'], events: [[300, 'start', 'workout'], [2300, 'hide', true], [3200, 'hide', false], [3600, 'start', 'workout'], [6300, 'menu', true], [6700, 'menu', false], [7200, 'start', 'workout']] },
  { id: 'paper-replacement-handoff', end: 12300, mode: ['full', 'high'], events: [[300, 'start', 'paper-plane'], [2800, 'start', 'workout']] }
];
const report = { scope: 'Actual integrated production manifest, selector, artist, action/paw/appearance painters, createPetRenderer, production createManualActionPlayback and verbatim isolated controller begin/cancel/update functions. Image port is local Skia. Final-stage single-source omissions use unchanged complete manifest/artwork/frame inputs. Pointer events and visibility/OS scheduling are modeled as explicit state/cancel events, not native acceptance.',
  sourceKeys: ['workout-front-support-v4-left', 'workout-front-support-v4-right'], scenarios: [], failures: [] };
const hash = c => crypto.createHash('sha256').update(c.getContext('2d').getImageData(0, 0, c.width, c.height).data).digest('hex');
function check(ok, why, context) { if (!ok) { const fail = { ...context, reason: why }; report.failures.push(fail); if (report.failures.length < 5) console.error('BUG', JSON.stringify(fail)); } }
try {
  for (const [index, scenario] of scenarios.entries()) {
    if (!process.env.WORKOUT_SCENARIO && scenario.id === 'smoke') continue;
    if (process.env.WORKOUT_SCENARIO && scenario.id !== process.env.WORKOUT_SCENARIO) continue;
    const base = (index + 1) * 30000, controller = f.createControllerLifecycle(), h = {}, opts = {};
    let sensory = [...scenario.mode], dragging = false, hidden = false, menu = false, ei = 0;
    const result = { id: scenario.id, frames: 0, actionFrames: 0, sourceFrames: 0, atomicFrames: 0, contributionProofs: 0, legacyNoContributionFrames: 0, idleFrames: 0, fallbackFrames: 0, zeroOpacitySourceFrames: 0, rows: [], events: [], minContributions: { left: Infinity, right: Infinity } };
    for (const mode of f.modes) {
      const s = f.sources[mode];
      opts[mode] = { skin: 'pink', outfit: false, dpr: 2, facing: scenario.facing || 1, view: 'auto', blink: false,
        expressionFor: state => s.behaviors.PET_ACTIONS[state.currentEgg?.id]?.expression || 'life.idle' };
      h[mode] = f.createRenderHarness(s, opts[mode]); h[mode].select('expression', 'life.idle');
      h[mode].updateState({ renderChannel: 'pet', devPreview: null, currentEgg: null, appearanceItemIds: [] });
      F.trace.register(mode, h[mode].body);
    }
    F.guard.observeFinalStage(h.actual.body); F.omissions.omitLeft.observeFinalStage(h.omitLeft.body); F.omissions.omitRight.observeFinalStage(h.omitRight.body);
    let staticHash = null, previousSensory = '', previousSource = false;
    const times = new Set(Array.from({ length: Math.floor(scenario.end / 40) + 1 }, (_, i) => i * 40));
    for (const [at, type, value] of scenario.events) { times.add(at); times.add(at + 1); if (type === 'start') { times.add(at + f.sources.actual.behaviors.PET_ACTIONS[value].duration - 1); times.add(at + f.sources.actual.behaviors.PET_ACTIONS[value].duration); times.add(at + f.sources.actual.behaviors.PET_ACTIONS[value].duration + 1); } }
    for (const t of [...times].filter(t => t <= scenario.end).sort((a, b) => a - b)) {
      controller.setNow(base + t);
      while (ei < scenario.events.length && t >= scenario.events[ei][0]) {
        const [at, type, value] = scenario.events[ei++];
        if (type === 'start') { controller.setNow(base + at); controller.begin(f.sources.actual.interactionPlayback.createManualActionPlayback(f.sources.actual.behaviors, value, { formId: 'dango' })); controller.setNow(base + t); }
        if (type === 'mode') sensory = [...value];
        if (type === 'drag') { dragging = value; if (value) controller.cancel('drag'); }
        if (type === 'hide') { hidden = value; if (value) controller.cancel('hidden'); }
        if (type === 'menu') { menu = value; if (value) controller.cancel('menu-open'); }
        result.events.push({ at, type, value, ...controller.snapshot() });
      }
      const expired = controller.update(base + t), snapshot = controller.snapshot(), calm = sensory[0] === 'reduced' || sensory[1] === 'low';
      const state = { currentEgg: snapshot.currentEgg, actionStartedAt: snapshot.actionStartedAt,
        motionMode: sensory[0], stimulationMode: sensory[1], dragging, state: dragging ? 'dragged' : 'idle',
        dragVx: dragging ? .6 : 0, dragVy: dragging ? -.3 : 0, screenLocked: hidden, commandMenuOpen: menu };
      const renders = {};
      for (const mode of f.modes) {
        opts[mode].calm = calm; h[mode].updateState(state); F.traces[mode] = null; F.trace.begin(mode);
        renders[mode] = h[mode].draw(base + t);
      }
      const actualTrace = F.traces.actual, art = actualTrace?.art, action = actualTrace?.options.action;
      const context = { scenario: scenario.id, t, action: action?.id || null, requested: snapshot.currentEgg?.id || null };
      check(Boolean(actualTrace), 'no fresh artist call', context);
      if (!art) continue;
      const selected = art.sourceContactPose === 'workout-front-support-v4';
      const tools = (art.contact?.tools || []).filter(tool => tool.key.startsWith('workout-front-support-v4'));
      const calls = F.trace.read('actual'), sourceCalls = calls.filter(call => call.sources.some(s => s.includes('/workout-front-support-v4/')));
      const selectedSides = tools.map(tool => tool.coversPaw).sort();
      check(tools.length === 0 || tools.length === 2, 'partial source pair selected', context);
      check(selected === (tools.length === 2), 'source marker/tool pair disagree', context);
      if (!selected) check(sourceCalls.length === 0, 'source draw survives without selection', context);
      if (action?.id !== 'workout') check(!selected && !tools.length && !sourceCalls.length, 'workout hand survives after action replaced/cleared', context);
      if (!snapshot.currentEgg) { result.idleFrames++; check(!selected && !sourceCalls.length, 'workout hand survives controller cancellation/expiry', context); }
      if (dragging) check(!selected && !sourceCalls.length, 'workout source survives drag cancel', context);
      if (action?.id === 'workout') result.actionFrames++;
      if (selected) {
        result.sourceFrames++;
        check(art.view === 'front', 'workout source selected outside front', context);
        check(JSON.stringify(selectedSides) === '["left","right"]', 'non-atomic anatomical sides', context);
        check(tools.every(tool => tool.layer === 'back'), 'source draw not in back tool pass', context);
        check(art.contact.hands.length === 2 && art.contact.hands.every(hand => !hand.pawSprite && !hand.pawMatrix && hand.layer === 'back' && hand.connector === false && hand.limb === false), 'legacy paw routing remains on selected hand', context);
        result.atomicFrames++;
        const actualHash = hash(h.actual.body), oldOmittedHash = hash(h.omitLegacy.body);
        check(actualHash === oldOmittedHash, 'old paw/arm pixels still contribute with new source selected', context);
        if (actualHash === oldOmittedHash) result.legacyNoContributionFrames++;
        const expectedOpacity = (action?.propOpacity ?? 1) * Math.max(...tools.map(tool => tool.opacity ?? 1));
        if (expectedOpacity > .001) {
          for (const [side, mode] of [['left', 'omitLeft'], ['right', 'omitRight']]) {
            try {
              const proof = F.guard.assertContribution({ targetId: side, stage: h.actual.body, omittedStage: h[mode].body,
                artwork: art, omittedArtwork: F.traces[mode].art,
                renderInputs: { manifest: F.manifests.actual, frame: f.sources.actual.controls.at(-1).lastFrame },
                omittedRenderInputs: { manifest: F.manifests[mode], frame: f.sources[mode].controls.at(-1).lastFrame },
                label: scenario.id + ':' + t });
              result.minContributions[side] = Math.min(result.minContributions[side], proof.changedPixels); result.contributionProofs++;
            } catch (error) { check(false, error.message, { ...context, side }); }
          }
        } else { result.zeroOpacitySourceFrames++; check(actualHash === hash(h.omitLeft.body) && actualHash === hash(h.omitRight.body), 'invisible hand envelope leaks pixels', context); }
        const sensoryKey = sensory.join(':');
        if (calm && previousSensory === sensoryKey && previousSource) { if (staticHash) check(staticHash === actualHash, 'calm full-stage artwork continues moving', context); staticHash = actualHash; }
        else staticHash = calm ? actualHash : null;
      } else if (action?.id === 'workout') result.fallbackFrames++;
      previousSensory = sensory.join(':'); previousSource = selected;
      const row = { t, requested: snapshot.currentEgg?.id || null, actual: action?.id || null, source: selected,
        view: art.view, progress: actualTrace.options.progress, sensory, expired, dragging, hidden, menu,
        freshArtistCalls: actualTrace.count, sourceDrawCalls: sourceCalls.length, opacity: action?.propOpacity ?? 1,
        handoffRecovery: action?.handoffRecovery ?? null };
      if (t % 200 === 0 || expired || scenario.events.some(e => t === e[0] || t === e[0] + 1)) result.rows.push(row);
      if ([400, 2600, 3400, 4000, 5200, 8800, 9200].includes(t)) fs.writeFileSync(out + '/' + scenario.id + '-' + t + '.png', h.actual.body.toBuffer('image/png'));
      result.frames++;
    }
    for (const harness of Object.values(h)) harness.dispose();
    report.scenarios.push(result);
    console.log(JSON.stringify({ ...result, rows: undefined, events: undefined }));
    fs.writeFileSync(reportPath, JSON.stringify({ ...report, guard: F.guard.snapshot() }, null, 2));
  }
} finally { f.dispose(); fs.writeFileSync(reportPath, JSON.stringify({ ...report, guard: F.guard.snapshot() }, null, 2)); }
console.log(JSON.stringify({ totalFrames: report.scenarios.reduce((n, r) => n + r.frames, 0), failures: report.failures.length }));
if (report.failures.length) process.exitCode = 1;
