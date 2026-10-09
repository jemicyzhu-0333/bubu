'use strict';

// Bounds-only pet canvas recorder: save/restore tracks the affine matrix, not styles
// or alpha. This deliberately preserves the smoke/sync recorder contract.
function identity() { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; }

function applyPoint(m, x, y) {
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}

// ---------- 记录型 2D 上下文 ----------
// 只实现生产 pet runtime 与画笔用到的能力，并把每次绘制的包围盒换算到设备坐标。
function createRecordingContext(label) {
  const maxRecordedCalls = 20_000;
  let matrix = identity();
  const stack = [];
  const pathPoints = [];
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const calls = [];

  function mark(x, y, source) {
    const point = applyPoint(matrix, x, y);
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      throw new Error(`${label}: ${source} 产生了非有限坐标`);
    }
    if (point.x < box.minX) box.minX = point.x;
    if (point.y < box.minY) box.minY = point.y;
    if (point.x > box.maxX) box.maxX = point.x;
    if (point.y > box.maxY) box.maxY = point.y;
    // The smoke suite advances tens of thousands of frames. Keep enough recent
    // geometry for every assertion without retaining an unbounded render trace
    // across test cases (which can otherwise exhaust small CI workers).
    if (calls.length >= maxRecordedCalls) calls.splice(0, maxRecordedCalls / 2);
    calls.push({ source, x: point.x, y: point.y, matrix: { ...matrix } });
  }

  function markRect(x, y, width, height, source) {
    // 四角都要算：旋转后包围盒由四角决定。
    mark(x, y, source);
    mark(x + width, y, source);
    mark(x, y + height, source);
    mark(x + width, y + height, source);
  }

  const context = {
    canvas: null,
    imageSmoothingEnabled: true,
    globalAlpha: 1,
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    font: '10px monospace',

    save() { stack.push({ ...matrix }); },
    restore() { if (stack.length) matrix = stack.pop(); },
    setTransform(a, b, c, d, e, f) { matrix = { a, b, c, d, e, f }; },
    getTransform() { return { ...matrix }; },
    transform(a, b, c, d, e, f) {
      const m = matrix;
      matrix = { a: m.a*a+m.c*b, b: m.b*a+m.d*b, c: m.a*c+m.c*d,
        d: m.b*c+m.d*d, e: m.a*e+m.c*f+m.e, f: m.b*e+m.d*f+m.f };
    },
    translate(x, y) {
      matrix.e += matrix.a * x + matrix.c * y;
      matrix.f += matrix.b * x + matrix.d * y;
    },
    scale(sx, sy) {
      matrix.a *= sx; matrix.b *= sx;
      matrix.c *= sy; matrix.d *= sy;
    },
    rotate(angle) {
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const { a, b, c, d } = matrix;
      matrix.a = a * cos + c * sin;
      matrix.b = b * cos + d * sin;
      matrix.c = c * cos - a * sin;
      matrix.d = d * cos - b * sin;
    },

    // clearRect 是整幅擦除，不参与包围盒。
    clearRect() {},
    fillRect(x, y, width, height) { markRect(x, y, width, height, 'fillRect'); },
    strokeRect(x, y, width, height) {
      const pad = this.lineWidth / 2;
      markRect(x - pad, y - pad, width + pad * 2, height + pad * 2, 'strokeRect');
    },
    drawImage(image, ...args) {
      if (args.length >= 8) {
        const [, , , , dx, dy, dWidth, dHeight] = args;
        markRect(dx, dy, dWidth, dHeight, 'drawImage');
        return;
      }
      const [dx, dy, dWidth, dHeight] = args;
      const width = dWidth === undefined ? image.width : dWidth;
      const height = dHeight === undefined ? image.height : dHeight;
      markRect(dx, dy, width, height, 'drawImage');
      for (const call of calls.slice(-4)) call.imageSrc = image.src || null;
    },
    fillText(text, x, y) {
      const size = Number.parseFloat(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] || '10');
      // 文本基线在 y 上，向上撑起一个字高，向右撑起估算宽度。
      markRect(x, y - size, String(text).length * size * 0.62, size, 'fillText');
    },

    beginPath() { pathPoints.length = 0; },
    rect() {}, clip() {},
    closePath() {},
    moveTo(x, y) { pathPoints.push([x, y]); mark(x, y, 'moveTo'); },
    lineTo(x, y) { pathPoints.push([x, y]); mark(x, y, 'lineTo'); },
    quadraticCurveTo(cx, cy, x, y) { mark(cx, cy, 'quadraticCurveTo'); mark(x, y, 'quadraticCurveTo'); },
    bezierCurveTo(c1x, c1y, c2x, c2y, x, y) {
      mark(c1x, c1y, 'bezierCurveTo'); mark(c2x, c2y, 'bezierCurveTo'); mark(x, y, 'bezierCurveTo');
    },
    arc(x, y, radius) { markRect(x - radius, y - radius, radius * 2, radius * 2, 'arc'); },
    ellipse(x, y, rx, ry, rotation = 0) {
      const width = Math.hypot(rx * Math.cos(rotation), ry * Math.sin(rotation));
      const height = Math.hypot(rx * Math.sin(rotation), ry * Math.cos(rotation));
      markRect(x - width, y - height, width * 2, height * 2, 'ellipse');
    },
    fill(path) {
      const b=path?.bounds;
      if(b) markRect(b.minX,b.minY,b.maxX-b.minX,b.maxY-b.minY,'Path2D');
    },
    stroke(path) {
      const b=path?.bounds, pad=this.lineWidth/2;
      if(b) markRect(b.minX-pad,b.minY-pad,b.maxX-b.minX+pad*2,b.maxY-b.minY+pad*2,'Path2D');
    },
    createLinearGradient() { return { addColorStop() {} }; },

    // 供断言使用
    _box: box,
    _calls: calls,
    _reset() {
      box.minX = Infinity; box.minY = Infinity; box.maxX = -Infinity; box.maxY = -Infinity;
      calls.length = 0;
    }
  };
  return context;
}

module.exports = { createRecordingContext };
