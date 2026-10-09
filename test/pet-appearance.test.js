'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PET_APPEARANCE_ITEMS } = require('../src/content/appearance.mjs');
const petArt = require('../src/core/pet-art.mjs');
const {
  PET_APPEARANCE_VIEWS,
  projectAppearance,
  validateAppearanceItems,
  derivePetView,
  getPetViewTransform,
  adaptFaceForView
} = require('../src/core/pet-appearance.mjs');
const { drawAppearanceLayer, HEAD_LIFT } = require('../src/core/pet-appearance-art.mjs');
const { drawActionDetails } = require('../src/core/pet-action-art.mjs');
const { PET_ACTIONS } = require('../src/content/behaviors.mjs');
const PIXEL_ITEMS = PET_APPEARANCE_ITEMS.filter(item => item.formId === 'dango');

// 假 context 必须真的累加 translate：配饰的最终落点由“视角位移 + 锚点 + 让位抬高”
// 共同决定；只记未变换的 fillRect 会让位置类断言变成空抖。
function createDrawingContext() {
  const calls = [];
  const stack = [];
  let origin = { x: 0, y: 0 };
  return {
    calls,
    save() { stack.push(origin); },
    restore() { origin = stack.pop() || { x: 0, y: 0 }; },
    translate(x, y) {
      calls.push(['translate', x, y]);
      origin = { x: origin.x + x, y: origin.y + y };
    },
    scale(x, y) { calls.push(['scale', x, y]); },
    clearRect(x, y, width, height) { calls.push(['clearRect', x, y, width, height]); },
    fillRect(x, y, width, height) {
      calls.push(['fillRect', origin.x + x, origin.y + y, width, height]);
    },
    set fillStyle(value) { calls.push(['fillStyle', value]); },
    set globalAlpha(value) { calls.push(['globalAlpha', value]); }
  };
}

test('appearance content is a closed layered slot registry', () => {
  const result = validateAppearanceItems(PET_APPEARANCE_ITEMS);
  assert.equal(result.total, PET_APPEARANCE_ITEMS.length);
  assert.equal(PIXEL_ITEMS.length, 16);
  assert.equal(result.total, 41);
  assert.ok(PET_APPEARANCE_ITEMS.every(item => item.views.includes('front')));
  assert.ok(PET_APPEARANCE_ITEMS.every(item => item.anchor && item.anchor.profile));
  assert.ok(PET_APPEARANCE_ITEMS.every(item => item.bleed && item.bleed.top >= 0));
  assert.equal(new Set(PET_APPEARANCE_ITEMS.map(item => item.renderKey)).size, result.total);
  assert.ok(PET_APPEARANCE_ITEMS.every(item => ['level', 'skin'].includes(item.unlockKind)));
  assert.ok(PET_APPEARANCE_ITEMS.every(item => item.effect === null || typeof item.effect === 'string'));
  assert.ok(PET_APPEARANCE_ITEMS.every(item => item.parts.length && item.parts.includes(item.layer)));
});

test('level projection unlocks visible milestones without persistence or equipment state', () => {
  const early = projectAppearance({ skin: 'pink', level: 2, items: PET_APPEARANCE_ITEMS });
  const first = projectAppearance({ skin: 'pink', level: 3, items: PET_APPEARANCE_ITEMS });
  const developed = projectAppearance({ skin: 'pink', level: 12, items: PET_APPEARANCE_ITEMS });

  assert.deepEqual(early.items, []);
  assert.deepEqual(first.items.map(item => item.id), ['milestone.sprout']);
  assert.deepEqual(developed.items.map(item => item.id), [
    'milestone.satchel', 'milestone.scarf', 'milestone.sunhat', 'milestone.halo'
  ]);
  assert.equal(Object.prototype.hasOwnProperty.call(developed, 'equipped'), false);
});

