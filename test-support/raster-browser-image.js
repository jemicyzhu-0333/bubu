'use strict';

const fs = require('node:fs');
const { fileURLToPath } = require('node:url');

// Geometry/lifecycle smoke uses actual bundled PNG dimensions and the browser
// Image loading lifecycle. Pixel fidelity is tested separately with injected
// Skia CanvasImageSources through the production artist factory.
class RasterBrowserImage {
  constructor() { this.width = 0; this.height = 0; this.onload = null; this.onerror = null; this._src = ''; }
  get src() { return this._src; }
  set src(value) {
    this._src = value;
    if (!value) return;
    queueMicrotask(() => {
      if (this._src !== value) return;
      try {
        const png = fs.readFileSync(fileURLToPath(value));
        if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('not a PNG');
        this.width = this.naturalWidth = png.readUInt32BE(16);
        this.height = this.naturalHeight = png.readUInt32BE(20);
        this.onload?.();
      } catch (error) { this.onerror?.(error); }
    });
  }
}

module.exports = { RasterBrowserImage };
