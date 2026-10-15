// Run only AFTER parent confirms the real selector/manifest integration.
// No helper injection and no hand/action painter override are used here.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { snapshotDraws } from './snapshot-draws.mjs';
import { out, backend, sources, fixture, createRenderHarness, directorModule } from './production-fixture.mjs';
const dpr = Number(process.env.WORKOUT_DPR || 1);
const facing = Number(process.env.WORKOUT_FACING || 1);
const calm = process.env.WORKOUT_CALM === '1';
const outfit = process.env.WORKOUT_OUTFIT ? JSON.parse(process.env.WORKOUT_OUTFIT) : false;
const smoke = process.env.WORKOUT_SMOKE === '1';
const frameNumbers = smoke ? [0, 128, 255, 509] : Array.from({ length: 510 }, (_, i) => i);
const tag = process.env.WORKOUT_QA_TAG || `bare-dpr${dpr}-facing${facing}-${calm ? 'calm' : 'full'}`;
const dir = out + tag + '/'; fs.mkdirSync(dir, { recursive: true });
const modes = ['legacy', 'actual', 'omitLeft', 'omitRight', 'omitFootL', 'omitFootR', 'omitBootL', 'omitBootR'];
const wearingBoots = Array.isArray(outfit) && outfit.includes('milestone.boots');
const inputs = { skin: 'pink', outfit, dpr, facing, calm, blink: false,
  director: { module: directorModule, source: 'interaction' } };
const harnesses = {}, bodyMaps = {}, stageDraws = {}, report = { inputs: { ...inputs, director: { source: 'interaction' } },
  auditVersion: 'immutable-geometry-v1', smoke,
  soleToleranceDevicePixels: wearingBoots ? 0.0001 : 0,
  soleToleranceReason: wearingBoots ? 'Existing boot painter scales by 0.8 around art sole y=64; final Skia CTM coefficients are float32. New-versus-legacy original boot remains exact zero.' : 'No extra boot scale; exact same-frame original foot comparison.',
  resourceSamples: [],
  resourcePolicy: 'Every eight frames yield setImmediate; per-frame QA traces reset; QA body-cache identity uses WeakMap. Production cache lifetimes and drawing are unchanged. No forced GC.',
  scope: 'Actual integrated selector/artist/createPetRenderer at every 60Hz frame of the 8.5s action, plus exit frames after explicitly applying the controller currentEgg=null deadline transition (the renderer does not expire actions). Source-omission controls preserve full manifest, artwork and frame inputs. Offscreen Skia, not native.', frames: [], failures: [], exits: [] };
for (const mode of modes) {
  const h = createRenderHarness(sources[mode], inputs); harnesses[mode] = h; stageDraws[mode] = [];
  const mapped = backend.createCanvas(h.body.width, h.body.height), mx = mapped.getContext('2d');
  bodyMaps[mode] = mapped;
  const ctx = h.body.getContext('2d'), draw = ctx.drawImage.bind(ctx);
  ctx.drawImage = function (source, ...args) {
    const m = this.getTransform();
    const record = (id, x, y) => stageDraws[mode].push({ id, drawImageArgs: [...args], imageSize: [source.width, source.height],
      ctm: [m.a,m.b,m.c,m.d,m.e,m.f], actualFinalStage: this.canvas === h.body, soleY: m.b*x+m.d*y+m.f });
    if (source.width === 720 && source.height === 648 && args.length === 4 && args.every((v,i)=>v===[-12,-1,90,81][i]))
      record(stageDraws[mode].some(x=>x.id==='hand-left')?'hand-right':'hand-left', stageDraws[mode].some(x=>x.id==='hand-left')?59.5:6.5, 64);
    for (const side of ['left','right']) {
      const rect = fixture.manifests[mode].views.front.parts['foot-'+side].rect;
      if (args.length===4 && args.every((v,i)=>v===rect[i])) record('foot-'+side, rect[0]+rect[2]/2, rect[1]+rect[3]);
      const shoe = fixture.manifests[mode].appearance.boots.views.front.front.find(x=>x.attachment==='foot-'+side).rect;
      if (args.length===4 && args.every((v,i)=>v===shoe[i])) record('boot-'+side, shoe[0]+shoe[2]/2, shoe[1]+shoe[3]);
    }
    if (fixture.bodyCaches.has(source)) {
      const m = this.getTransform(); mx.clearRect(0, 0, mapped.width, mapped.height);
      mx.save(); mx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
      mx.globalAlpha = this.globalAlpha; mx.imageSmoothingEnabled = this.imageSmoothingEnabled;
      mx.drawImage(source, ...args); mx.restore();
    }
    return draw(source, ...args);
  };
  if (mode === 'actual') fixture.guard.observeFinalStage(h.body);
  if (fixture.omissions[mode]) fixture.omissions[mode].observeFinalStage(h.body);
  h.select('action', 'workout');
}
const pixels = c => c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
const frameInput = (state, now) => ({ harnessOptions: report.inputs, selection: ['action', 'workout'], now,
  state, motionSeed: 0x55a61, blinkSeed: 0x913a7, wallNow: Date.UTC(2026, 9, 1, 14) + now });
