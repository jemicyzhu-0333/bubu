import { createHash } from 'node:crypto';

export function framePixels(canvas) {
  const { width, height } = canvas;
  const image = canvas.getContext('2d').getImageData(0, 0, width, height);
  let occupied = 0, edge = 0, left = width, right = -1, top = height, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (image.data[(y * width + x) * 4 + 3] < 16) continue;
    occupied++; if (x < 2 || y < 2 || x >= width - 2 || y >= height - 2) edge++;
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  return { hash: createHash('sha256').update(image.data).digest('hex'), occupied, edge,
    bounds: { left, top, right, bottom }, image };
}

export function traceDraw(harness, at, backend) {
  const context = harness.body.getContext('2d'), original = context.drawImage, calls = [];
  context.drawImage = function(image, ...rect) {
    const m = this.getTransform();
    const src = typeof image.src === 'string' ? image.src.split('?')[0] : null;
    calls.push({ image, src, rect, matrix: [m.a, m.b, m.c, m.d, m.e, m.f],
      alpha: this.globalAlpha, smoothing: this.imageSmoothingEnabled });
    return original.call(this, image, ...rect);
  };
  let result;
  try { result = harness.draw(at); } finally { context.drawImage = original; }
  const categories = {
    face: call => /\/(eye[^/]*|mouth[^/]*)\.png$/.test(call.src || ''),
    props: call => /\/(tools|effects)\//.test(call.src || ''),
    clothFront: call => /\/wardrobe\/scarf-.*-front\.png$/.test(call.src || ''),
    clothBack: call => /\/wardrobe\/scarf-.*-back\.png$/.test(call.src || ''),
    hands: call => /\/parts\/(hand-left|hand-right|arm)\.png$/.test(call.src || '')
  };
  const layers = {};
  for (const [key, select] of Object.entries(categories)) {
    const canvas = backend.createCanvas(harness.body.width, harness.body.height), ctx = canvas.getContext('2d');
    const selected = calls.filter(select);
    for (const call of selected) {
      ctx.setTransform(...call.matrix); ctx.globalAlpha = call.alpha;
      ctx.imageSmoothingEnabled = call.smoothing; ctx.drawImage(call.image, ...call.rect);
    }
    layers[key] = { pixels: ctx.getImageData(0, 0, canvas.width, canvas.height).data, calls: selected.length, canvas };
  }
  const counts = { facePixels: 0, propPixels: 0, clothFrontPixels: 0, clothBackPixels: 0, handPixels: 0,
    facePropOverlap: 0, faceClothOverlap: 0, faceHandOverlap: 0, clothPropOverlap: 0, clothHandOverlap: 0 };
  for (let i = 3; i < layers.face.pixels.length; i += 4) {
    const f = layers.face.pixels[i] >= 16, p = layers.props.pixels[i] >= 16;
    const c = layers.clothFront.pixels[i] >= 16, b = layers.clothBack.pixels[i] >= 16, h = layers.hands.pixels[i] >= 16;
    counts.facePixels += f; counts.propPixels += p; counts.clothFrontPixels += c; counts.clothBackPixels += b; counts.handPixels += h;
    counts.facePropOverlap += f && p; counts.faceClothOverlap += f && c;
    counts.faceHandOverlap += f && h; counts.clothPropOverlap += c && p; counts.clothHandOverlap += c && h;
  }
  return { result, counts, layers, calls: calls.map(({image, ...call}) => call) };
}

export function sampleTimes(duration, story, expressionPhrase, fps) {
  const main = Array.from({ length: Math.ceil(duration / 1000 * fps) + 1 }, (_, i) => Math.min(duration, i / fps * 1000));
  const diagnostic = new Set(), boundaries = [], keyframes = [];
  const add = value => diagnostic.add(Math.round(Math.max(0, Math.min(duration, value)) * 1000) / 1000);
  if (story) {
    let start = 0;
    for (const [index, beat] of story.stages.entries()) {
      const end = beat.until * duration, width = end - start;
      for (let i = 0; i <= 16 * beat.cycles; i++) add(start + width * i / (16 * beat.cycles));
      keyframes.push(start + width * .45);
      if (index) {
        boundaries.push({ at: start, previous: story.stages[index - 1].label, next: beat.label });
        for (const delta of [-241, -220, -16.667, -1, 0, 1, 16.667, 220, 240, 241]) add(start + delta);
      }
      start = end;
    }
  } else {
    for (let i = 0; i <= 64; i++) add(duration * i / 64);
    keyframes.push(...[.02, .16, .34, .53, .74, .94].map(p => duration * p));
    if (expressionPhrase) for (let offset = 0; offset < duration; offset += expressionPhrase) {
      for (const fraction of [0, .28, .68, 1]) {
        const at = offset + expressionPhrase * fraction;
        if (at > duration) continue;
        boundaries.push({ at, expressionFraction: fraction });
        for (const delta of [-1, 0, 1]) add(at + delta);
      }
    }
  }
  for (const at of [0, duration - 1, duration, duration + 1]) add(at);
  for (const at of keyframes) add(at);
  return { times: [...new Set([...main, ...diagnostic])].sort((a, b) => a - b), diagnostic, boundaries, keyframes };
}
