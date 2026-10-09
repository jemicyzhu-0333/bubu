'use strict';

import { PET_APPEARANCE_ITEMS, PET_APPEARANCE_VIEWS } from '../content/appearance.mjs';

const PET_VIEW_TRANSFORMS = Object.freeze({
  front: Object.freeze({ scaleX: 1, offsetX: 0 }),
  'three-quarter': Object.freeze({ scaleX: 1, offsetX: 0 }),
  profile: Object.freeze({ scaleX: 1, offsetX: 0 }),
  back: Object.freeze({ scaleX: 1, offsetX: 0 })
});

const PET_BODY_VARIANTS = Object.freeze({
  front: 'front',
  'three-quarter': 'three-quarter',
  profile: 'profile',
  back: 'back'
});

// 视图分配规则（完整推导与逐个动作的归属表见 docs/PET_VISUAL.md 第 4 节）：
//
//   profile：意图是水平的 —— 位移（行走/冲刺/滑行/太空步），或作用于身侧/地面的目标
//     （挖土、浇花、搬东西、被墙角卡住）。
//   three-quarter：宠物的注意力或它手里的单侧道具指向一旁（往远处看、伸手接星、撑伞、
//     拿着麦克风表演），身体因此自然扭向那一侧。
//   front：其余全部 —— 包括所有朝着用户的互动（挥手、击掌、跳舞）。
//
// 硬约束（可机械检验，由 test/pet-appearance.test.js 守住）：**自身绘制已经居中的动作
// 不得用 three-quarter**。转身会把五官整体摆向朝向侧约 8.5 art px，却不会移动道具，也不
// 压缩手臂；只有绘制本身已经偏向那一侧的动作能吸收这个位移。居中的道具遇上转身就会
// 错位（望远镜的桥盖在左眼上、鼓与相机偏离身体中线），对称双臂也会与转身相矛盾。
const PROFILE_MOTIONS = new Set(['carry', 'dash', 'dig', 'glide', 'moonwalk', 'squish', 'water']);
const THREE_QUARTER_MOTIONS = new Set(['reach', 'sway', 'telescope', 'umbrella']);

function validateAppearanceItems(items = []) {
  if (!Array.isArray(items)) throw new TypeError('appearance items are required');
  const ids = new Set();
  for (const item of items) {
    if (!item || typeof item.id !== 'string' || ids.has(item.id)) throw new TypeError('appearance ids must be unique');
    if (!['head', 'face', 'neck', 'body', 'back', 'hand', 'front'].includes(item.slot)) {
      throw new TypeError(`invalid appearance slot: ${item.id}`);
    }
    if (!['back', 'front'].includes(item.layer) || !Number.isInteger(item.z)) {
      throw new TypeError(`invalid appearance layer: ${item.id}`);
    }
    // parts 必须是 layer 所属集合的非空子集，并且包含主层；
    // 否则一件配饰可能声明了 layer 却从不在那一层落笔。
    if (!Array.isArray(item.parts) || !item.parts.length
      || item.parts.some(part => !['back', 'front'].includes(part))
      || !item.parts.includes(item.layer)) {
      throw new TypeError(`invalid appearance parts: ${item.id}`);
    }
    if (!['level', 'skin'].includes(item.unlockKind)) throw new TypeError(`invalid appearance unlock: ${item.id}`);
    if (item.exclusiveGroup !== null && typeof item.exclusiveGroup !== 'string') {
      throw new TypeError(`invalid appearance exclusive group: ${item.id}`);
    }
    if (!Number.isInteger(item.exclusivePriority) || item.exclusivePriority < 0) {
      throw new TypeError(`invalid appearance priority: ${item.id}`);
    }
    if (typeof item.renderKey !== 'string' || !item.renderKey) throw new TypeError(`invalid appearance renderer: ${item.id}`);
    if (item.formId !== undefined && (typeof item.formId !== 'string' || !item.formId)) {
      throw new TypeError(`invalid appearance form: ${item.id}`);
    }
    if (item.effect !== null && typeof item.effect !== 'string') throw new TypeError(`invalid appearance effect: ${item.id}`);
    if (!Number.isInteger(item.minLevel) || item.minLevel < 1) throw new TypeError(`invalid appearance level: ${item.id}`);
    if (!Array.isArray(item.views) || item.views.some(view => !PET_APPEARANCE_VIEWS.includes(view))) {
      throw new TypeError(`invalid appearance views: ${item.id}`);
    }
    if (!item.anchor || PET_APPEARANCE_VIEWS.some(view => {
      const anchor = item.anchor[view];
      return !anchor || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y);
    })) {
      throw new TypeError(`invalid appearance anchor: ${item.id}`);
    }
    ids.add(item.id);
  }
  return Object.freeze({ total: items.length, ids: Object.freeze([...ids]) });
}

