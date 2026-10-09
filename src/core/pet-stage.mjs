'use strict';

// 桌宠像素画的坐标系契约。renderer 只允许从这里取几何，不再各自散落 70/105 这类字面量。
//
// 身体是 33×33 网格、每格 2 个美术像素，也就是 66×66。但四肢、道具和旋转类动作
// 本来就会画到身体外面：pan 手柄伸到身体右缘外 13 px，gloves 伸到左缘外 8 px，
// ribbon 甩到上缘外 12 px，spin/sway 把 66×66 的半对角线（46.7）转出身体外 13.7 px。
// 历史上 canvas 光栅只有 70×70，每边仅剩 2 px 余量，于是这些绘制被画布边缘直接切掉
// —— 这就是“动作行为时出现局部小面积遮挡”的成因。
//
// 因此余量（bleed）在这里成为显式契约并由测试守住：新道具画到多远都不会被裁，
// 但一旦超过契约就在 npm run check 阶段失败，而不是等到肉眼发现缺一只手。

// 分辨率与体积是两个独立旋钮，靠 columns × cell === bodySize 这条不变式解耦：
// columns 决定“能画多细”，bodySize × PET_CSS_PER_ART_PIXEL 决定“屏上多大”。
// 网格曾经是 22×22 / cell 3，同样是 66 美术像素。那个预算下画不出结构化的脸：
// 单眼只有 3×3＝9 格，要让表情可辨就只能把眼睛摊大去抢身体和嘴的地盘，于是
// 眼睛占到身宽 22%、嘴还留在 5×3，比例失衡而细节并没有变多。cell 改成 2 之后
// 格子数变成 2.25 倍，眼睛占比反而降回 18%，可用格子却从 9 涨到 36。
//
// cell 只能取 66 的因数，且 cell × deviceScale 必须是整数（否则格子边缘落在半个
// 设备像素上，透明置顶窗口会显出接缝）。deviceScale 在 Retina 上是 3，所以候选
// 只有 cell ∈ {3, 2, 1} → 22 / 33 / 66 格。cell 1 会让块面感消失，2 是甜点。
const petStageArt = Object.freeze({ columns: 33, rows: 33, cell: 2, bodySize: 66 });

// 每边预留的美术像素。40 覆盖身体位姿、伸展手掌、头部装饰与旋转动作叠加后的
// 真实极值；静态坐标扫描之外，renderer smoke 还会遍历全部动作相位验证最终光栅边界。
// 身体仍保持 66×66，增加的只是透明安全区，所以不会改变桌面上的视觉尺寸。
const petStageBleed = 40;

// 66 美术像素 = 99 CSS px，与 0.1.0 的宠物视觉尺寸完全一致，改造不改变观感。
const petStageCssPerArtPixel = 1.5;
// Transparent window / fixed stage frame. A form's dock-peek clearance is
// measured against this frame, rather than against the larger art canvas.
const petStageFrameCssSize = 220;

// 交互命中框：与吸附用的可见矩形同宽，画布扩容不会让“点到空气也能互动”。
const petStageHitCssSize = 105;

// Canvas center inside the 220px transparent window: .pet-layer is positioned
// at left 0.5px/top 2.5px, so its 219px canvas sits 2px below window center.
// Dock/gaze geometry uses this *visual* offset, not a second guessed anchor.
const petStageVisualCenterOffset = Object.freeze({ x: 0, y: 2 });

