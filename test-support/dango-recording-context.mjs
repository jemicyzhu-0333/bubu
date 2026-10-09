// Raster calls preserve image identity, drawImage operands, affine matrices and
// alpha. Unlike the bounds recorder, save/restore also stacks alpha and an empty
// restore throws. The optional arc/fill stubs belong only to the raster suite.
export function createDangoRecordingContext({ pathDrawing = false } = {}) {
  let matrix = [1, 0, 0, 1, 0, 0];
  const stack = [], calls = [];
  const context = { calls, globalAlpha: 1,
    beginPath() {}, rect() {}, clip() {},
    ...(pathDrawing ? { arc() {}, fill() {} } : {}),
    save() { stack.push({ matrix: [...matrix], alpha: context.globalAlpha }); },
    restore() { const saved = stack.pop(); matrix = saved.matrix; context.globalAlpha = saved.alpha; },
    transform(a, b, c, d, e, f) { const [g, h, i, j, k, l] = matrix;
      matrix = [g * a + i * b, h * a + j * b, g * c + i * d, h * c + j * d, g * e + i * f + k, h * e + j * f + l]; },
    translate(x, y) { context.transform(1, 0, 0, 1, x, y); },
    scale(x, y) { context.transform(x, 0, 0, y, 0, 0); },
    rotate(r) { context.transform(Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0); },
    drawImage(image, ...rect) { calls.push({ image, rect, matrix: [...matrix], alpha: context.globalAlpha }); }
  };
  return context;
}