function resolveExclusiveItems(items) {
  const winners = new Map();
  for (const item of items) {
    if (!item.exclusiveGroup) continue;
    const previous = winners.get(item.exclusiveGroup);
    if (!previous || item.exclusivePriority > previous.exclusivePriority
      || (item.exclusivePriority === previous.exclusivePriority && item.minLevel > previous.minLevel)
      || (item.exclusivePriority === previous.exclusivePriority && item.minLevel === previous.minLevel && item.z > previous.z)) {
      winners.set(item.exclusiveGroup, item);
    }
  }
  return items.filter(item => !item.exclusiveGroup || winners.get(item.exclusiveGroup) === item);
}

function projectAppearance({
  skin = 'pink', formId = 'dango', level = 1, view = 'front', items = PET_APPEARANCE_ITEMS,
  itemIds = null, includeLocked = false
} = {}) {
  validateAppearanceItems(items);
  const safeSkin = typeof skin === 'string' && skin.trim() ? skin : 'pink';
  const safeLevel = Math.max(1, Math.floor(Number(level) || 1));
  const safeView = PET_APPEARANCE_VIEWS.includes(view) ? view : 'front';
  const requested = Array.isArray(itemIds) ? new Set(itemIds) : null;
  const activeItems = resolveExclusiveItems(items
    .filter(item => (item.formId || 'dango') === formId)
    .filter(item => requested ? requested.has(item.id) : (includeLocked || item.minLevel <= safeLevel))
    .filter(item => includeLocked || !item.skin || item.skin === safeSkin)
    .filter(item => item.views.includes(safeView))
    .sort((left, right) => left.z - right.z || left.id.localeCompare(right.id)))
    .map(item => Object.freeze({ ...item }));
  return Object.freeze({
    version: 1,
    skin: safeSkin,
    level: safeLevel,
    view: safeView,
    items: Object.freeze(activeItems)
  });
}

function derivePetView({ action = null, state = 'idle' } = {}) {
  // A multi-beat activity keeps its source view unless a dedicated turn is authored.
  const motion = action && typeof (action.viewMotion || action.motion) === 'string'
    ? (action.viewMotion || action.motion) : '';
  if (state === 'walking' || PROFILE_MOTIONS.has(motion)) return 'profile';
  if (THREE_QUARTER_MOTIONS.has(motion) || state === 'dragged') return 'three-quarter';
  return 'front';
}

function getPetViewTransform(view = 'front') {
  const safeView = PET_APPEARANCE_VIEWS.includes(view) ? view : 'front';
  return Object.freeze({ view: safeView, ...PET_VIEW_TRANSFORMS[safeView] });
}

function getPetBodyVariant(view = 'front') {
  const safeView = PET_APPEARANCE_VIEWS.includes(view) ? view : 'front';
  return PET_BODY_VARIANTS[safeView];
}

function adaptFaceForView(face, view = 'front') {
  if (!face || typeof face !== 'object') return face;
  const safeView = PET_APPEARANCE_VIEWS.includes(view) ? view : 'front';
  const extraInset = safeView === 'profile' ? 1 : safeView === 'three-quarter' ? 1 : 0;
  return Object.freeze({ ...face, eyeInsetX: (Number(face.eyeInsetX) || 0) + extraInset });
}

const petAppearanceApi = Object.freeze({
  PET_APPEARANCE_VIEWS,
  PET_BODY_VARIANTS,
  projectAppearance,
  validateAppearanceItems,
  derivePetView,
  getPetViewTransform,
  getPetBodyVariant,
  adaptFaceForView
});

export default petAppearanceApi;
export {
  PET_APPEARANCE_VIEWS,
  PET_BODY_VARIANTS,
  projectAppearance,
  validateAppearanceItems,
  derivePetView,
  getPetViewTransform,
  getPetBodyVariant,
  adaptFaceForView
};
