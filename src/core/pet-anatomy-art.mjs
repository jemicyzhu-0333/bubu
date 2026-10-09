'use strict';
import { actionViewX } from './pet-action-view.mjs';
import { sampleActionContact } from './pet-action-contact.mjs';
import { BODY_ANCHORS } from '../content/companion/dango-body.mjs';

const petAnatomyApi = (() => {
const REFERENCE_BODY_SIZE = 66;

// 身体轮廓在腰线上下的实际横向跨度。手掌落在这一段里就一定压在躯干上，
// 必须画进 front 层；否则它会被身体贴图整块盖住 —— 那就是“打鼓/看书/打字时
// 只剩一只手”的成因。向外甩出去的手臂仍然画在 back 层，让肩关节藏进轮廓里。
const TORSO_SPAN = Object.freeze({ left: 6, right: 60 });

function armLayerFor(points, side) {
  const [handX] = points.at(-1);
  const acrossTorso = handX >= TORSO_SPAN.left && handX <= TORSO_SPAN.right;
  return side === 'right' || acrossTorso ? 'front' : 'back';
}

function actionUnit(bodySize = REFERENCE_BODY_SIZE) {
  const value = Number(bodySize);
  if (!Number.isFinite(value) || value <= 0) throw new RangeError('bodySize must be positive');
  return value / REFERENCE_BODY_SIZE;
}

function rounded(value) {
  return Math.round(Number(value) || 0);
}

function createPathPainter(context, color, thickness) {
  const radius = Math.floor(thickness / 2);
  return points => {
    for (let index = 0; index < points.length - 1; index += 1) {
      let [x0, y0] = points[index].map(rounded);
      const [x1, y1] = points[index + 1].map(rounded);
      const dx = Math.abs(x1 - x0);
      const sx = x0 < x1 ? 1 : -1;
      const dy = -Math.abs(y1 - y0);
      const sy = y0 < y1 ? 1 : -1;
      let error = dx + dy;
      while (true) {
        context.fillStyle = color;
        context.fillRect(x0 - radius, y0 - radius, thickness, thickness);
        if (x0 === x1 && y0 === y1) break;
        const twice = error * 2;
        if (twice >= dy) { error += dy; x0 += sx; }
        if (twice <= dx) { error += dx; y0 += sy; }
      }
    }
  };
}

function armPoses(action, progress, view = 'front') {
  if (!action || !action.motion) return [];
  const contact = sampleActionContact(action, progress, view);
  if (contact) return contact.hands;
  const phase = progress * Math.PI * 2;
  // 连续摆动子：不取整，交给画笔按整数像素落点。旧版手臂几乎不随 progress 变化
  // （看书/打字/搬运等的手臂全程固定），才“卡卡的”。现在每个动作都有一个连续手势循环。
  const ease = t => { const v = Math.max(0, Math.min(1, t)); return v * v * (3 - 2 * v); };
  const operating = ease(progress / .13) * ease((1 - progress) / .15);
  const tap = Math.sin(phase * 6) * operating;
  const beat = Math.sin(phase * 4) * operating;
  const swing = Math.sin(phase * 2) * operating;
  const rise = Math.sin(progress * Math.PI);
  const highFiveReach = rise * 6;
  const danceLift = Math.sin(phase) * 7 * operating;
  const poses = [];
  const add = (points, style = 'mitten', side = 'both') => {
    const inferredSide = side === 'both' ? (points[0][0] < REFERENCE_BODY_SIZE / 2 ? 'left' : 'right') : side;
    poses.push({ points, style, side: inferredSide, layer: armLayerFor(points, inferredSide) });
  };
  if (action.motion === 'high-five') add([[61, 38], [66, 28 - highFiveReach * 0.5], [70, 20 - highFiveReach]], 'open', 'right');
  else if (action.motion === 'dance') {
    // 双臂上下反相摆动：一只抬高时另一只落下，全程有可见动作。
    add([[5, 38], [1, 32 - danceLift], [-3, 24 - danceLift]], 'open', 'left');
    add([[61, 38], [65, 32 + danceLift], [69, 24 + danceLift]], 'open', 'right');
  } else if (action.motion === 'wave') add([[61, 36], [66, 28], [67 + Math.sin(phase * 4) * 6, 18]], 'open', 'right');
  else if (action.motion === 'stretch') {
    add([[5, 36], [-1, 24], [-2, 11 + swing * 2]], 'open', 'left');
    add([[61, 36], [67, 24], [68, 11 - swing * 2]], 'open', 'right');
  } else if (action.motion === 'reach') add([[61, 36], [66, 25], [61 + Math.sin(phase * 2) * 5, 15 - rise * 4]], 'open', 'right');
  else if (action.motion === 'pushup') {
    // 俯卧撑：手掌撞地，肘部随节奏弯曲，与身体上下同步。
    const bend = Math.abs(Math.sin(phase * 4)) * 4;
    add([[6, 40], [1, 48 + bend], [-4, 55]], 'fist', 'left');
    add([[60, 40], [65, 48 + bend], [70, 55]], 'fist', 'right');
  } else if (action.motion === 'box') {
    // 影子拳击：左右交替出拳（jab>0 左拳，jab<0 右拳）。
    const jab = Math.sin(phase * 4);
    const leftPunch = Math.max(0, jab) * 7;
    const rightPunch = Math.max(0, -jab) * 7;
    add([[5, 35], [-1 - leftPunch * 0.3, 31], [-7 - leftPunch, 28]], 'fist', 'left');
    add([[61, 35], [67 + rightPunch * 0.3, 31], [73 + rightPunch, 28]], 'fist', 'right');
  } else if (action.motion === 'drum') {
    // 双手交替拍鼓（无鼓棒，直接用手拍），一高一低。
    const leftHit = Math.max(0, tap) * 6;
    const rightHit = Math.max(0, -tap) * 6;
    add([[6, 38], [16, 43], [25, 45 + leftHit]]);
    add([[60, 38], [50, 43], [41, 45 + rightHit]]);
  } else if (action.motion === 'sweep') {
    add([[61, 37], [59, 44], [58, 50]], 'mitten', 'right');
    add([[5, 38], [16, 43], [26 + swing * 5, 48]], 'mitten', 'left');
  } else if (action.motion === 'carry') {
    add([[5, 40], [14, 46], [24, 50 + swing * 1.5]]);
    add([[61, 40], [52, 46], [42, 50 + swing * 1.5]]);
  } else if (action.motion === 'water') add([[61, 38], [59, 43], [57, 47 + swing * 2]], 'mitten', 'right');
  else if (action.motion === 'sip') add([[61, 38], [59, 41], [57, 44 + swing * 1]], 'mitten', 'right');
  else if (action.motion === 'knit') {
    // 两只手交替近/远做织针动作。
    add([[5, 39], [17, 44], [28 + beat * 4, 49]]);
    add([[61, 39], [49, 44], [38 - beat * 4, 49]]);
  } else if (action.motion === 'build') add([[61, 39], [57, 47], [54, 53 + Math.sin(phase * 3) * 4]], 'mitten', 'right');
  else if (action.motion === 'picnic') {
    // 一只手周期性把食物送到嘴边。
    const eat = Math.max(0, Math.sin(phase * 2));
    add([[5, 40], [14, 47], [23, 54]]);
    add([[61, 40], [52, 47 - eat * 4], [43, 54 - eat * 10]]);
  } else if (action.motion === 'telescope') add([[61, 37], [57, 31], [53, 28]], 'mitten', 'right');
  else if (action.motion === 'glide' && progress < 0.35) add([[61, 39], [65, 39], [68, 37]], 'open', 'right');
  else if (action.motion === 'float' || action.motion === 'sway') add([[61, 38], [62, 34], [63, 30]], 'open', 'right');
  else if (action.motion === 'umbrella') add([[61, 38], [66, 34], [70, 30]], 'mitten', 'right');
  else if (action.motion === 'juggle') {
    // 双手交替上抛。
    const toss = Math.sin(phase * 3);
    add([[5, 37], [0, 31], [-3, 24 - Math.max(0, toss) * 6]], 'open', 'left');
    add([[61, 37], [66, 31], [69, 24 - Math.max(0, -toss) * 6]], 'open', 'right');
  } else if (action.motion === 'dig') {
    // 刨土：双手交替扎向身前地面的洞口（一只下挖、另一只抬起）；
    // 末段（progress≥0.7）宝箱翻出后收手，让宝箱独自呈现，不与手掌打架。
    if (progress < 0.7) {
      const scoop = Math.sin(phase * 4);
      const leftDig = Math.max(0, scoop) * 6;
      const rightDig = Math.max(0, -scoop) * 6;
      add([[6, 40], [16, 49], [24, 55 + leftDig]], 'mitten', 'left');
      add([[60, 40], [50, 49], [42, 55 + rightDig]], 'mitten', 'right');
    }
  }
  for (const pose of poses) {
    const root = BODY_ANCHORS.front[`shoulder-${pose.side}`];
    pose.points[0] = [root.x, root.y];
  }
  if (view === 'profile') {
    return poses.filter(pose => pose.side === 'right').map(pose => {
      const points = pose.points.map(([x, y]) => [actionViewX(x, view), y]);
      const root = BODY_ANCHORS.profile[`shoulder-${pose.side}`];
      points[0] = [root.x, root.y];
      return { ...pose, points, layer: armLayerFor(points, pose.side) };
    });
  }
  if (view === 'back') return poses.map(pose => {
    const points = pose.points.map(([x, y]) => [66 - x, y]);
    const side = pose.side === 'left' ? 'right' : pose.side === 'right' ? 'left' : pose.side;
    return { ...pose, points, side, layer: armLayerFor(points, side) };
  });
  // three-quarter 故意不重映射手臂。圆身体做 yaw 旋转时轮廓几乎不变（离线 3D 实测宽度比
  // 0.963），转身网格的左缘只比正面内缩一格 = 2 art px，肩根（art x 5–6 / 60–61）本来就压在
  // 身体上。曾经这里按 0.52 把远侧手臂压向中线，那是为了迁就同样错误的“压扁 0.52”身体网格；
  // 身体网格改成手绘定稿后，这个补偿会把手臂整条拽进身体里 —— 肩根埋进躯干中央、手掌落点
  // 进入 TORSO_SPAN 后又被判成 front 层，读作“贴在脸颊上的一块色块”。转身由五官、耳朵和
  // 明暗表达，不由手臂压缩表达；profile / back 才是真的换了轮廓，所以只有它们需要重映射。
  if (view === 'three-quarter') for (const pose of poses) {
    const root = BODY_ANCHORS[view][`shoulder-${pose.side}`];
    pose.points[0] = [root.x, root.y];
  }
  return poses;
}

function drawHand(context, point, colors) {
  const handX = rounded(point[0]);
  const handY = rounded(point[1]);
  const palmX = handX - 4;
  const palmY = handY - 4;
  context.fillStyle = colors.outline;
  context.fillRect(palmX + 2, palmY, 5, 1);
  context.fillRect(palmX + 1, palmY + 1, 7, 1);
  context.fillRect(palmX, palmY + 2, 9, 5);
  context.fillRect(palmX + 1, palmY + 7, 7, 1);
  context.fillRect(palmX + 2, palmY + 8, 5, 1);
  context.fillStyle = colors.body;
  context.fillRect(palmX + 2, palmY + 1, 5, 1);
  context.fillRect(palmX + 1, palmY + 2, 7, 5);
  context.fillRect(palmX + 2, palmY + 7, 5, 1);
  // 掌心高光让手掌在同色躯干前仍读作末端，而不是一块贴上去的色斑。
  context.fillStyle = colors.highlight;
  context.fillRect(palmX + 2, palmY + 3, 3, 2);
}

// 肩关节：倒角的深色块面。旧版用身体同色的 9×9 方块，在躯干上既不可见、
// 在身体背后也不可见，是纯无效绘制；深一度才能把“手臂从哪里长出来”说清楚。
function drawShoulder(context, point, color) {
  const x = rounded(point[0]) - 4;
  const y = rounded(point[1]) - 4;
  context.fillStyle = color;
  context.fillRect(x + 2, y, 5, 1);
  context.fillRect(x, y + 1, 9, 7);
  context.fillRect(x + 2, y + 8, 5, 1);
}

function drawAnatomyLayer(context, action, progress, palette, options = {}) {
  if (!context || !palette || !action) return false;
  const layer = options.layer || 'front';
  const unit = actionUnit(options.bodySize);
  const offX = Number(options.offX) || 0;
  const offY = Number(options.offY) || 0;
  const view = options.view || 'front';
  const poses = armPoses(action, Number.isFinite(progress) ? progress : 0, view);
  const contact = sampleActionContact(action, progress, view);
  if (!poses.length) return false;
  const visible = poses.filter(pose => layer === 'all' || pose.layer === layer);
  if (!visible.length) return false;
  // 手臂用比躯干更深的身体色，手掌用主体色 —— 压在躯干上时才会分层。
  const pathOutline = createPathPainter(context, palette[1], 7);
  const pathBody = createPathPainter(context, palette[3] || palette[2], 5);
  context.save();
  context.translate(offX, offY);
  context.scale(unit, unit);
  for (const pose of visible) {
    if (!options.handsOnly) {
      // With a held object the upper arm is occluded by the round torso.
      // Only the short forearm emerges; long diagonal shoulder outlines
      // across the belly would read as straps instead of anatomy.
      const path = contact && pose.points.at(-1)[0] >= 6 && pose.points.at(-1)[0] <= 60
        ? pose.points.slice(1) : pose.points;
      pathOutline(path);
      pathBody(path);
      if (!contact) drawShoulder(context, pose.points[0], palette[3] || palette[2]);
    }
    drawHand(context, pose.points.at(-1), {
      outline: palette[1], body: palette[2], highlight: palette[3] || palette[2]
    });
  }
  context.restore();
  return true;
}

return Object.freeze({ armPoses, drawAnatomyLayer });
})();

export default petAnatomyApi;
export const armPoses = petAnatomyApi.armPoses;
export const drawAnatomyLayer = petAnatomyApi.drawAnatomyLayer;
