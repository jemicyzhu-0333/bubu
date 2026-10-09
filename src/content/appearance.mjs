'use strict';

const PET_APPEARANCE_VIEWS = Object.freeze(['front', 'three-quarter', 'profile', 'back']);
const PET_APPEARANCE_LAYERS = Object.freeze(['back', 'front']);

function appearanceItem(id, label, slot, layer, z, options = {}) {
  const defaultAnchor = options.anchor && typeof options.anchor === 'object'
    ? options.anchor
    : {};
  const anchorFor = view => {
    const source = defaultAnchor[view] && typeof defaultAnchor[view] === 'object'
      ? defaultAnchor[view]
      : defaultAnchor;
    return Object.freeze({
      x: Number.isFinite(Number(source.x)) ? Number(source.x) : 0,
      y: Number.isFinite(Number(source.y)) ? Number(source.y) : 0
    });
  };
  // parts：这件配饰会在哪几层留下部件。披风、帽子这类跨越身体前后的配饰
  // 必须同时出现在 back 与 front，否则整块落在轮廓内就等于没画。
  const parts = Array.isArray(options.parts) && options.parts.length
    ? PET_APPEARANCE_LAYERS.filter(candidate => options.parts.includes(candidate))
    : [layer];
  return Object.freeze({
    id,
    label,
    slot,
    layer,
    z,
    parts: Object.freeze(parts.length ? parts : [layer]),
    minLevel: Number.isInteger(options.minLevel) ? options.minLevel : 1,
    formId: typeof options.formId === 'string' ? options.formId : 'dango',
    skin: typeof options.skin === 'string' ? options.skin : null,
    unlockKind: options.unlockKind || (options.skin ? 'skin' : 'level'),
    exclusiveGroup: typeof options.exclusiveGroup === 'string' ? options.exclusiveGroup : null,
    exclusivePriority: Number.isInteger(options.exclusivePriority) ? options.exclusivePriority : 0,
    renderKey: typeof options.renderKey === 'string' ? options.renderKey : id,
    effect: typeof options.effect === 'string' ? options.effect : null,
    views: Object.freeze(Array.isArray(options.views) && options.views.length
      ? [...options.views]
      : ['front']),
    anchor: Object.freeze({
      front: anchorFor('front'),
      'three-quarter': anchorFor('three-quarter'),
      profile: anchorFor('profile'),
      back: anchorFor('back')
    }),
    bleed: Object.freeze({
      left: Math.max(0, Number(options.bleed && options.bleed.left) || 0),
      top: Math.max(0, Number(options.bleed && options.bleed.top) || 0),
      right: Math.max(0, Number(options.bleed && options.bleed.right) || 0),
      bottom: Math.max(0, Number(options.bleed && options.bleed.bottom) || 0)
    })
  });
}

const ALL_VIEWS = Object.freeze(['front', 'three-quarter', 'profile', 'back']);

