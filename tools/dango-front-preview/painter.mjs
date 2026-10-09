import { FRONT_DURATION_MS, FRONT_PHASES, frontPhaseAt } from './driver.mjs';
const paper = '#eef2ed', ink = '#263a3a', muted = '#64726b';
export function label(ctx, text, x, y, size = 15, color = muted) {
  ctx.fillStyle = color;
  ctx.font = `${size}px "Front Review CJK", sans-serif`;
  ctx.fillText(text, x, y);
}
export function registerFont(backend) {
  backend.GlobalFonts.registerFromPath('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', 'Front Review CJK');
}
export function paintVideo(canvas, front, side, outfit, index, at) {
  const ctx = canvas.getContext('2d');
  ctx.resetTransform(); ctx.globalAlpha = 1;
  ctx.fillStyle = paper; ctx.fillRect(0, 0, 930, 600);
  label(ctx, '团子的正面', 24, 39, 28, ink);
  label(ctx, `${index + 1} / 3   ${outfit.label}`, 24, 75, 18, ink);
  label(ctx, '正常速度 · 表情状态与眨眼', 672, 41, 15);
  label(ctx, `${(at / 1000).toFixed(1)} s / 14 s`, 770, 75, 15);
  ctx.fillStyle = '#fff'; ctx.fillRect(16, 100, 650, 404);
  label(ctx, '正面', 37, 133, 22, ink);
  label(ctx, '原显示尺寸', 51, 230, 17, ink);
  label(ctx, '身体设计宽 99 CSS px', 40, 252, 12);
  label(ctx, '2 倍细看', 385, 134, 17, ink);
  label(ctx, '身体设计宽 198 px', 366, 156, 12);
  ctx.drawImage(front, 23, 250, 219, 219);
  ctx.drawImage(front, 258, 103, 438, 438);
  label(ctx, frontPhaseAt(at).label, 40, 480, 20, ink);
  ctx.fillStyle = '#f8faf7'; ctx.fillRect(684, 100, 230, 277);
  label(ctx, '斜面小对照', 701, 133, 17, ink);
  label(ctx, '同一时刻 · 同一套衣服', 701, 155, 12);
  ctx.drawImage(side, 690, 181, 219, 219);
  label(ctx, '原显示尺寸', 741, 357, 12);
  label(ctx, '已有正面素材', 711, 424, 15, ink);
  label(ctx, '已有动作与表情', 711, 451, 15, ink);
  const phase = frontPhaseAt(at);
  for (const item of FRONT_PHASES) {
    const x = 26 + item.start / FRONT_DURATION_MS * 878;
    const w = (item.end - item.start) / FRONT_DURATION_MS * 878;
    ctx.fillStyle = item === phase ? '#618474' : '#cbd8d0';
    ctx.fillRect(x, 526, w - 3, 7);
    label(ctx, item.label, x, 552, 14, item === phase ? ink : muted);
  }
  label(ctx, '实际生产画笔 · 30 fps · 显式表情周期 · 离屏预览', 24, 582, 12);
}
export function paintKeyImage(backend, images, outfits) {
  const canvas = backend.createCanvas(930, 630), ctx = canvas.getContext('2d');
  ctx.fillStyle = paper; ctx.fillRect(0, 0, 930, 630);
  label(ctx, '正面就是这样', 24, 39, 28, ink);
  label(ctx, '同一只团子 · 原有正面素材 · 实际生产画笔', 24, 69, 15);
  for (const [index, body] of images.entries()) {
    const x = index * 310;
    ctx.fillStyle = '#fff'; ctx.fillRect(x + 9, 91, 292, 485);
    label(ctx, outfits[index].label, x + 26, 122, 18, ink);
    label(ctx, '2 倍细看', x + 118, 155, 13);
    ctx.drawImage(body, x - 64, 90, 438, 438);
    label(ctx, '原显示尺寸', x + 110, 414, 13);
    ctx.drawImage(body, x + 45, 386, 219, 219);
    label(ctx, '99 CSS px 身体设计宽', x + 84, 559, 12);
  }
  label(ctx, '大图为 198 px 身体设计宽；衣物不改变显示比例', 24, 611, 13);
  return canvas;
}
