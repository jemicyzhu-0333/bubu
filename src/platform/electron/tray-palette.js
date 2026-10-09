'use strict';

const clamp = value => Math.max(0, Math.min(255, Math.round(value)));
function rgb(hex) {
  if (typeof hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(hex)) {
    throw new TypeError('tray icon palette colors must use six-digit hex values');
  }
  return [1, 3, 5].map(index => Number.parseInt(hex.slice(index, index + 2), 16));
}
function hsl(red, green, blue) {
  const r = red / 255, g = green / 255, b = blue / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min, light = (max + min) / 2;
  let hue = 0;
  if (delta) hue = max === r ? ((g - b) / delta + (g < b ? 6 : 0)) / 6
    : max === g ? ((b - r) / delta + 2) / 6 : ((r - g) / delta + 4) / 6;
  return [hue, delta === 0 ? 0 : delta / (1 - Math.abs(2 * light - 1)), light];
}
function fromHsl(hue, saturation, light) {
  const c = (1 - Math.abs(2 * light - 1)) * saturation, a = hue * 6;
  const x = c * (1 - Math.abs(a % 2 - 1)), m = light - c / 2;
  const base = a < 1 ? [c, x, 0] : a < 2 ? [x, c, 0] : a < 3 ? [0, c, x]
    : a < 4 ? [0, x, c] : a < 5 ? [x, 0, c] : [c, 0, x];
  return base.map(value => clamp((value + m) * 255));
}
const BASE_BODY = hsl(...rgb('#f7768e'));

function parsePalette(palette) {
  if (!palette || typeof palette !== 'object') throw new TypeError('tray icon palette is required');
  const colors = Object.fromEntries(Object.entries(palette).map(([code, color]) => [code, rgb(color)]));
  for (const code of [1, 2, 3, 4]) {
    if (!colors[code]) throw new TypeError(`tray icon palette is missing color ${code}`);
  }
  return colors;
}

// Same material/contour strategy as the production raster painter, adapted at
// the platform boundary. Preserve alpha, source texture and white eye glints.
// Existing tray palette slots remain 1=outline, 2=body, 3=mouth/celebration accent, 4=ordinary eyes.
function recolorPixels(data, colors, mode) {
  const target = hsl(...colors[2]);
  const ink = colors[mode === 'eye' ? 4 : ['mouth', 'accent'].includes(mode) ? 3 : 1];
  for (let i = 0; i < data.length; i += 4) {
    if (!data[i + 3]) continue;
    const source = [data[i], data[i + 1], data[i + 2]], [hue, saturation, light] = hsl(...source);
    let color;
    // At 1x the tiny mouth's dark pixels blend with its pink source fringe.
    // Keep that sampled ink on slot 3 instead of silently treating it as body.
    if (mode === 'mouth' && light < .4) color = ink;
    else if (light < .22) color = ink.map((value, channel) => clamp(value + source[channel] - [26, 27, 38][channel]));
    else if ((hue > .89 || hue < .045) && saturation > .13) {
      const nextLight = Math.max(.08, Math.min(.97, light + target[2] - BASE_BODY[2]));
      color = fromHsl(target[0], Math.min(1, saturation * target[1] / BASE_BODY[1]), nextLight);
    }
    if (color) [data[i], data[i + 1], data[i + 2]] = color;
  }
  return data;
}

module.exports = { parsePalette, recolorPixels };