test('appearance groups enforce deliberate outfit compatibility', () => {
  const levelThree = projectAppearance({ skin: 'pink', level: 3, items: PET_APPEARANCE_ITEMS });
  assert.deepEqual(levelThree.items.map(item => item.id), ['milestone.sprout']);

  // 升级不得是减法：挎包自己一个互斥组，不会因为 Lv.20 解锁披风而消失。
  const levelTwenty = projectAppearance({ skin: 'pink', level: 20, items: PET_APPEARANCE_ITEMS });
  assert.deepEqual(levelTwenty.items.map(item => item.id), [
    'milestone.cape', 'milestone.satchel', 'milestone.scarf',
    'milestone.boots', 'milestone.sunhat', 'milestone.halo'
  ]);
  const levelFifteen = projectAppearance({ skin: 'pink', level: 15, items: PET_APPEARANCE_ITEMS });
  for (const id of levelFifteen.items.map(item => item.id)) {
    assert.ok(levelTwenty.items.some(item => item.id === id), `Lv.20 丢了 Lv.15 已有的 ${id}`);
  }

  const forest = projectAppearance({ skin: 'forest', level: 5, items: PET_APPEARANCE_ITEMS });
  assert.deepEqual(forest.items.map(item => item.id), ['skin.forest-leaf', 'milestone.sunhat']);

  const ocean = projectAppearance({ skin: 'ocean', level: 20, items: PET_APPEARANCE_ITEMS });
  assert.equal(ocean.items.filter(item => item.exclusiveGroup === 'backwear').length, 1);
  assert.equal(ocean.items.find(item => item.exclusiveGroup === 'backwear').id, 'skin.ocean-fin');
});

test('skin signatures stay isolated and future views fail back to front', () => {
  const crown = projectAppearance({ skin: 'crown', level: 1, items: PET_APPEARANCE_ITEMS });
  const forest = projectAppearance({ skin: 'forest', level: 1, items: PET_APPEARANCE_ITEMS });
  const profile = projectAppearance({ skin: 'crown', level: 1, view: 'unknown', items: PET_APPEARANCE_ITEMS });

  assert.deepEqual(crown.items.map(item => item.id), ['skin.crown']);
  assert.deepEqual(forest.items.map(item => item.id), ['skin.forest-leaf']);
  assert.equal(profile.view, 'front');
  assert.deepEqual(PET_APPEARANCE_VIEWS, ['front', 'three-quarter', 'profile', 'back']);
});

test('appearance validation rejects duplicate ids and unsupported layers', () => {
  const duplicate = [{ ...PET_APPEARANCE_ITEMS[0] }, { ...PET_APPEARANCE_ITEMS[0] }];
  assert.throws(() => validateAppearanceItems(duplicate), /unique/);
  assert.throws(() => validateAppearanceItems([{ ...PET_APPEARANCE_ITEMS[0], layer: 'middle' }]), /layer/);
  assert.throws(() => validateAppearanceItems([{ ...PET_APPEARANCE_ITEMS[0], parts: [] }]), /parts/);
  assert.throws(() => validateAppearanceItems([{ ...PET_APPEARANCE_ITEMS[0], parts: ['front'] }]), /parts/);
});

test('每个动作的视图归属都是显式决定的（穷举表，不得默默重分）', () => {
  // 这张表就是设计本体；推导见 pet-appearance.mjs 的规则注释与 docs/PET_VISUAL.md 第 4 节。
  // 历史上挥手/击掌/跳舞/伸展/打鼓/拍照/影子拳击/哈欠都走了 three-quarter，于是“朝着用户
  // 的互动”反而把身体扭开，同时把居中道具留在偏离五官的位置。
  const expected = {
    // profile：意图水平 —— 位移，或作用于身侧/地面的目标
    'chase-butterfly': 'profile',
    'chase-laser': 'profile',
    moonwalk: 'profile',
    'paper-plane': 'profile',
    'carry-energy': 'profile',
    'dig-treasure': 'profile',
    'plant-water': 'profile',
    'stuck-corner': 'profile',
    // three-quarter：注意力或单侧道具指向一旁
    sing: 'three-quarter',
    telescope: 'three-quarter',
    'catch-star': 'three-quarter',
    'umbrella-dance': 'three-quarter',
    // front：其余全部，包括所有朝着用户的互动
    wave: 'front',
    'high-five': 'front',
    dance: 'front',
    stretch: 'front',
    yawn: 'front',
    'drum-solo': 'front',
    'photo-pose': 'front',
    'shadow-box': 'front',
    'look-around': 'front',
    workout: 'front',
    hiccup: 'front',
    juggle: 'front',
    'pit-fall': 'front',
    'mirror-meet': 'front',
    sneeze: 'front',
    'bubble-blow': 'front',
    meditate: 'front',
    'happy-hop': 'front',
    spin: 'front',
    'tail-wiggle': 'front',
    'read-book': 'front',
    'type-keyboard': 'front',
    'take-note': 'front',
    'sip-tea': 'front',
    sweep: 'front',
    'magic-trick': 'front',
    'knit-scarf': 'front',
    'hide-box': 'front',
    'build-blocks': 'front',
    'snack-picnic': 'front',
    'tiny-chef': 'front'
  };
  assert.deepEqual(
    Object.keys(PET_ACTIONS).slice().sort(),
    Object.keys(expected).slice().sort(),
    '新增或删除动作时必须同步这张视图归属表'
  );
  for (const [id, view] of Object.entries(expected)) {
    assert.equal(derivePetView({ action: PET_ACTIONS[id], state: 'idle' }), view, `${id} 应为 ${view}`);
  }
  // 状态驱动的两个例外：行走是水平位移，拖拽时身体确实会扭过来。
  assert.equal(derivePetView({ state: 'walking' }), 'profile');
  assert.equal(derivePetView({ state: 'dragged' }), 'three-quarter');
});

