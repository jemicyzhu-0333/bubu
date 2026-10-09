// Canvas geometry proxy only. These bounds mirror the default 220px CSS grid;
// neither this painter nor its assertions execute a browser layout engine.
import { CONTEXT_BADGE_BOUNDS } from '../../src/surfaces/pet/context-emphasis.mjs';

const ACTION_BOUNDS = Object.freeze({ left: 22, top: 169, width: 144, height: 27 });
const FEED_BOUNDS = Object.freeze({ left: 172, top: 169, width: 26, height: 26 });
function panel(ctx, box, color) {
  ctx.fillStyle = color; ctx.beginPath();
  ctx.roundRect(box.left, box.top, box.width, box.height, 7); ctx.fill();
}
function ellipsis(ctx, text, width) {
  if (ctx.measureText(text).width <= width) return text;
  const chars = [...text];
  while (chars.length && ctx.measureText(`${chars.join('')}…`).width > width) chars.pop();
  return `${chars.join('')}…`;
}
function paintFooterProxy(ctx, { label, badge, bubble, speech, stage }) {
  const phrase = speech.visible() && speech.snapshot().source === 'context';
  const text = phrase ? bubble.textContent : badge.classList.contains('show') ? badge.textContent : '';
  const action = stage.classList.contains('session-focused') || stage.classList.contains('session-resting');
  const hidden = stage.classList.contains('menu-open') || stage.classList.contains('is-docked');
  const actionBox = text ? ACTION_BOUNDS : { ...ACTION_BOUNDS, top: 181 };
  const feedBox = text ? FEED_BOUNDS : { ...FEED_BOUNDS, top: 181 };
  const offsetY = actionBox.top - ACTION_BOUNDS.top;
  const boxes = [];
  ctx.save(); ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  if (action && !hidden) {
    panel(ctx, actionBox, 'rgba(23,27,39,.74)');
    ctx.fillStyle = '#c0caf5'; ctx.font = '11px "Review CJK"';
    ctx.fillText(ellipsis(ctx, label.textContent, 106), 30, 182.5 + offsetY);
    ctx.font = '13px "Review CJK"'; ctx.fillText('↻', 146, 182.5 + offsetY);
    boxes.push({ kind: 'action', ...actionBox });
  }
  if (!hidden) {
    panel(ctx, feedBox, 'rgba(26,27,38,.58)');
    ctx.strokeStyle = '#ecebf1'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(179, 180 + offsetY); ctx.lineTo(191, 180 + offsetY); ctx.bezierCurveTo(191, 187 + offsetY, 179, 187 + offsetY, 179, 180 + offsetY); ctx.stroke();
    boxes.push({ kind: 'feed', ...feedBox });
  }
  const box = text && !hidden ? CONTEXT_BADGE_BOUNDS : null;
  let width = 0;
  if (box) {
    ctx.globalAlpha = phrase ? 1 : Number(badge.style.opacity);
    panel(ctx, box, phrase ? '#fbfaf7' : 'rgba(43,43,55,.86)');
    ctx.fillStyle = phrase ? '#26252b' : '#f5f2ed'; ctx.font = '12px "Review CJK"';
    ctx.textAlign = 'center'; width = ctx.measureText(text).width;
    ctx.fillText(text, box.left + box.width / 2, box.top + box.height / 2);
    boxes.push({ kind: phrase ? 'context-speech' : 'context-badge', ...box });
  }
  ctx.restore();
  return { text, box, width, boxes, actionLabel: action ? label.textContent : null };
}

function foregroundIntersections(canvas, boxes, dpr) {
  const { data, width, height } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  return boxes.map(box => {
    let pixels = 0;
    for (let y = Math.max(0, Math.ceil((box.top - 2.5) * dpr)); y < Math.min(height, (box.top + box.height - 2.5) * dpr); y++) {
      for (let x = Math.max(0, Math.ceil((box.left - .5) * dpr)); x < Math.min(width, (box.left + box.width - .5) * dpr); x++) {
        if (data[(y * width + x) * 4 + 3] > 200) pixels++;
      }
    }
    return { kind: box.kind, opaquePixels: pixels };
  });
}
export { ACTION_BOUNDS, FEED_BOUNDS, paintFooterProxy, foregroundIntersections };