function petStagePositiveNumber(value, name) {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be a positive finite number`);
  return value;
}

// 美术像素到设备像素取整数倍：身体网格的每条边都落在整数设备像素上，
// 光栅内部不会产生半像素覆盖，也就不会有半透明接缝。
function petStageDeviceScale(devicePixelRatio, cssPerArtPixel) {
  return Math.max(2, Math.ceil(cssPerArtPixel * devicePixelRatio));
}

function resolvePetStage(options = {}) {
  const devicePixelRatio = petStagePositiveNumber(
    options.devicePixelRatio === undefined ? 1 : options.devicePixelRatio,
    'devicePixelRatio'
  );
  const cssPerArtPixel = petStagePositiveNumber(
    options.cssPerArtPixel === undefined ? petStageCssPerArtPixel : options.cssPerArtPixel,
    'cssPerArtPixel'
  );
  const bleed = options.bleed === undefined ? petStageBleed : options.bleed;
  if (!Number.isInteger(bleed) || bleed < 0) throw new RangeError('bleed must be a non-negative integer');

  const bodySize = petStageArt.bodySize;
  const artWidth = bodySize + bleed * 2;
  const deviceScale = petStageDeviceScale(devicePixelRatio, cssPerArtPixel);

  return Object.freeze({
    artWidth,
    artHeight: artWidth,
    bodySize,
    bleed,
    cell: petStageArt.cell,
    bodyOrigin: Object.freeze({ x: bleed, y: bleed }),
    bodyCenter: Object.freeze({ x: artWidth / 2, y: artWidth / 2 }),
    deviceScale,
    rasterWidth: artWidth * deviceScale,
    rasterHeight: artWidth * deviceScale,
    cssWidth: artWidth * cssPerArtPixel,
    cssHeight: artWidth * cssPerArtPixel,
    frameCssSize: petStageFrameCssSize,
    bodyCssSize: bodySize * cssPerArtPixel,
    hitCssSize: petStageHitCssSize,
    // 命中框相对画布左上角的偏移：画布比身体大，命中框要回到身体上。
    hitCssOffset: (artWidth * cssPerArtPixel - petStageHitCssSize) / 2
  });
}

// 动作位移必须落在整数设备像素上。非整数位移会让 sprite 贴图边缘被反锯齿，
// 在透明置顶窗口上表现为能看见桌面的裂缝，而且裂缝随正弦相位游走 ——
// 那就是“上下或左右移动时的割裂”。
function snapToPetDevicePixel(value, deviceScale) {
  if (!Number.isFinite(value)) throw new TypeError('value must be finite');
  petStagePositiveNumber(deviceScale, 'deviceScale');
  return Math.round(value * deviceScale) / deviceScale;
}

// 以身体左上角为原点的可绘制安全区。四肢与道具的坐标都相对身体表达，
// 所以越界检查也在这个坐标系里做。
function petArtSafeArea(stage) {
  if (!stage || !Number.isFinite(stage.bleed) || !Number.isFinite(stage.bodySize)) {
    throw new TypeError('stage must come from resolvePetStage()');
  }
  return Object.freeze({
    left: -stage.bleed,
    top: -stage.bleed,
    right: stage.bodySize + stage.bleed,
    bottom: stage.bodySize + stage.bleed
  });
}

// 渲染进程以 classic <script> 共享全局词法作用域加载本文件，
// 顶层标识符必须是本文件专属，否则同页面的后续脚本会在编译期整体失败。
const petStageApi = {
  PET_ART: petStageArt,
  PET_ART_BLEED: petStageBleed,
  PET_CSS_PER_ART_PIXEL: petStageCssPerArtPixel,
  PET_HIT_CSS_SIZE: petStageHitCssSize,
  PET_VISUAL_CENTER_OFFSET: petStageVisualCenterOffset,
  resolvePetStage,
  snapToPetDevicePixel,
  petArtSafeArea
};



export default petStageApi;
export const PET_ART = petStageApi.PET_ART;
export const PET_ART_BLEED = petStageApi.PET_ART_BLEED;
export const PET_CSS_PER_ART_PIXEL = petStageApi.PET_CSS_PER_ART_PIXEL;
export const PET_HIT_CSS_SIZE = petStageApi.PET_HIT_CSS_SIZE;
export const PET_VISUAL_CENTER_OFFSET = petStageApi.PET_VISUAL_CENTER_OFFSET;
export { resolvePetStage, snapToPetDevicePixel, petArtSafeArea };
