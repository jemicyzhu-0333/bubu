'use strict';

const rgb = hex => /^#[a-f\d]{6}$/i.test(hex || '') ? [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) : [247, 118, 142];
const clamp = n => Math.max(0, Math.min(255, Math.round(n)));
function hsl(red, green, blue) {
  const r = red / 255, g = green / 255, b = blue / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, l = (max + min) / 2;
  let h = 0;
  if (d) h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) / 6 : max === g ? ((b - r) / d + 2) / 6 : ((r - g) / d + 4) / 6;
  return [h, d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1)), l];
}
function fromHsl(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s, a = h * 6, x = c * (1 - Math.abs(a % 2 - 1)), m = l - c / 2;
  const base = a < 1 ? [c, x, 0] : a < 2 ? [x, c, 0] : a < 3 ? [0, c, x] : a < 4 ? [0, x, c] : a < 5 ? [x, 0, c] : [c, 0, x];
  return base.map(n => clamp((n + m) * 255));
}
const baseBody = hsl(...rgb('#f7768e'));

// Recolor only the pink material and dark contour. Keep source texture,
// transparent alpha, warm highlights and white eye glints, never recolor
// an entire PNG with a solid multiply layer that crushes its light values.
function recolorRasterPixels(data, palette, mode = 'body') {
  const target = hsl(...rgb(palette?.[2])), ink = rgb(palette?.[mode === 'eye' ? 4 : 1] || '#1a1b26');
  for (let i = 0; i < data.length; i += 4) {
    if (!data[i + 3]) continue;
    const source = [data[i], data[i + 1], data[i + 2]], [h, s, l] = hsl(...source);
    let color = null;
    if (l < .22) color = ink.map((n, k) => clamp(n + source[k] - [26, 27, 38][k]));
    else if ((h > .89 || h < .045) && s > .13) {
      const light = Math.max(.08, Math.min(.97, l + target[2] - baseBody[2]));
      color = fromHsl(target[0], Math.min(1, s * target[1] / baseBody[1]), light);
    }
    if (color) { data[i] = color[0]; data[i + 1] = color[1]; data[i + 2] = color[2]; }
  }
  return data;
}

export { recolorRasterPixels };