test('held props use authored view-specific shoulders and shared hand grips', () => {
  const { sampleActionContact } = require('../src/core/pet-action-contact.mjs');
  const { TOOL_SPRITES } = require('../src/content/companion/dango-tools.mjs');
  const { BODY_ANCHORS } = require('../src/content/companion/dango-body.mjs');
  // Geometric bias is not a contact invariant: the new authored tool may be
  // centered while its paws and muzzle correctly turn with the body.
  for (const id of ['sing', 'telescope', 'sip-tea', 'mirror-meet', 'look-around']) {
    for (const view of ['front', 'three-quarter', 'profile']) {
      for (const progress of [0, .25, .5, .75]) {
        const contact = sampleActionContact(PET_ACTIONS[id], progress, view);
        assert.ok(contact, `${id}/${view} must have authored contact`);
        const right = contact.hands.find(pose => pose.side === 'right');
        assert.deepEqual(right.points[0], Object.values(BODY_ANCHORS[view]['shoulder-right']));
        assert.ok(contact.tools.some(tool => {
          const sprite = TOOL_SPRITES[tool.key], grip = sprite.anchors.right;
          if (!grip) return false;
          return right.points.at(-1).every((value, axis) => Math.abs(value -
            (axis ? tool.y + grip[1] : tool.x + (tool.flip ? sprite.width - grip[0] : grip[0]))) < .001);
        }), `${id}/${view}/${progress}: visible paw must grip a real tool anchor`);
        assert.equal(contact.hands.filter(pose => pose.side === 'left').length === 0, view === 'profile' || id === 'telescope');
      }
    }
  }
});

test('motion projection supplies three-quarter and profile views without persistence', () => {
  assert.equal(derivePetView({ state: 'idle' }), 'front');
  assert.equal(derivePetView({ state: 'walking' }), 'profile');
  assert.equal(derivePetView({ action: { motion: 'sway' } }), 'three-quarter');
  assert.equal(derivePetView({ action: { motion: 'dash' } }), 'profile');

  assert.deepEqual(getPetViewTransform('front'), { view: 'front', scaleX: 1, offsetX: 0 });
  assert.deepEqual(getPetViewTransform('profile'), { view: 'profile', scaleX: 1, offsetX: 0 });
  for (const view of PET_APPEARANCE_VIEWS) {
    assert.deepEqual(getPetViewTransform(view), { view, scaleX: 1, offsetX: 0 });
  }
  const profileFace = adaptFaceForView({ eyes: 'wide', eyeInsetX: 1 }, 'profile');
  assert.equal(profileFace.eyeInsetX, 2);
  assert.equal(Object.prototype.hasOwnProperty.call(profileFace, 'facing'), false);
  assert.deepEqual(Object.keys(petArt.BODY_VARIANTS).sort(), [...PET_APPEARANCE_VIEWS].sort());
  assert.notDeepEqual(petArt.BODY_VARIANTS.front, petArt.BODY_VARIANTS.profile);
  assert.notDeepEqual(petArt.BODY_VARIANTS.front, petArt.BODY_VARIANTS.back);
});

