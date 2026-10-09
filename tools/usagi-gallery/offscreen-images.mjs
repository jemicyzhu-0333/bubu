import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// Real decoded Skia Images implementing the browser loader's narrow lifecycle.
// This diagnostic port never fetches remote URLs or changes production loading.
export function installOffscreenImages(backend) {
  globalThis.Image = class LocalImage extends backend.Image {
    get src() { return this.localSource || ''; }
    set src(value) {
      this.localSource = value;
      if (!value) return;
      try {
        const url = new URL(value);
        if (url.protocol !== 'file:') throw new Error('offscreen artwork must use a local file URL');
        super.src = fs.readFileSync(fileURLToPath(url));
      } catch (error) { queueMicrotask(() => this.onerror?.(error)); }
    }
  };
}