// 互斥组按“同一块画面空间”划分，不按身体部位划分。挎包曾经与披风、
// 鱼鳍同处 backwear，于是 Lv.20 解锁披风反而弄丢了 Lv.8 的挎包 —— 升级变成减法。
//
// layer/parts 同样不按部位划，而是按“会不会盖掉轮廓”划。身体网格的 y<8 几乎全是两
// 只耳朵，所以所有头部配饰（帽类与顶饰）整件走 back：身体贴图随后覆盖，
// 耳朵天然压在帽子之前。front 层只留围巾、挎包、鞋子与披风侧摆。
// 像素级几何约束见 core/pet-appearance-sprites.mjs。
const PET_APPEARANCE_ITEMS = Object.freeze([
  appearanceItem('milestone.sprout', '小芽', 'head', 'back', 40, {
    minLevel: 3,
    views: ALL_VIEWS,
    exclusiveGroup: 'headwear',
    exclusivePriority: 20,
    renderKey: 'sprout',
    effect: 'sprout-sway',
    bleed: { top: 14 }
  }),
  appearanceItem('milestone.sunhat', '小草帽', 'head', 'back', 46, {
    minLevel: 5,
    views: ALL_VIEWS,
    parts: ['back', 'front'],
    exclusiveGroup: 'headwear',
    exclusivePriority: 50,
    renderKey: 'sunhat',
    bleed: { top: 16, left: 4, right: 4 }
  }),
  appearanceItem('milestone.satchel', '小挎包', 'body', 'front', 24, {
    minLevel: 8,
    views: ALL_VIEWS,
    exclusiveGroup: 'sidebag',
    exclusivePriority: 40,
    renderKey: 'satchel',
    bleed: { left: 14, right: 4 }
  }),
  appearanceItem('milestone.scarf', '彩虹围巾', 'neck', 'front', 36, {
    minLevel: 10,
    views: ALL_VIEWS,
    exclusiveGroup: 'neckwear',
    exclusivePriority: 50,
    renderKey: 'scarf',
    effect: 'scarf-flutter',
    bleed: { right: 12 }
  }),
  appearanceItem('milestone.halo', '小光环', 'head', 'front', 52, {
    minLevel: 12,
    views: ALL_VIEWS,
    exclusiveGroup: 'head-aura',
    exclusivePriority: 50,
    renderKey: 'halo',
    effect: 'halo-glow',
    // 帽子在场时光环会被合成层抬高一个帽冠，预留位必须包含抬高量。
    bleed: { top: 32 }
  }),
  appearanceItem('milestone.boots', '闪闪鞋', 'body', 'front', 38, {
    minLevel: 15,
    views: ALL_VIEWS,
    exclusiveGroup: 'footwear',
    exclusivePriority: 50,
    renderKey: 'boots',
    effect: 'boots-sparkle'
  }),
  // 披风同时占 back 与 front：主体量在身后，侧摆甩出轮廓之外才能从正面被看见；
  // back 视角则整块到前景展开。
  appearanceItem('milestone.cape', '小披风', 'back', 'back', 14, {
    minLevel: 20,
    views: ALL_VIEWS,
    parts: ['back', 'front'],
    exclusiveGroup: 'backwear',
    exclusivePriority: 80,
    renderKey: 'cape',
    effect: 'cape-flutter',
    bleed: { left: 18, right: 18 }
  }),
  appearanceItem('skin.forest-leaf', '森林叶片', 'head', 'back', 42, {
    skin: 'forest',
    unlockKind: 'skin',
    views: ALL_VIEWS,
    exclusiveGroup: 'head-accent',
    exclusivePriority: 30,
    renderKey: 'forest-leaf',
    effect: 'leaf-shimmer',
    bleed: { top: 14, right: 8 }
  }),
  appearanceItem('skin.sakura-flower', '樱花发饰', 'head', 'back', 42, {
    skin: 'sakura',
    unlockKind: 'skin',
    views: ALL_VIEWS,
    exclusiveGroup: 'head-accent',
    exclusivePriority: 30,
    renderKey: 'sakura-flower',
    effect: 'petal-glint',
    bleed: { top: 8, right: 8 }
  }),
  appearanceItem('skin.moon-crescent', '月牙', 'head', 'back', 45, {
    skin: 'moon',
    unlockKind: 'skin',
    views: ALL_VIEWS,
    exclusiveGroup: 'head-accent',
    exclusivePriority: 40,
    renderKey: 'moon-crescent',
    effect: 'moon-glow',
    bleed: { top: 12, right: 6 }
  }),
  appearanceItem('skin.flame-tip', '火焰尖尖', 'head', 'back', 44, {
    skin: 'flame',
    unlockKind: 'skin',
    views: ALL_VIEWS,
    exclusiveGroup: 'headwear',
    exclusivePriority: 70,
    renderKey: 'flame-tip',
    effect: 'flame-flicker',
    bleed: { top: 16 }
  }),
  appearanceItem('skin.crown', '王冠', 'head', 'back', 48, {
    skin: 'crown',
    unlockKind: 'skin',
    views: ALL_VIEWS,
    exclusiveGroup: 'headwear',
    exclusivePriority: 90,
    renderKey: 'crown',
    effect: 'crown-shine',
    bleed: { top: 16 }
  }),
  appearanceItem('skin.robot-antenna', '信号天线', 'head', 'back', 44, {
    skin: 'robot',
    unlockKind: 'skin',
    views: ALL_VIEWS,
    exclusiveGroup: 'headwear',
    exclusivePriority: 65,
    renderKey: 'robot-antenna',
    effect: 'signal-pulse',
    bleed: { top: 16 }
  }),
  appearanceItem('skin.woodsman-cap', '樵夫帽', 'head', 'back', 44, {
    skin: 'woodsman',
    unlockKind: 'skin',
    views: ALL_VIEWS,
    exclusiveGroup: 'headwear',
    exclusivePriority: 80,
    renderKey: 'woodsman-cap',
    bleed: { top: 16, right: 10 }
  }),
  appearanceItem('skin.ocean-fin', '海蓝鳍', 'back', 'back', 12, {
    skin: 'ocean',
    unlockKind: 'skin',
    views: ALL_VIEWS,
    exclusiveGroup: 'backwear',
    exclusivePriority: 100,
    renderKey: 'ocean-fin',
    // profile 把背鳍镜像到背侧（左），因此除右侧外还要向左申报占位。
    bleed: { left: 8, right: 22 }
  }),
  appearanceItem('skin.bat-wings', '夜行翼', 'back', 'back', 8, {
    skin: 'bat',
    unlockKind: 'skin',
    views: ALL_VIEWS,
    exclusiveGroup: 'backwear',
    exclusivePriority: 100,
    renderKey: 'bat-wings',
    bleed: { left: 18, right: 18 }
  }),
  // A pet's wardrobe is scoped to its form. These group IDs deliberately do
  // not overwrite the original dango groups in companion.appearance.equipped;
  // both outfits survive a form switch without a new persisted schema.
  appearanceItem('usagi.ear-bow', '薄荷耳结', 'head', 'front', 44, {
    formId: 'usagi', skin: 'usagi', unlockKind: 'skin', views: ALL_VIEWS,
    exclusiveGroup: 'usagi.earwear', exclusivePriority: 30,
    renderKey: 'usagi-ear-bow', bleed: { top: 20 }
  }),
  appearanceItem('usagi.star-collar', '星光颈饰', 'neck', 'front', 46, {
    formId: 'usagi', skin: 'usagi', unlockKind: 'skin', views: ALL_VIEWS,
    exclusiveGroup: 'usagi.neckwear', exclusivePriority: 30,
    renderKey: 'usagi-star-collar'
  }),
  appearanceItem('usagi.travel-cape', '旅行短披风', 'back', 'front', 15, {
    formId: 'usagi', skin: 'usagi', unlockKind: 'skin', views: ALL_VIEWS,
    parts: ['front'], exclusiveGroup: 'usagi.backwear', exclusivePriority: 50,
    renderKey: 'usagi-travel-cape', bleed: { left: 14, right: 12, bottom: 14 }
  }),
  // New options keep the three original Usagi defaults. Independent spaces
  // unlock alongside them; choices within an occupied space never erase it.
  appearanceItem('usagi.sprout-clip', '嫩芽耳夹', 'head', 'front', 44, {
    formId: 'usagi', minLevel: 3, views: ALL_VIEWS,
    exclusiveGroup: 'usagi.earwear', exclusivePriority: 10,
    renderKey: 'usagi-sprout-clip', bleed: { top: 20 }
  }),
  appearanceItem('usagi.sunhat', '麦色小草帽', 'head', 'front', 42, {
    formId: 'usagi', minLevel: 5, views: ALL_VIEWS,
    exclusiveGroup: 'usagi.headwear', exclusivePriority: 30,
    renderKey: 'usagi-sunhat', bleed: { top: 12 }
  }),
  appearanceItem('usagi.carrot-satchel', '胡萝卜小挎包', 'body', 'front', 24, {
    formId: 'usagi', minLevel: 8, views: ALL_VIEWS,
    exclusiveGroup: 'usagi.sidebag', exclusivePriority: 30,
    renderKey: 'usagi-carrot-satchel', bleed: { left: 6, bottom: 2 }
  }),
  appearanceItem('usagi.pastel-scarf', '云彩小围巾', 'neck', 'front', 46, {
    formId: 'usagi', minLevel: 10, views: ALL_VIEWS,
    exclusiveGroup: 'usagi.neckwear', exclusivePriority: 10,
    renderKey: 'usagi-pastel-scarf'
  }),
  appearanceItem('usagi.halo', '柔光小环', 'head', 'front', 52, {
    formId: 'usagi', minLevel: 12, views: ALL_VIEWS,
    exclusiveGroup: 'usagi.aura', exclusivePriority: 30,
    renderKey: 'usagi-halo', bleed: { top: 31 }
  }),
  appearanceItem('usagi.soft-boots', '星点软靴', 'body', 'front', 38, {
    formId: 'usagi', minLevel: 15, views: ALL_VIEWS,
    exclusiveGroup: 'usagi.footwear', exclusivePriority: 30,
    renderKey: 'usagi-soft-boots', bleed: { bottom: 5 }
  }),
  appearanceItem('usagi.starlit-cape', '星夜短披风', 'back', 'front', 15, {
    formId: 'usagi', minLevel: 20, views: ALL_VIEWS,
    exclusiveGroup: 'usagi.backwear', exclusivePriority: 10,
    renderKey: 'usagi-starlit-cape', bleed: { left: 14, right: 12, bottom: 14 }
  }),
  appearanceItem('usagi.sakura-clip', '樱花耳夹', 'head', 'front', 44, {
    formId: 'usagi', minLevel: 6, views: ALL_VIEWS,
    exclusiveGroup: 'usagi.earwear', exclusivePriority: 10,
    renderKey: 'usagi-sakura-clip', bleed: { top: 16 }
  }),
  appearanceItem('usagi.tiny-crown', '奶油小王冠', 'head', 'front', 42, {
    formId: 'usagi', minLevel: 18, views: ALL_VIEWS,
    exclusiveGroup: 'usagi.headwear', exclusivePriority: 10,
    renderKey: 'usagi-tiny-crown', bleed: { top: 12 }
  }),
  // Seasonal alternatives reuse the original slot and level progression. Their
  // lower priority preserves every automatic outfit from the original catalog.
  appearanceItem('usagi.garden-beret', '鼠尾草贝雷帽', 'head', 'front', 42, {
    formId: 'usagi', minLevel: 5, views: ALL_VIEWS,
    exclusiveGroup: 'usagi.headwear', exclusivePriority: 5,
    renderKey: 'usagi-garden-beret', bleed: { top: 12 }
  }),
  appearanceItem('usagi.daisy-clip', '雏菊耳扣', 'head', 'front', 44, {
    formId: 'usagi', minLevel: 3, views: ALL_VIEWS,
    exclusiveGroup: 'usagi.earwear', exclusivePriority: 5,
    renderKey: 'usagi-daisy-clip', bleed: { top: 12 }
  }),
  appearanceItem('usagi.petal-collar', '叶瓣小围领', 'neck', 'front', 46, {
    formId: 'usagi', minLevel: 10, views: ALL_VIEWS,
    exclusiveGroup: 'usagi.neckwear', exclusivePriority: 5,
    renderKey: 'usagi-petal-collar'
  }),
  appearanceItem('usagi.seed-pouch', '种子束口袋', 'body', 'front', 24, {
    formId: 'usagi', minLevel: 8, views: ALL_VIEWS,
    exclusiveGroup: 'usagi.sidebag', exclusivePriority: 5,
    renderKey: 'usagi-seed-pouch', bleed: { left: 6, bottom: 2 }
  }),
  appearanceItem('usagi.rain-cape', '蜂蜜雨披', 'back', 'front', 15, {
    formId: 'usagi', minLevel: 20, views: ALL_VIEWS,
    exclusiveGroup: 'usagi.backwear', exclusivePriority: 5,
    renderKey: 'usagi-rain-cape', bleed: { left: 12, right: 12, bottom: 10 }
  }),
  appearanceItem('usagi.rain-boots', '薄荷雨靴', 'body', 'front', 38, {
    formId: 'usagi', minLevel: 15, views: ALL_VIEWS,
    exclusiveGroup: 'usagi.footwear', exclusivePriority: 5,
    renderKey: 'usagi-rain-boots', bleed: { bottom: 5 }
  }),
  appearanceItem('usagi.moon-beret', '月牙贝雷帽', 'head', 'front', 42, {
    formId: 'usagi', minLevel: 18, views: ALL_VIEWS,
    exclusiveGroup: 'usagi.headwear', exclusivePriority: 5,
    renderKey: 'usagi-moon-beret', bleed: { top: 12 }
  }),
  appearanceItem('usagi.envelope-pouch', '月光信封包', 'body', 'front', 24, {
    formId: 'usagi', minLevel: 8, views: ALL_VIEWS,
    exclusiveGroup: 'usagi.sidebag', exclusivePriority: 5,
    renderKey: 'usagi-envelope-pouch', bleed: { left: 6, bottom: 2 }
  }),
  appearanceItem('usagi.constellation', '三星小光弧', 'head', 'front', 52, {
    formId: 'usagi', minLevel: 12, views: ALL_VIEWS,
    exclusiveGroup: 'usagi.aura', exclusivePriority: 5,
    renderKey: 'usagi-constellation', bleed: { top: 33 }
  }),
  appearanceItem('usagi.garden-apron', '陶土小围裙', 'back', 'front', 15, {
    formId: 'usagi', minLevel: 20, views: ALL_VIEWS,
    exclusiveGroup: 'usagi.backwear', exclusivePriority: 5,
    renderKey: 'usagi-garden-apron', bleed: { bottom: 5 }
  }),
  appearanceItem('usagi.garden-clogs', '鼠尾草园艺鞋', 'body', 'front', 38, {
    formId: 'usagi', minLevel: 15, views: ALL_VIEWS,
    exclusiveGroup: 'usagi.footwear', exclusivePriority: 5,
    renderKey: 'usagi-garden-clogs', bleed: { bottom: 5 }
  }),
  appearanceItem('usagi.rain-satchel', '雨滴小挎包', 'body', 'front', 24, {
    formId: 'usagi', minLevel: 8, views: ALL_VIEWS,
    exclusiveGroup: 'usagi.sidebag', exclusivePriority: 5,
    renderKey: 'usagi-rain-satchel', bleed: { left: 6, bottom: 2 }
  }),
  appearanceItem('usagi.moon-boots', '月牙软靴', 'body', 'front', 38, {
    formId: 'usagi', minLevel: 15, views: ALL_VIEWS,
    exclusiveGroup: 'usagi.footwear', exclusivePriority: 5,
    renderKey: 'usagi-moon-boots', bleed: { bottom: 5 }
  })
]);

export default Object.freeze({ PET_APPEARANCE_ITEMS, PET_APPEARANCE_VIEWS, PET_APPEARANCE_LAYERS });
export { PET_APPEARANCE_ITEMS, PET_APPEARANCE_VIEWS, PET_APPEARANCE_LAYERS };