test('all 16 historical decorations retain every authored pixel layer for comparison', () => {
  const { DANGO_APPEARANCE } = require('../src/content/companion/dango-appearance.mjs');
  for (const item of PIXEL_ITEMS) {
    const authored = DANGO_APPEARANCE[item.renderKey].views.front;
    const parts = ['back', 'front'].filter(part => authored[part]?.length);
    assert.ok(parts.length, `${item.id} must have an authored historical layer`);
    for (const part of parts) {
      const context = createDrawingContext();
      const appearance = projectAppearance({
        skin: item.skin || 'pink', level: 1, items: PET_APPEARANCE_ITEMS,
        itemIds: [item.id], includeLocked: true
      });
      assert.equal(drawAppearanceLayer(context, appearance, ['#000', '#111', '#f7768e'], {
        layer: part
      }), true, `${item.id}:${part}`);
      assert.ok(context.calls.some(call => call[0] === 'fillRect'), `${item.id}:${part}`);
    }
  }
});

// 四个可见性不变式。它们全部来自真实缺陷：披风整块藏在轮廓内、背包带横穿右眼、
// 围巾压住嘴的最后一行、侧面配饰被非均匀缩放挤成小数像素。
// 脸区：眼 5×5@grid(7,10)/(21,10)、嘴 7×4@grid(13,18)，cell 2 换算后为 x∈[14,52]、y∈[20,44]。
// 只约束 front 层：back 层按构造就在身体贴图之后，它画到脸区也看不见。
const FACE_BOX = { left: 14, top: 20, right: 52, bottom: 44 };

function paintedRects(item, { view = 'front', part = null } = {}) {
  const appearance = projectAppearance({
    skin: item.skin || 'pink', level: 1, view, items: PET_APPEARANCE_ITEMS,
    itemIds: [item.id], includeLocked: true
  });
  const rects = [];
  for (const layer of part ? [part] : item.parts) {
    const context = createDrawingContext();
    drawAppearanceLayer(context, appearance, ['#000', '#111', '#f7768e'], { layer });
    for (const call of context.calls) {
      if (call[0] !== 'fillRect') continue;
      rects.push({ x: call[1], y: call[2], width: call[3], height: call[4] });
    }
  }
  return rects;
}

test('配饰不得遮住五官：脸区矩形内不允许有任何 front 层配饰像素', () => {
  for (const item of PIXEL_ITEMS) {
    if (!item.parts.includes('front')) continue;
    for (const view of ['front', 'three-quarter']) {
      for (const rect of paintedRects(item, { view, part: 'front' })) {
        const overlapsX = rect.x < FACE_BOX.right && rect.x + rect.width > FACE_BOX.left;
        const overlapsY = rect.y < FACE_BOX.bottom && rect.y + rect.height > FACE_BOX.top;
        assert.equal(overlapsX && overlapsY, false,
          `${item.id} 在 ${view} 视角画进了脸区：${JSON.stringify(rect)}`);
      }
    }
  }
});

test('back 层配饰必须越出 66×66 的身体框，否则整块被身体贴图盖住等于没画', () => {
  const backItems = PIXEL_ITEMS.filter(item => item.parts.includes('back'));
  assert.equal(backItems.length, 12);
  for (const item of backItems) {
    const rects = paintedRects(item, { view: 'front', part: 'back' });
    assert.ok(rects.length, `${item.id} 在 back 层没有落笔`);
    // 身体在腰线处是满宽的：披风/鱼鳍/膜翼靠越出左右轮廓被看见，
    // 帽冠与顶饰靠越出 y<0（颅顶之上）被看见。
    const escapes = rects.some(rect => rect.x < 0 || rect.x + rect.width > 66
      || rect.y < 0 || rect.y + rect.height > 66);
    assert.ok(escapes, `${item.id} 的 back 部件全在 66×66 之内，从正面永远看不到`);
  }
});

test('披风在 back 视角整块进入前景，而不是继续藏在身后', () => {
  const cape = PET_APPEARANCE_ITEMS.find(item => item.renderKey === 'cape');
  assert.deepEqual([...cape.parts], ['back', 'front']);
  assert.equal(paintedRects(cape, { view: 'back', part: 'back' }).length, 0);
  const front = paintedRects(cape, { view: 'back', part: 'front' });
  assert.ok(front.length > 10, '背面披风应该展开成一整块布料');
});

