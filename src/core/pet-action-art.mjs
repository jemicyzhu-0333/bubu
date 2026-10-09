'use strict';

import petAnatomyArt from './pet-anatomy-art.mjs';
import { actionViewX } from './pet-action-view.mjs';
import { sampleActionContact } from './pet-action-contact.mjs';
import { drawContactTools } from './pet-action-tools.mjs';
import { sessionBodyTranslation } from './pet-session-motion.mjs';

const petActionArtApi = (() => {
// 特殊动作的共享绘制层。所有坐标都以 66×66 的参考身体为单位，再按实际
// bodySize 统一缩放；画布 bleed 只负责留白，不再参与动作大小计算。
// 生产 renderer 与离屏取帧共同调用这里，避免“截图正常、端侧仍是旧尺寸”。

const REFERENCE_BODY_SIZE = 66;

function actionUnit(bodySize) {
  const resolved = Number(bodySize);
  if (!Number.isFinite(resolved) || resolved <= 0) throw new RangeError('bodySize must be positive');
  return resolved / REFERENCE_BODY_SIZE;
}

function petActionBodyOffset(action, progress, options = {}) {
  if (!action || options.calmVisual) return Object.freeze({ x: 0, y: 0 });
  const unit = actionUnit(options.bodySize || REFERENCE_BODY_SIZE);
  const facing = options.facing === -1 ? -1 : 1;
  const phase = progress * Math.PI * 2;
  let x = 0;
  let y = 0;
  if (action.motion === 'pushup') y += Math.abs(Math.sin(phase * 4)) * 5;
  else if (action.motion === 'juggle') y -= 4;
  else if (action.motion === 'fall') y += 20 * Math.min(1, Math.min(progress, 1 - progress) / 0.3);
  else if (action.motion === 'breathe') y += 2;
  else if (action.motion === 'stretch') y -= Math.round(Math.abs(Math.sin(phase)) * 5);
  else if (action.motion === 'recoil' || action.motion === 'hiccup') {
    const rise = Math.max(0, (Math.sin(phase * 4) - .65) / .35);
    y -= (rise * rise * (3 - 2 * rise)) * 6;
  } else if (action.motion === 'squish') x += facing * 8;
  else if (action.motion === 'high-five') y -= Math.sin(progress * Math.PI) * 6;
  else if (action.motion === 'dance') {
    x += Math.sin(phase) * 4;
    y -= Math.abs(Math.sin(phase)) * 3;
  } else if (['hop', 'reach', 'umbrella'].includes(action.motion)) y -= Math.abs(Math.sin(phase * 2)) * 8;
  else if (action.motion === 'moonwalk') x += Math.sin(phase * 2) * 7;
  else if (action.motion === 'dash') x += Math.sin(phase * 3) * 9;
  return Object.freeze({ x: x * unit, y: y * unit });
}

function petActionApplyBodyTransform(context, action, progress, options = {}) {
  if (!context || !action || options.calmVisual) return;
  const size = Number(options.size) || REFERENCE_BODY_SIZE;
  const unit = actionUnit(options.bodySize || REFERENCE_BODY_SIZE);
  if (typeof options.translate !== 'function') {
    throw new TypeError('a device-pixel-snapped translate function is required');
  }
  const translate = options.translate;
  const phase = progress * Math.PI * 2;
  if (action.state === 'focused' || action.state === 'resting') {
    const offset = sessionBodyTranslation(action, progress);
    translate(offset.x * unit, offset.y * unit);
    return;
  }
  const center = size / 2;
  translate(center, center);
  if (action.motion === 'spin') context.rotate(phase * 2);
  else if (action.motion === 'dance') context.rotate(Math.sin(phase) * 0.12);
  else if (action.motion === 'high-five') context.rotate(-Math.sin(progress * Math.PI) * 0.07);
  else if (action.motion === 'sway') context.rotate(Math.sin(phase * 3) * 0.12);
  else if (action.motion === 'umbrella') context.rotate(Math.sin(phase * 2) * 0.035);
  // The held mirror lives in body space, including its bounded reflection.
  else if (action.motion === 'mirror') translate(0, Math.sin(phase * 2) * unit);
  else if (action.motion === 'look') translate(Math.sin(phase * 2) * 4 * unit, 0);
  else if (action.motion === 'wag') context.rotate(Math.sin(phase * 5) * 0.05);
  else if (action.motion === 'breathe') {
    const breath = 1 + Math.sin(phase * 2) * 0.035;
    context.scale(breath, 1 / breath);
  } else if (action.motion === 'hide') {
    context.scale(1, 0.75 + Math.abs(Math.sin(phase)) * 0.25);
  } else if (['type', 'read', 'write', 'browse', 'trade', 'organize', 'knit', 'build', 'picnic', 'cook'].includes(action.motion)) {
    context.rotate(Math.sin(phase * 2) * 0.025);
    translate(0, 3 * unit);
  } else if (action.motion === 'doze') {
    context.rotate(-0.07);
    translate(0, (5 + Math.sin(phase) * 1.5) * unit);
  } else if (action.motion === 'daydream') {
    translate(Math.sin(phase) * 1.5 * unit, Math.cos(phase) * 1.5 * unit);
  } else if (['box', 'drum', 'sweep'].includes(action.motion)) {
    context.rotate(Math.sin(phase * 4) * 0.075);
  } else if (action.motion === 'magic') {
    const scale = 0.96 + Math.abs(Math.sin(phase * 2)) * 0.08;
    context.scale(scale, scale);
  } else if (!['hop', 'reach', 'hiccup', 'recoil'].includes(action.motion)) {
    // These actions already own their jump in bodyOffset. A second bob
    // pushes the full outfit beyond the stage and muddies the landing.
    translate(0, Math.sin(phase * 2) * 2 * unit);
  }
  translate(-center, -center);
}

function petActionDrawDetails(context, action, progress, palette, options = {}) {
  if (!context || !action || !palette) return;
  if (options.calmVisual) progress = action.staticProgress ?? .5;
  const unit = actionUnit(options.bodySize || REFERENCE_BODY_SIZE);
  const offX = Number(options.offX) || 0;
  const offY = Number(options.offY) || 0;
  const theme = options.theme || null;
  const layer = options.layer || 'all';
  const drawBack = layer === 'all' || layer === 'back';
  const drawFront = layer === 'all' || layer === 'front';
  const phase = progress * Math.PI * 2;
  const outline = palette[1];
  const body = palette[2];
  const accent = theme ? theme.accent : '#e0af68';
  const accent2 = theme ? theme.primary : '#7dcfff';
  const handLift = Math.round(Math.sin(phase * 4) * 4);
  const highFiveReach = Math.round(Math.sin(progress * Math.PI) * 5);
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };

  const contact = sampleActionContact(action, progress, options.view || 'front', options);
  const anatomyLayer = layer === 'all' ? 'all' : layer;
  const anatomyPoses = petAnatomyArt.armPoses(action, progress, options.view || 'front');
  for (const pose of anatomyPoses) {
    if (anatomyLayer !== 'all' && pose.layer !== anatomyLayer) continue;
    for (const [x, y] of pose.points) {
      bounds.minX = Math.min(bounds.minX, offX + (x - 4) * unit);
      bounds.minY = Math.min(bounds.minY, offY + (y - 8) * unit);
      bounds.maxX = Math.max(bounds.maxX, offX + (x + 8) * unit);
      bounds.maxY = Math.max(bounds.maxY, offY + (y + 8) * unit);
    }
  }

  context.save();
  context.translate(offX, offY);
  context.scale(unit, unit);
  petAnatomyArt.drawAnatomyLayer(context, action, progress, palette, {
    layer: anatomyLayer,
    bodySize: REFERENCE_BODY_SIZE,
    view: options.view || 'front'
  });
  const petRect = (color, x, y, width, height) => {
    const left = actionViewX(x, options.view);
    const right = actionViewX(x + width, options.view);
    const rectX = Math.round(Math.min(left, right));
    const rectY = Math.round(y);
    const rectWidth = Math.max(1, Math.round(Math.max(left, right)) - rectX);
    const rectHeight = Math.max(1, Math.round(height));
    context.fillStyle = color;
    context.fillRect(rectX, rectY, rectWidth, rectHeight);
    bounds.minX = Math.min(bounds.minX, offX + rectX * unit);
    bounds.minY = Math.min(bounds.minY, offY + rectY * unit);
    bounds.maxX = Math.max(bounds.maxX, offX + (rectX + rectWidth) * unit);
    bounds.maxY = Math.max(bounds.maxY, offY + (rectY + rectHeight) * unit);
  };
  const pixelPath = (color, points, thickness) => {
    const radius = Math.floor(thickness / 2);
    for (let index = 0; index < points.length - 1; index += 1) {
      let [x0, y0] = points[index].map(Math.round);
      const [x1, y1] = points[index + 1].map(Math.round);
      const dx = Math.abs(x1 - x0);
      const sx = x0 < x1 ? 1 : -1;
      const dy = -Math.abs(y1 - y0);
      const sy = y0 < y1 ? 1 : -1;
      let error = dx + dy;
      while (true) {
        petRect(color, x0 - radius, y0 - radius, thickness, thickness);
        if (x0 === x1 && y0 === y1) break;
        const twice = error * 2;
        if (twice >= dy) { error += dy; x0 += sx; }
        if (twice <= dx) { error += dx; y0 += sy; }
      }
    }
  };
  const pixelStar = (x, y, color) => {
    petRect(outline, x + 4, y, 3, 11);
    petRect(outline, x, y + 4, 11, 3);
    petRect(color, x + 5, y + 1, 1, 9);
    petRect(color, x + 1, y + 5, 9, 1);
    petRect('#ffffff', x + 5, y + 5, 1, 1);
  };
  const pixelNote = (x, y, color) => {
    petRect(outline, x, y, 10, 4);
    petRect(color, x + 1, y + 1, 7, 2);
    petRect(outline, x + 6, y + 1, 4, 14);
    petRect(color, x + 7, y + 2, 2, 11);
    petRect(outline, x + 1, y + 11, 8, 6);
    petRect(color, x + 2, y + 12, 5, 4);
  };

  const prop = contact && action.prop !== 'picnic' ? null : action.prop;
  context.save();
  context.globalAlpha *= Number.isFinite(action.propOpacity) ? action.propOpacity : 1;
  if (drawBack) {
    if (prop === 'hole') {
      petRect('rgba(18,18,28,0.8)', 4, 60, 58, 6); petRect('#414868', 12, 58, 42, 3);
    } else if (prop === 'treasure') {
      petRect('#8a5a2a', 5, 59, 55, 5); petRect('#5f432d', 13, 57, 39, 3);
    } else if (prop === 'cushion') {
      petRect(outline, 10, 57, 48, 9); petRect('#bb9af7', 12, 58, 44, 6); petRect('#7a5ed6', 17, 63, 34, 3);
    } else if (prop === 'pillow') {
      petRect(outline, 4, 55, 59, 12); petRect('#7a5ed6', 6, 57, 55, 10); petRect('#bb9af7', 10, 55, 47, 8);
    } else if (prop === 'tail') {
      // 从后腰长出的松软尾巴：根部埋进身体（身体贴图随后覆盖，接缝隐形），
      // 向后上方画一条平滑上扬的弧线，末梢收一小撮蓬松圆头，不再是突兀的深色方块。
      const swing = Math.round(Math.sin(phase * 2) * 6);
      const rise = Math.round(Math.abs(Math.sin(phase * 2)) * 3);
      const path = [
        [50, 52], [60, 55], [70, 51],
        [77, 43 - rise],
        [79 + Math.round(swing * 0.5), 34 - rise],
        [74 + swing, 27 - rise]
      ];
      // 三段重叠、逐段收细的双层描边：根 12/8 → 中 9/5 → 梢 7/3，接点重叠不留台阶。
      pixelPath(outline, path.slice(0, 3), 12);
      pixelPath(body, path.slice(0, 3), 8);
      pixelPath(outline, path.slice(2, 5), 9);
      pixelPath(body, path.slice(2, 5), 5);
      pixelPath(outline, path.slice(4), 7);
      pixelPath(body, path.slice(4), 3);
      // 圆润绒球尾梢：比尾颈略宽的同色鼓包，不放深色方核（否则读成旗子/火柴）。
      const tip = path[path.length - 1];
      petRect(outline, tip[0] - 1, tip[1] - 4, 6, 2);
      petRect(outline, tip[0] - 3, tip[1] - 2, 10, 6);
      petRect(outline, tip[0] - 1, tip[1] + 4, 6, 2);
      petRect(body, tip[0] - 1, tip[1] - 2, 6, 6);
      petRect(body, tip[0] - 2, tip[1], 8, 2);
    } else if (prop === 'umbrella') {
      // 伞柄先画在身体后方；手掌在 front layer 压住握持点，避免柄从脸部穿过。
      pixelPath(outline, [[70, -20], [70, 43], [76, 49], [82, 45]], 4);
      pixelPath(accent2, [[70, -19], [70, 42], [76, 47], [81, 45]], 2);
      // 伞面偏到持伞侧，避免居中贴在头顶后被误读成帽子。
      petRect(outline, 66, -16, 8, 3); petRect(outline, 58, -13, 24, 3);
      petRect(outline, 51, -10, 38, 3); petRect(outline, 45, -7, 50, 11);
      petRect('#f7768e', 67, -14, 6, 3); petRect('#f7768e', 59, -11, 22, 3);
      petRect('#f7768e', 52, -8, 36, 3); petRect('#f7768e', 47, -5, 46, 7);
      petRect('#ff9db0', 60, -5, 9, 7); petRect('#ff9db0', 79, -5, 9, 7);
      for (const x of [46, 58, 70, 82]) petRect(outline, x, 2, 7, 3);
    } else if (prop === 'picnic') {
      petRect(outline, 0, 55, 68, 12); petRect('#f7768e', 1, 56, 66, 10);
      for (let x = 3; x < 65; x += 12) petRect('#ffffff', x, 56, 5, 5);
    }
  }

  if (drawFront) {
    if (prop === 'headband') {
      petRect(outline, 8, 8, 50, 2); petRect('#f7768e', 8, 10, 50, 4);
      petRect('#f7768e', 56, 7, 10, 3); petRect('#dc5069', 61, 10, 5, 3);
    } else if (prop === 'butterfly') {
      const flap = Math.round(Math.sin(phase * 6) * 3);
      petRect(outline, 60 + flap, 7, 7, 10); petRect(outline, 67 - flap, 7, 7, 10);
      petRect('#f7768e', 61 + flap, 8, 5, 8); petRect('#e0af68', 68 - flap, 8, 5, 8); petRect(outline, 66, 10, 2, 6);
    } else if (prop === 'balls') {
      for (let i = 0; i < 3; i++) {
        const ballT = (progress * 3 + i / 3) % 1;
        // Both ends meet the palms; a smooth arc connects throw and catch.
        const angle = ballT * Math.PI * 2;
        const x = -3 + 72 * (.5 - .5 * Math.cos(angle));
        const y = 20 - Math.abs(Math.sin(angle)) * 35;
        petRect(outline, x - 1, y - 1, 7, 7); petRect(['#f7768e', '#e0af68', '#7dcfff'][i], x, y, 5, 5);
      }
    } else if (prop === 'treasure' && progress >= 0.68) {
      petRect(outline, 19, 44, 32, 20); petRect('#e0af68', 21, 49, 28, 13);
      petRect('#c07f26', 21, 46, 28, 5); petRect(outline, 33, 52, 4, 5);
    } else if (prop === 'energy') {
      // 高对比折线闪电由双层像素路径构成，避免细长矩形被读成领带。
      pixelPath(outline, [[37, 44], [30, 51], [36, 52], [30, 61]], 7);
      pixelPath(accent, [[37, 44], [30, 51], [36, 52], [30, 61]], 3);
      petRect(accent2, 22, 46 + Math.round(handLift / 3), 3, 3);
      petRect(accent2, 43, 48 - Math.round(handLift / 3), 3, 3);
    } else if (prop === 'star') {
      pixelStar(52, 7, accent);
    } else if (prop === 'ellipsis') {
      petRect('#c0caf5', 50, 8, 3, 3); petRect('#c0caf5', 57, 8, 3, 3); petRect('#c0caf5', 64, 8, 3, 3);
    } else if (prop === 'laser') {
      const laserX = 33 + Math.cos(progress * Math.PI * 6) * 40;
      const laserY = 31 + Math.sin(progress * Math.PI * 4.2) * 24;
      petRect(outline, laserX - 1, laserY - 1, 6, 6); petRect('#ff4d6d', laserX, laserY, 4, 4); petRect('#ffffff', laserX + 1, laserY, 1, 1);
    } else if (prop === 'sleep-cap') {
      petRect('#bb9af7', 14, 10, 32, 5); petRect('#bb9af7', 22, 5, 25, 5);
      petRect('#bb9af7', 31, 0, 18, 5); petRect('#ffffff', 47, -2, 6, 6);
    } else if (prop === 'ai-chat') {
      // Placeholder for the activity mirror's "talking to an AI": a laptop and a speech
      // bubble whose three dots light up in turn. Final art replaces this branch.
      petRect('#30364a', 12, 40, 44, 22); petRect('#7dcfff', 16, 44, 36, 13);
      petRect('#565f89', 8, 62, 52, 4);
      petRect(outline, 54, -6, 28, 16); petRect('#f4efe2', 56, -4, 24, 12); petRect(outline, 56, 10, 4, 4);
      const lit = Math.floor(progress * 9) % 3;
      for (let dot = 0; dot < 3; dot += 1) petRect(dot === lit ? accent : '#a9b1d6', 60 + dot * 7, 0, 4, 4);
    } else if (prop === 'plane') {
      const flight = Math.round(progress * 16);
      const flightY = 36 - Math.round(Math.sin(progress * Math.PI) * 14);
      const planeX = 58 + flight;
      // 五级连续阶梯构成向右的实心纸飞机，再以像素路径勾出机首与折纸中线。
      petRect('#eef5ff', planeX, flightY - 6, 4, 3);
      petRect('#eef5ff', planeX, flightY - 3, 10, 3);
      petRect('#eef5ff', planeX, flightY, 19, 3);
      petRect('#eef5ff', planeX + 4, flightY + 3, 13, 3);
      petRect('#eef5ff', planeX + 8, flightY + 6, 7, 3);
      pixelPath(outline, [
        [planeX, flightY - 6],
        [planeX + 18, flightY + 1],
        [planeX + 9, flightY + 8]
      ], 2);
      pixelPath('#c4d4e8', [[planeX + 2, flightY + 1], [planeX + 13, flightY + 5]], 2);
    } else if (prop === 'hat') {
      petRect('#202132', 16, 48, 36, 15); petRect('#bb9af7', 11, 60, 46, 5);
      if (progress > 0.35 && progress < 0.78) pixelStar(29, 35, accent);
    } else if (prop === 'box') {
      petRect('#a06f45', 7, 45, 54, 22); petRect('#c9986a', 7, 43, 54, 5); petRect('#7a512f', 32, 45, 4, 22);
    } else if (prop === 'gloves') {
      // 拳套跟随手臂出拳（与 pet-anatomy-art 的 box 同一 jab 公式），始终套在拳头上。
      const jab = Math.sin(phase * 4);
      const leftPunch = Math.max(0, jab) * 7;
      const rightPunch = Math.max(0, -jab) * 7;
      // 三分之四转身不对手臂做横向重映射（原因见 pet-anatomy-art 的 armPoses 末尾说明），
      // 拳套也就不能单方面压缩，否则会与拳头分家。
      petRect(outline, -13 - leftPunch, 22, 12, 12); petRect('#f7768e', -12 - leftPunch, 23, 10, 10);
      petRect(outline, 67 + rightPunch, 22, 12, 12); petRect('#f7768e', 68 + rightPunch, 23, 10, 10);
    } else if (prop === 'high-five') {
      // 屏幕外伸进来的“伙伴爪子”：跟宠物一样圆乎乎的肉垫手掌，而不是五指人手。
      // 朝向宠物的一侧点三颗趾垫 + 一块掌垫，一眼读作“爪印”。
      const px = 74 - highFiveReach;
      petRect(outline, px + 3, 9, 10, 2);
      petRect(outline, px + 1, 11, 14, 2);
      petRect(outline, px, 13, 16, 10);
      petRect(outline, px + 1, 23, 14, 2);
      petRect(outline, px + 3, 25, 10, 2);
      petRect(accent2, px + 2, 12, 12, 12);
      petRect(accent2, px + 1, 14, 14, 8);
      petRect(outline, px - 3, 17, 5, 7);
      petRect(accent2, px - 2, 18, 4, 5);
      petRect(accent, px + 5, 17, 4, 4);
      petRect(accent, px + 2, 13, 2, 2);
      petRect(accent, px + 2, 17, 2, 2);
      petRect(accent, px + 2, 21, 2, 2);
      if (highFiveReach >= 4) pixelStar(px - 7, 6, accent);
    } else if (prop === 'music-notes') {
      const noteBob = Math.round(Math.sin(phase * 2) * 3);
      pixelNote(-6, 7 + noteBob, accent2);
      pixelNote(65, 3 - noteBob, accent);
    } else if (prop === 'ribbon') {
      const ribbonLift = Math.round(Math.sin(phase * 3) * 4);
      pixelPath('#f7768e', [[57, 18], [67, 12 + ribbonLift], [58, 4], [72, -8 + ribbonLift]], 3);
    }

  }
  context.restore();
  if (contact && (layer === 'all' || layer === contact.layer)) {
    const rawRect = (color, x, y, width, height) => {
      const left = Math.round(x), top = Math.round(y), w = Math.max(1, Math.round(width)), h = Math.max(1, Math.round(height));
      context.fillStyle = color; context.fillRect(left, top, w, h);
      bounds.minX = Math.min(bounds.minX, offX + left * unit);
      bounds.minY = Math.min(bounds.minY, offY + top * unit);
      bounds.maxX = Math.max(bounds.maxX, offX + (left + w) * unit);
      bounds.maxY = Math.max(bounds.maxY, offY + (top + h) * unit);
    };
    // The plant is part of the little scene; changing held equipment must
    // not make its pot disappear between observation and watering beats.
    const persistent = contact.tools.filter(tool => tool.persistent);
    if (persistent.length) drawContactTools(rawRect, { ...contact, tools: persistent, details: [] }, palette);
    context.save();
    context.globalAlpha *= Number.isFinite(action.propOpacity) ? action.propOpacity : 1;
    drawContactTools(rawRect, { ...contact, tools: contact.tools.filter(tool => !tool.persistent) }, palette);
    context.restore();
    petAnatomyArt.drawAnatomyLayer(context, action, progress, palette, {
      layer: anatomyLayer, bodySize: REFERENCE_BODY_SIZE, view: options.view || 'front', handsOnly: true
    });
  }
  context.restore();
  if (!Number.isFinite(bounds.minX)) return null;
  return Object.freeze({ ...bounds });
}

function petActionPaintLayer(surface, action, progress, palette, options = {}) {
  if (!surface || typeof surface.getContext !== 'function') {
    throw new TypeError('surface must provide a 2d context');
  }
  if (!options.stage || !options.layer) throw new TypeError('stage and layer are required');
  const context = surface.getContext('2d');
  context.imageSmoothingEnabled = false;
  context.setTransform(options.stage.deviceScale, 0, 0, options.stage.deviceScale, 0, 0);
  context.clearRect(0, 0, options.stage.artWidth, options.stage.artHeight);
  return petActionDrawDetails(context, action, progress, palette, {
    ...options,
    bodySize: options.stage.bodySize
  });
}

function petActionBlitLayer(context, surface, bounds, stage) {
  if (!context || !surface || !bounds || !stage) return false;
  const minX = Math.max(0, Math.floor(bounds.minX));
  const minY = Math.max(0, Math.floor(bounds.minY));
  const maxX = Math.min(stage.artWidth, Math.ceil(bounds.maxX));
  const maxY = Math.min(stage.artHeight, Math.ceil(bounds.maxY));
  const width = maxX - minX;
  const height = maxY - minY;
  if (width <= 0 || height <= 0) return false;
  context.drawImage(
    surface,
    minX * stage.deviceScale,
    minY * stage.deviceScale,
    width * stage.deviceScale,
    height * stage.deviceScale,
    minX,
    minY,
    width,
    height
  );
  return true;
}

// 只有必须在 220×220 overlay 坐标中绘制的元素放在这里。
// 其余道具已经收回身体坐标，才能与放大后的 pet canvas 一起缩放。
function petActionDrawOverlay(context, action, progress, options = {}) {
  if (!context || !action || options.calmVisual) return;
  const id = action.id;

  if (id === 'hiccup' && Math.floor(progress * 4) % 2 === 0) {
    context.fillStyle = '#bb9af7';
    context.font = 'bold 10px monospace';
    context.fillText('hic!', 145, 85);
  }

  if (id === 'sneeze' && progress > 0.5 && progress < 0.7) {
    context.fillStyle = '#c0caf5';
    context.font = 'bold 12px monospace';
    context.fillText('HATCHOO!', 130, 85);
    const droplets = [[-4, -3], [2, 2], [7, -1], [13, 3], [18, -2]];
    for (const [dx, dy] of droplets) context.fillRect(105 + dx, 100 + dy, 2, 2);
  }
}

return Object.freeze({
  REFERENCE_BODY_SIZE,
  actionUnit,
  bodyOffset: petActionBodyOffset,
  applyBodyTransform: petActionApplyBodyTransform,
  drawActionDetails: petActionDrawDetails,
  paintActionLayer: petActionPaintLayer,
  blitActionLayer: petActionBlitLayer,
  drawActionOverlay: petActionDrawOverlay
});

})();

export default petActionArtApi;
export const REFERENCE_BODY_SIZE = petActionArtApi.REFERENCE_BODY_SIZE;
export const actionUnit = petActionArtApi.actionUnit;
export const bodyOffset = petActionArtApi.bodyOffset;
export const applyBodyTransform = petActionArtApi.applyBodyTransform;
export const drawActionDetails = petActionArtApi.drawActionDetails;
export const paintActionLayer = petActionArtApi.paintActionLayer;
export const blitActionLayer = petActionArtApi.blitActionLayer;
export const drawActionOverlay = petActionArtApi.drawActionOverlay;
