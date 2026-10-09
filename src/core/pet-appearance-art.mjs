'use strict';

// 配饰合成层：只负责“把哪一件、按哪个视角、画到哪一层、落在什么位置”。
// 具体像素画在 core/pet-appearance-sprites.mjs，颜色也在那里按“与宿主皮肤拉开”定好。
//
// 三个必须由这一层承担的合成决策：
//   ① parts：一件配饰可以同时在 back 与 front 两层留下部件（披风的下摆在身后、
//      肩布在身前）。旧版一件只能选一层，于是整块落在轮廓内的披风等于没画。
//   ② 让位偏移：头顶是唯一会被多件配饰争抢的位置。帽子在场时把光环/顶饰抬高
//      一整个帽冠，避免“金环叠金冠”的糖霜蛋糕。
//   ③ 四视图直接使用各自编译的原生坐标，不平移或压扁正面来猜侧面。

import { APPEARANCE_COLORS, APPEARANCE_SPRITES, appearanceEffectAnchors } from './pet-appearance-sprites.mjs';

// Every compiled view already has body-space coordinates from the authored
// silhouette. No extra profile shift or nonuniform scaling may be applied.

// 头顶是唯一会被多件配饰争抢的位置，而争抢它的只有“帽类 × 光环”这一对：
// 顶饰（叶片、樱花、月牙）已经改为别在右耳后，不再挤耳间缺口。
// 帽类最高点是天线的 y=-16，因此抬高 16 后薄光环占 y∈[-24,-18]，
// 与帽冠留出 2 像素空隙，也仍在舞台安全区（bleed 40）之内。
const HEADWEAR_GROUP = 'headwear';
const HEAD_AURA_GROUP = 'head-aura';
const HEAD_LIFT = 16;

function resolveItemColors(renderKey, palette, theme) {
  const preset = APPEARANCE_COLORS[renderKey];
  if (preset) {
    return {
      outline: palette[1] || '#1a1b26',
      accent: preset.accent,
      accentDark: preset.accentDark,
      highlight: preset.highlight
    };
  }
  return {
    outline: palette[1] || '#1a1b26',
    accent: (theme && theme.accent) || palette[2] || '#f7768e',
    accentDark: (theme && theme.primaryDark) || palette[3] || '#c53b53',
    highlight: (theme && theme.fg0) || '#fff2b2'
  };
}

// 每件配饰实际画在哪几层：内容声明 parts，缺省退回它的主层。
function partsOf(item) {
  return Array.isArray(item.parts) && item.parts.length ? item.parts : [item.layer];
}

function drawAppearanceEffect(context, renderKey, colors, options) {
  const anchors = appearanceEffectAnchors(renderKey, options.view);
  const elapsed = Number.isFinite(options.elapsedMs) ? options.elapsedMs : 0;
  const wave = options.calmVisual ? 0 : Math.sin(elapsed / 1600 * Math.PI * 2);
  context.save();
  context.globalAlpha = options.calmVisual ? 0.65 : 0.65 + wave * 0.15;
  for (const [index, [x, y]] of anchors.entries()) {
    context.save();
    const matrix = renderKey === 'boots' && options.footwearTransforms?.[index ? 'foot-right' : 'foot-left'];
    if (Array.isArray(matrix) && matrix.length === 6 && matrix.every(Number.isFinite)) context.transform(...matrix);
    context.fillStyle = index % 2 ? colors.accent : colors.highlight;
    context.fillRect(x, Math.round(y + (options.calmVisual ? 0 : wave)), 2, 2);
    context.restore();
  }
  context.restore();
}

function drawAppearanceLayer(context, appearance, palette, options = {}) {
  if (!context || !appearance || !palette) return false;
  const layer = options.layer || 'front';
  const offX = Number(options.offX) || 0;
  const offY = Number(options.offY) || 0;
  const theme = options.theme || null;
  const view = appearance.view || 'front';
  const all = Array.isArray(appearance.items) ? appearance.items : [];
  const items = all.filter(item => partsOf(item).includes(layer));
  if (!items.length) return false;

  // 帽子在场就把光环整体抬起一个帽冠高度。
  const wearsHat = all.some(item => item.exclusiveGroup === HEADWEAR_GROUP);

  context.save();
  context.translate(offX, offY);
  for (const item of items) {
    const sprite = APPEARANCE_SPRITES[item.renderKey];
    if (!sprite) continue;
    const anchor = item.anchor && item.anchor[view] ? item.anchor[view] : { x: 0, y: 0 };
    const lift = wearsHat && item.exclusiveGroup === HEAD_AURA_GROUP ? HEAD_LIFT : 0;
    const colors = resolveItemColors(item.renderKey, palette, theme);
    context.save();
    context.translate(Math.round(anchor.x), Math.round(anchor.y) - lift);
    const painted = sprite(context, colors, { view, part: layer, footwearTransforms: options.footwearTransforms }) !== false;
    // 特效只跟一件配饰的主层走，并且要求本层真的落了笔。否则两部件配饰会把同一组
    // 闪光画两遍（叠出双倍不透明度），而未落笔的层会剩下一组无主的浮点。
    if (painted && item.effect && layer === item.layer) {
      drawAppearanceEffect(context, item.renderKey, colors, { ...options, view });
    }
    context.restore();
  }
  context.restore();
  return true;
}

const petAppearanceArtApi = Object.freeze({ drawAppearanceLayer, HEAD_LIFT });

export default petAppearanceArtApi;
export { drawAppearanceLayer, HEAD_LIFT };
