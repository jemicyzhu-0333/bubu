import { createRenderHarness, canvas } from './runtime-harness.mjs';
import { pixels, difference, summarize } from './pixels.mjs';
const name = item => item.name || item.label || item.id;

function faceEvidence(variant, entry, times, renderOptions) {
  const src = variant.source, form = src.forms.resolvePetForm(variant.skin), stage = src.forms.resolveFormStage(variant.skin, 2);
  const reg = src.expression.createExpressionRegistry(src.expressions.EXPRESSIONS);
  const expressionId = entry.kind === 'expression' ? entry.item.id : entry.item.expression || 'life.idle';
  const faceCanvas = canvas(Math.ceil(stage.bodySize * stage.deviceScale));
  const samples = []; let previous = null;
  for (const at of times) {
    const sampledPose = src.expression.sampleExpressionPose(reg, expressionId, at);
    const pose = { ...sampledPose, face: { ...sampledPose.face } };
    if (renderOptions.calm) {
      const config = reg.get(expressionId);
      pose.face = { ...config.face, ...config.static.face };
    }
    const originalAction = ['action', 'session'].includes(entry.kind) ? entry.item : null;
    const sampled = src.formArt.sampleAction?.(form, originalAction, at / entry.duration, { calmVisual: Boolean(renderOptions.calm) })
      || { action: originalAction, progress: at / entry.duration };
    const action = sampled.action, progress = sampled.progress;
    const viewOptions = { action: originalAction, state: entry.item.state || 'idle' };
    const requestedView = renderOptions.view || 'auto';
    const view = src.formArt.resolveView?.(form, requestedView, viewOptions)
      || (requestedView !== 'auto' ? requestedView : src.appearance.derivePetView(viewOptions));
    const motion = src.forms.resolveFormMotion(form, action);
    const artwork = src.formArt.resolveArtwork(form, { view, motion: action ? motion : 'idle', action,
      face: pose.face, expressionId, expressionElapsedMs: at, progress, elapsedMs: at, channel: `gallery-face:${variant.id}:${entry.item.id}`, calmVisual: Boolean(renderOptions.calm) });
    src.formArt.paintFaceSprite(faceCanvas, { form, palette: src.formArt.paletteForSkin(variant.skin, form),
      face: pose.face, blinking: false, stage, view, artwork });
    const result = pixels(faceCanvas);
    samples.push({ atMs: at, hash: result.hash, occupied: result.occupied, edge: result.edge,
      difference: difference(previous, result.image) }); previous = result.image;
  }
  faceCanvas.width = 1; faceCanvas.height = 1;
  return { ...summarize(samples), samples,
    note: 'Actual face-only painter, fixed canvas, automatic blinking explicitly disabled, no whole-body bob. Gaze from expression loops remains. A single unique frame means no internal visible change at these sample times.' };
}

export function renderStrip(variants, kind, id, settings = {}) {
  const baseOptions = { scene: 'cozy-room', view: 'auto', outfit: true, calm: false, dpr: 2, ...settings };
  const count = Math.max(3, Math.min(16, settings.frames || 9));
  const selectedVariants = variants.filter(v => !settings.variants || settings.variants.includes(v.id));
  const strips = [], metadata = [];
  for (const variant of selectedVariants) {
    const renderOptions = { ...baseOptions, ...(settings.variantOptions?.[variant.id] || {}) };
    const harness = createRenderHarness(variant.source, { ...renderOptions, skin: variant.skin });
    const entry = harness.select(kind, id, renderOptions.scene);
    const times = Array.from({ length: count }, (_, i) => Math.round(entry.duration * .999 * i / (count - 1)));
    const strip = canvas(count * 250, 286), context = strip.getContext('2d');
    context.fillStyle = '#eef3f3'; context.fillRect(0, 0, strip.width, strip.height);
    context.fillStyle = '#263e4a'; context.font = '14px system-ui';
    context.fillText(`${variant.label} · ${id}`, 12, 22);
    let previous = null, cursor = 0; const samples = [], dense = [];
    for (const [index, at] of times.entries()) {
      if (settings.dense) {
        for (; cursor < at; cursor += settings.stepMs || 100) {
          harness.draw(cursor); const p = pixels(harness.body);
          dense.push({ atMs: cursor, hash: p.hash, occupied: p.occupied, edge: p.edge,
            difference: difference(previous, p.image) }); previous = p.image;
        }
      }
      harness.draw(at); cursor = at + (settings.stepMs || 100);
      const p = pixels(harness.body);
      samples.push({ atMs: at, hash: p.hash, occupied: p.occupied, edge: p.edge, bounds: p.bounds,
        difference: difference(previous, p.image), expression: harness.current.item.expression || harness.current.item.id });
      previous = p.image;
      const composite = harness.composite();
      context.drawImage(composite, index * 250 + 15, 34, 220, 220);
      composite.width = 1; composite.height = 1;
      context.fillStyle = '#647885'; context.font = '12px system-ui';
      context.fillText(`${(at / 1000).toFixed(2)}s · ${(at / entry.duration * 100).toFixed(1)}%`, index * 250 + 15, 275);
    }
    const evidence = { kind, id, variant: variant.id, label: name(entry.item), sourceMotion: entry.item.motion || null,
      sourceProp: entry.item.prop || null, durationMs: entry.duration, options: renderOptions,
      summary: summarize(samples), samples, dense: dense.length ? { summary: summarize(dense), samples: dense } : null,
      face: kind === 'interaction' ? { note: 'Interaction face is evaluated in the full production frame above; isolated face sampling omits contextual playback and is intentionally unavailable.' }
        : faceEvidence(variant, entry, times, renderOptions) };
    strips.push({ variant: variant.id, label: variant.label, dataUrl: strip.toDataURL('image/png') }); metadata.push(evidence);
    strip.width = 1; strip.height = 1; harness.dispose();
  }
  return { strips, metadata };
}