test('侧面配饰只做整数平移，不做非均匀缩放', () => {
  const context = createDrawingContext();
  const item = PET_APPEARANCE_ITEMS.find(item => item.renderKey === 'crown');
  const appearance = projectAppearance({
    skin: 'crown', level: 1, view: 'profile', items: PET_APPEARANCE_ITEMS,
    itemIds: [item.id], includeLocked: true
  });
  drawAppearanceLayer(context, appearance, ['#000', '#111', '#f7768e'], { layer: 'front' });
  assert.equal(context.calls.some(call => call[0] === 'scale'), false,
    '侧面不得对配饰做 scale；非均匀缩放会把像素宽度变成小数');
  for (const call of context.calls) {
    if (call[0] !== 'translate') continue;
    assert.ok(Number.isInteger(call[1]) && Number.isInteger(call[2]),
      `平移必须是整数：${JSON.stringify(call)}`);
  }
});

test('帽子在场时光环整体抬高，不与帽冠堆成糖霜蛋糕', () => {
  const lowest = appearance => Math.max(...appearance.map(rect => rect.y + rect.height));
  const haloOnly = PET_APPEARANCE_ITEMS.find(item => item.renderKey === 'halo');
  const alone = paintedRects(haloOnly, { view: 'front' });

  const withHat = projectAppearance({
    skin: 'pink', level: 12, view: 'front', items: PET_APPEARANCE_ITEMS
  });
  assert.ok(withHat.items.some(item => item.exclusiveGroup === 'headwear'));
  const context = createDrawingContext();
  drawAppearanceLayer(context, withHat, ['#000', '#111', '#f7768e'], { layer: 'front' });
  const haloRects = context.calls
    .filter(call => call[0] === 'fillRect' && call[2] < -16)
    .map(call => ({ y: call[2], height: call[4] }));
  assert.ok(haloRects.length, '帽子在场时光环应该被抬到帽冠之上');
  assert.ok(lowest(haloRects) < lowest(alone),
    '带帽时光环未抬高，仍会与帽冠重叠');
});

// 头顶是唯一会被多件配饰争抢的位置。只要帽类与光环的纵向区间相交，
// 就会变成“金环叠金冠”的糖霜蛋糕；帽类每改高度都需要重新验这一条。
function verticalSpan(rects) {
  return {
    top: Math.min(...rects.map(rect => rect.y)),
    bottom: Math.max(...rects.map(rect => rect.y + rect.height))
  };
}

test('每套皮肤满级时，帽类与光环的纵向区间不相交', () => {
  const skins = ['pink', 'forest', 'ocean', 'sakura', 'moon', 'flame', 'crown', 'robot', 'woodsman', 'bat'];
  const halo = PET_APPEARANCE_ITEMS.find(item => item.renderKey === 'halo');
  for (const skin of skins) {
    const outfit = projectAppearance({ skin, level: 30, view: 'front', items: PET_APPEARANCE_ITEMS });
    const hat = outfit.items.find(item => item.exclusiveGroup === 'headwear');
    assert.ok(hat, `${skin} 满级时应该有一顶帽`);
    assert.ok(outfit.items.some(item => item.id === halo.id), `${skin} 满级时应该有光环`);

    const context = createDrawingContext();
    drawAppearanceLayer(context, outfit, ['#000', '#111', '#f7768e'], { layer: 'front' });
    // 帽子的体量主要在 back 部件（帽冠），front 部件只是额前那条帽檐；
    // 只量 front 会把这条断言变成空抖，必须合并两层才算帽冠的真实顶部。
    const hatSpan = verticalSpan(paintedRects(hat, { view: 'front' }));
    const haloSpan = verticalSpan(paintedRects(halo, { view: 'front', part: 'front' }));
    const lifted = { top: haloSpan.top - HEAD_LIFT, bottom: haloSpan.bottom - HEAD_LIFT };
    assert.ok(lifted.bottom <= hatSpan.top,
      `${skin}：光环[${lifted.top},${lifted.bottom}] 与 ${hat.id}[${hatSpan.top},${hatSpan.bottom}] 重叠`);
    // 抬高后仍需落在舞台安全区内，否则光环会被画布边缘直接裁掉。
    assert.ok(lifted.top >= -40, `${skin}：光环抬到 ${lifted.top}，超出了 bleed 40`);
  }
});

