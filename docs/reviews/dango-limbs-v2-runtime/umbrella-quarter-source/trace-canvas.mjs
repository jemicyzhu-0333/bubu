// Test-only instrumentation of actual Canvas drawImage calls; never alters pixels.
export function createDrawTrace(backend) {
  const tags = new WeakMap(), stages = new WeakMap(), streams = new Map();
  function surface(w, h) {
    const canvas = backend.createCanvas(w, h), ctx = canvas.getContext('2d');
    const draw = ctx.drawImage.bind(ctx), clear = ctx.clearRect.bind(ctx);
    ctx.clearRect = (...args) => { if (args[0] === 0 && args[1] === 0 && args[2] >= canvas.width && args[3] >= canvas.height) tags.delete(canvas); return clear(...args); };
    ctx.drawImage = (image, ...args) => {
      const labels = tags.get(image) || [];
      if (labels.length) tags.set(canvas, [...new Set([...(tags.get(canvas) || []), ...labels])]);
      const mode = stages.get(canvas);
      if (mode) {
        const matrix = ctx.getTransform();
        streams.get(mode).push({ sources: labels, matrix: ['a','b','c','d','e','f'].map(k => matrix[k]),
          draw: args, alpha: ctx.globalAlpha, smoothing: ctx.imageSmoothingEnabled,
          sourceSize: [image.naturalWidth || image.width, image.naturalHeight || image.height] });
      }
      return draw(image, ...args);
    };
    return canvas;
  }
  return {
    surface,
    mark(image, source) { tags.set(image, [source]); return image; },
    register(mode, canvas) { stages.set(canvas, mode); streams.set(mode, []); },
    begin(mode) { streams.set(mode, []); },
    read(mode) { return streams.get(mode) || []; }
  };
}