try {
  for (const frame of frameNumbers) {
    const now = frame * 1000 / 60, states = {}, art = {};
    for (const mode of modes) {
      stageDraws[mode].length = 0;
      fixture.traces[mode].length = 0; // Only this frame is evidence; do not retain prior artwork graphs.
      states[mode] = structuredClone(harnesses[mode].draw(now).state); delete states[mode].renderChannel;
      art[mode] = fixture.traces[mode].at(-1);
    }
    assert.equal(art.actual.sourceContactPose, 'workout-front-support-v4', `source unavailable at frame ${frame}`);
    const actualBody = pixels(bodyMaps.actual), legacyBody = pixels(bodyMaps.legacy);
    assert.deepEqual(actualBody, legacyBody, `canonical mapped body differs at frame ${frame}`);
    for (const field of ['data', 'matrices', 'attachmentMatrices', 'footwearTransforms'])
      assert.deepEqual(art.actual[field], art.legacy[field], `${field} changed at frame ${frame}`);
    const row = { frame, now, phase: art.actual.progress, hands: {}, feet: {}, boots: {}, draws: snapshotDraws(stageDraws.actual), legacyDraws: snapshotDraws(stageDraws.legacy), bodyIdentical: true };
    for (const [id, omitted] of [['left', 'omitLeft'], ['right', 'omitRight'], ['foot-left', 'omitFootL'], ['foot-right', 'omitFootR'], ['boot-left', 'omitBootL'], ['boot-right', 'omitBootR']]) {
      if (id.startsWith('boot-') && !wearingBoots) continue;
      if (id.startsWith('foot-') && art.actual.hiddenParts.includes(id)) {
        row.feet[id] = { hiddenByApprovedReadyFootwear: true }; continue;
      }
      const contribution = fixture.guard.assertContribution({ targetId: id, stage: harnesses.actual.body,
        omittedStage: harnesses[omitted].body, artwork: art.actual, omittedArtwork: art[omitted],
        renderInputs: { manifest: fixture.manifests.actual, frame: frameInput(states.actual, now) },
        omittedRenderInputs: { manifest: fixture.manifests[omitted], frame: frameInput(states[omitted], now) }, label: `frame=${frame}` });
      const a = pixels(harnesses.actual.body), b = pixels(harnesses[omitted].body);
      let x0 = harnesses.actual.body.width, y0 = harnesses.actual.body.height, x1 = -1, y1 = -1, majorityBottom = 0, interiorLeak = 0, opaqueBodyChangedPixels = 0, opaqueBodyMaxDelta = 0;
      for (let i = 0; i < a.length; i += 4) {
        let difference = 0; for (let c = 0; c < 4; c++) difference = Math.max(difference, Math.abs(a[i + c] - b[i + c]));
        if (!difference || !a[i + 3] && !b[i + 3]) continue;
        const x = i / 4 % harnesses.actual.body.width, y = Math.floor(i / 4 / harnesses.actual.body.width);
        if (a[i+3] >= 128) majorityBottom = Math.max(majorityBottom, y+1);
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
        if (['left','right'].includes(id) && actualBody[i + 3] >= 254) { opaqueBodyChangedPixels++; opaqueBodyMaxDelta = Math.max(opaqueBodyMaxDelta, difference); if (difference > 8) interiorLeak++; }
      }
      const result = { ...contribution, bbox: [x0, y0, x1 + 1, y1 + 1], bottomBoundaryExclusive: y1 + 1, majorityBottomBoundaryExclusive: majorityBottom, interiorLeak, opaqueBodyChangedPixels, opaqueBodyMaxDelta };
      if (id.startsWith('foot-')) row.feet[id] = result; else if (id.startsWith('boot-')) row.boots[id] = result; else {
        row.hands[id] = result;
        if (interiorLeak) report.failures.push({ frame, id, reason: 'source visible inside opaque canonical body', interiorLeak });
      }
    }
    for (const side of ['left','right']) {
      const hand = row.draws.find(x=>x.id==='hand-'+side), foot = row.draws.find(x=>x.id===(wearingBoots?'boot-':'foot-')+side);
      const old = row.legacyDraws.find(x=>x.id===(wearingBoots?'boot-':'foot-')+side);
      assert.ok(hand?.actualFinalStage && foot?.actualFinalStage && old?.actualFinalStage, 'must capture actual final-stage draws');
      row.hands[side].soleGeometry = { y: hand.soleY, baselineY: foot.soleY, delta: hand.soleY-foot.soleY, legacyBaselineDelta: foot.soleY-old.soleY };
      assert.ok(Math.abs(hand.soleY-foot.soleY) <= report.soleToleranceDevicePixels, `new relative ground movement frame=${frame} side=${side}: ${hand.soleY-foot.soleY}`);
      assert.equal(foot.soleY-old.soleY, 0, `changed original ground movement frame=${frame} side=${side}`);
    }
    assert.notEqual(row.draws, stageDraws.actual, 'frame CTM snapshot must not alias reusable capture');
    assert.ok(Object.isFrozen(row.draws) && row.draws.every(d => Object.isFrozen(d.ctm) && Object.isFrozen(d.drawImageArgs)), 'deep immutable CTM snapshot required');
    report.frames.push(row);
    if (frame % 8 === 0) await new Promise(resolve => setImmediate(resolve));
    if (frame % 32 === 0 || frame === 509) report.resourceSamples.push({ frame, ...process.memoryUsage(),
      qaTraceLengths: Object.fromEntries(modes.map(mode => [mode, fixture.traces[mode].length])),
      productionCacheStats: structuredClone(fixture.artists.actual.cacheStats()) });
    // Store representative actual and per-source-omission final stages only.
    if ([0, 128, 159, 255, 384, 509].includes(frame)) for (const mode of modes)
      fs.writeFileSync(dir + `${mode}-frame${frame}.png`, harnesses[mode].body.toBuffer('image/png'));
  }
  // updateActionPlayback in controller.mjs clears currentEgg at the deadline.
  // The gallery harness is renderer-only; apply that external state transition
  // explicitly instead of falsely expecting the renderer to expire the record.
  for (const mode of modes) harnesses[mode].updateState({ currentEgg: null });
  for (const now of [8500, 8600, 9000]) {
    const fresh = {};
    for (const mode of modes) {
      fixture.traces[mode].length = 0;
      harnesses[mode].draw(now);
      fresh[mode] = fixture.traces[mode].at(-1) || null;
    }
    const art = fresh.actual;
    const present = art?.sourceContactPose === 'workout-front-support-v4'
      || art?.contact?.tools?.some(t => t.key.startsWith('workout-front-support-v4'));
    const actual = pixels(harnesses.actual.body);
    const sourceDiffs = {};
    for (const mode of ['omitLeft', 'omitRight']) {
      const control = pixels(harnesses[mode].body); let changedPixels = 0;
      for (let i = 0; i < actual.length; i += 4)
        if ([0, 1, 2, 3].some(c => actual[i + c] !== control[i + c])) changedPixels++;
      sourceDiffs[mode] = changedPixels;
      if (changedPixels) report.failures.push({ now, mode, reason: 'source pixels remain after controller expiry', changedPixels });
    }
    report.exits.push({ now, controllerTransition: 'currentEgg=null at deadline',
      resolveCalls: fixture.traces.actual.length, sourceMetadataPresent: Boolean(present), sourceDiffs });
    if (present) report.failures.push({ now, reason: 'fresh workout source metadata retained after controller expiry' });
  }
  report.ground = Object.fromEntries(['left', 'right'].map(side => {
    const values = report.frames.map(r => r.hands[side].bottomBoundaryExclusive);
    return [side, { minimum: Math.min(...values), maximum: Math.max(...values), uniqueBoundaries: [...new Set(values)] }];
  }));
  report.groundScope = 'Absolute stage ground may move under existing renderer snap/expression transform. Acceptance requires exact same-frame source sole versus unchanged original foot CTM; the existing boot 0.8-scale float32 path allows at most 0.0001 device px with exact zero new-versus-legacy boot delta. Pixel positive-alpha and majority-alpha boundaries remain separately disclosed.';

} finally {
  fs.writeFileSync(dir + 'report.json', JSON.stringify(report, null, 2));
  for (const h of Object.values(harnesses)) h.dispose();
  for (const a of Object.values(fixture.artists)) a.dispose();
}
assert.equal(report.failures.length, 0, JSON.stringify(report.failures.slice(0, 12)));
console.log(JSON.stringify({ frames: report.frames.length, ground: report.ground, exits: report.exits, failures: report.failures }, null, 2));