// 每件配饰的 bleed 是它向舞台安全区申报的占位。它一直只是注释里的估算，
// 于是“改了像素画忘了改申报”不会被任何检查拦住 —— 这条把申报钉在真实落点上。
test('配饰申报的 bleed 覆盖四个视角的真实落点，且不超过舞台安全区', () => {
  const STAGE_BLEED = 40;
  const BODY = 66;
  for (const item of PIXEL_ITEMS) {
    // 单件投影时帽子不在场，合成层不会抬高光环；申报必须按最坏情况（已抬高）算。
    const lift = item.exclusiveGroup === 'head-aura' ? HEAD_LIFT : 0;
    const used = { left: 0, top: 0, right: 0, bottom: 0 };
    for (const view of PET_APPEARANCE_VIEWS) {
      for (const rect of paintedRects(item, { view })) {
        used.left = Math.max(used.left, -rect.x);
        used.top = Math.max(used.top, lift - rect.y);
        used.right = Math.max(used.right, rect.x + rect.width - BODY);
        used.bottom = Math.max(used.bottom, rect.y + rect.height - BODY);
      }
    }
    for (const side of ['left', 'top', 'right', 'bottom']) {
      assert.ok(item.bleed[side] >= used[side],
        `${item.id} 的 ${side} bleed 申报 ${item.bleed[side]}，实际用到 ${used[side]}`);
      assert.ok(item.bleed[side] <= STAGE_BLEED,
        `${item.id} 的 ${side} bleed 申报 ${item.bleed[side]} 超过舞台安全区 ${STAGE_BLEED}`);
    }
  }
});


// 新侧身原稿保留前后两脚；配饰必须贴住两只真实脚，背鳍仍在朝向右时的左后侧。
// 两脚的独立附着矩阵与身体交集另由 dango-wardrobe.test.js 检查。
// 只取≥ 4px 宽的矩形（配饰本体），滤掉 boots-sparkle 效果那两个 2×2 的光点。
test('profile 配饰对齐新侧身：前后两靴、背鳍走背侧', () => {
  const byId = id => PET_APPEARANCE_ITEMS.find(item => item.id === id);
  const bodyRects = rects => rects.filter(r => r.width >= 4);
  const span = rects => {
    const solid = bodyRects(rects);
    const minX = Math.min(...solid.map(r => r.x));
    const maxX = Math.max(...solid.map(r => r.x + r.width));
    return maxX - minX;
  };
  const centroidX = rects => {
    const solid = bodyRects(rects);
    return solid.reduce((sum, r) => sum + r.x + r.width / 2, 0) / solid.length;
  };

  // 新侧视图前后两只脚分开站立，靴子的总体宽度须保留两脚、又不越出身体宽度。
  const bootProfileWidth = span(paintedRects(byId('milestone.boots'), { view: 'profile' }));
  const bootFrontWidth = span(paintedRects(byId('milestone.boots'), { view: 'front' }));
  assert.ok(bootProfileWidth >= 28 && bootProfileWidth <= 40, `profile 两靴跨度 ${bootProfileWidth}，应贴合前后两脚`);
  assert.ok(bootFrontWidth > 30, `front 仍应是两只鞋（跨度更大），实测 ${bootFrontWidth}`);

  // 背鳍长在“背”侧：团子朝右时背在左，profile 质心应偏中轴（33）左侧，正面则在右侧。
  const finProfile = paintedRects(byId('skin.ocean-fin'), { view: 'profile' });
  const finFront = paintedRects(byId('skin.ocean-fin'), { view: 'front' });
  assert.ok(finProfile.length > 0 && finFront.length > 0, '背鳍两个视角都应有落笔');
  assert.ok(centroidX(finProfile) < 33, `profile 背鳍质心 x=${centroidX(finProfile).toFixed(1)}，应偏背侧（<33）`);
  assert.ok(centroidX(finFront) > 33, `front 背鳍质心 x=${centroidX(finFront).toFixed(1)}，应偏右（>33），确保只改了侧身`);
});
