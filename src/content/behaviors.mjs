'use strict';

import * as expressionLibrary from './expressions.mjs';

const petBehaviorApi = (() => {
const petBehaviorExpressionSource = expressionLibrary;
const { EXPECTED_EXPRESSION_IDS } = petBehaviorExpressionSource;
const BEHAVIOR_EXPRESSION_IDS = Object.freeze({
  workout: 'work.ready',
  'chase-butterfly': 'life.attentive',
  hiccup: 'react.surprised',
  juggle: 'react.happy',
  'carry-energy': 'work.starting',
  'pit-fall': 'react.surprised',
  'mirror-meet': 'life.attentive',
  sing: 'react.happy',
  'stuck-corner': 'life.peek',
  'chase-laser': 'life.attentive',
  'dig-treasure': 'life.attentive',
  yawn: 'life.drowsy',
  sneeze: 'react.surprised',
  'bubble-blow': 'react.happy',
  meditate: 'life.space',
  wave: 'react.happy',
  stretch: 'react.relieved',
  'happy-hop': 'react.happy',
  'high-five': 'react.happy',
  spin: 'react.happy',
  dance: 'react.celebrate',
  'look-around': 'life.space',
  'tail-wiggle': 'react.happy',
  'read-book': 'work.focus',
  'take-note': 'life.attentive',
  'type-keyboard': 'work.deep-focus',
  'sip-tea': 'work.rest',
  'paper-plane': 'work.switch',
  sweep: 'work.wrap-up',
  'magic-trick': 'react.surprised',
  telescope: 'life.space',
  'plant-water': 'react.encouraging',
  'knit-scarf': 'work.deep-focus',
  'drum-solo': 'react.happy',
  moonwalk: 'react.happy',
  'hide-box': 'life.peek',
  'build-blocks': 'work.focus',
  'catch-star': 'react.surprised',
  'umbrella-dance': 'react.happy',
  'snack-picnic': 'react.satisfied',
  'shadow-box': 'work.ready',
  'tiny-chef': 'work.focus',
  'photo-pose': 'life.attentive'
});

function action(id, name, motion, prop, effect, lines, options = {}) {
  return Object.freeze({
    id, name, motion, prop, effect, lines, expression: BEHAVIOR_EXPRESSION_IDS[id],
    duration: options.duration || 8_000,
    kind: options.kind || 'attention',
    familyId: options.familyId || 'attention.performance',
    weight: options.weight || 500,
    priority: options.priority || 20,
    focusAllowed: options.focusAllowed === true,
    discoveryId: options.discoveryId || null,
    staticProgress: Number.isFinite(options.staticProgress) ? options.staticProgress : 0.5,
    desc: options.desc || name
  });
}

const PET_ACTIONS = Object.freeze({
  workout: action('workout', '突然健身', 'pushup', 'headband', 'sweat', ['一二一二，小短腿也要锻炼！', '俯卧撑进行中，帮我数到八！', '今天的像素肌肉也上线啦。'], { duration: 8_500, familyId: 'attention.motion', weight: 800 }),
  'chase-butterfly': action('chase-butterfly', '追蝴蝶', 'dash', 'butterfly', 'petals', ['蝴蝶等等，我只追一小圈！', '左边！右边！差一点抓到啦。', '没抓到也没关系，它飞得真好看。'], { duration: 9_000, familyId: 'attention.motion', weight: 650 }),
  hiccup: action('hiccup', '打嗝', 'hiccup', 'cup', 'bubbles', ['嗝……刚才那口空气太大了。', '等一下，嗝还没有走远。', '嗝！假装什么都没发生。'], { duration: 6_500, familyId: 'attention.expression', weight: 900 }),
  juggle: action('juggle', '耍杂技', 'juggle', 'balls', 'sparkles', ['三个球，一个都不能掉！', '欢迎观看桌角限定杂技。', '最后一下——稳稳接住！'], { duration: 9_000, weight: 560 }),
  'carry-energy': action('carry-energy', '搬运能量', 'carry', 'energy', 'sparks', ['借过借过，能量补给送达！', '这颗闪电有点重，但我搬得动。', '把一点亮晶晶的电量放在这里。'], { duration: 8_000, familyId: 'attention.motion', weight: 520 }),
  'pit-fall': action('pit-fall', '掉进小坑', 'fall', 'hole', 'dust', ['咦，桌面什么时候多了个坑？', '我没事，只是和地板打了个招呼。', '爬出来了！这次当作探险。'], { duration: 7_500, familyId: 'attention.motion', weight: 460 }),
  'mirror-meet': action('mirror-meet', '遇见镜像', 'mirror', 'mirror', 'glimmer', ['嗨，另一个我也在眨眼。', '镜子里的小家伙好像认识你。', '我们两个一起陪你一会儿。'], { duration: 9_000, weight: 430 }),
  sing: action('sing', '桌角演唱会', 'sway', 'microphone', 'notes', ['啦啦啦，桌角演唱会开场！', '这一句只唱给现在的你。', '跑调也不影响我认真唱完。'], { duration: 10_000, weight: 720 }),
  'stuck-corner': action('stuck-corner', '角落装睡', 'squish', 'ellipsis', 'puffs', ['我没有卡住，我只是在研究墙角。', '如果我不动，角落就发现不了我。', '好吧，研究结束，准备出来。'], { duration: 7_500, familyId: 'attention.motion', weight: 420 }),
  'chase-laser': action('chase-laser', '追逐光点', 'dash', 'laser', 'trail', ['那个小红点又跑掉了！', '绕一圈，这次一定追得上。', '光点停一下，我的小短腿很忙。'], { duration: 9_500, familyId: 'attention.motion', weight: 600 }),
  'dig-treasure': action('dig-treasure', '挖到收藏', 'dig', 'treasure', 'dust', ['这里有东西在发光，我挖挖看。', '找到一枚属于今天的小收藏！', '宝藏不是分数，是我们遇见的这一刻。'], { duration: 10_000, familyId: 'attention.discovery', weight: 430, discoveryId: 'builtin-core.dig-treasure', staticProgress: 0.75 }),
  yawn: action('yawn', '大大哈欠', 'stretch', 'sleep-cap', 'zzz', ['哈——欠，身体在提醒我慢一点。', '这个哈欠好长，差点把我卷进去。', '伸完懒腰，像素都摆整齐了。'], { duration: 7_000, kind: 'ambient', familyId: 'ambient.calm', weight: 1_300 }),
  sneeze: action('sneeze', '像素喷嚏', 'recoil', 'tissue', 'puffs', ['阿——嚏！像素都抖了一下。', '没关系，只是一个很响的小喷嚏。', '纸巾收到，我又精神啦。'], { duration: 6_500, familyId: 'attention.expression', weight: 780 }),
  'bubble-blow': action('bubble-blow', '吹泡泡', 'float', 'bubble-wand', 'bubbles', ['看，这个泡泡装下了一小片彩虹。', '再吹一个，让它慢慢飘远。', '最大的这颗留给你。'], { duration: 9_000, weight: 650 }),
  meditate: action('meditate', '安静打坐', 'breathe', 'cushion', 'halo', ['吸气，呼气，我们一起慢一点。', '安静坐一会儿，不需要想明白什么。', '这一小片平静先放在桌角。'], { duration: 10_000, kind: 'ambient', familyId: 'ambient.calm', weight: 1_100, focusAllowed: true }),
  wave: action('wave', '认真挥手', 'wave', 'none', 'hearts', ['看到你啦，我认真挥个手！', '嗨——今天也在同一张桌面见面。', '这只小手专门负责欢迎你回来。'], { duration: 7_000, kind: 'ambient', familyId: 'ambient.social', weight: 1_100 }),
  stretch: action('stretch', '全身伸展', 'stretch', 'none', 'sparkles', ['手臂向上，像素也要伸展开。', '跟我一起把肩膀慢慢放松。', '伸到最高，再轻轻落下来。'], { duration: 8_000, kind: 'ambient', familyId: 'ambient.calm', weight: 1_000, focusAllowed: true }),
  'happy-hop': action('happy-hop', '开心蹦跳', 'hop', 'none', 'stars', ['突然想蹦两下，咚、咚！', '今天的地板弹性刚刚好。', '小小开心也值得跳起来。'], { duration: 7_500, familyId: 'attention.motion', weight: 850 }),
  'high-five': action('high-five', '开心击掌', 'high-five', 'high-five', 'sparkles', ['手举高——啪！击掌成功。', '这一掌接得刚刚好！', '默契收到，今天也一起加油。'], { duration: 7_000, familyId: 'attention.social', weight: 500, staticProgress: 0.5 }),
  spin: action('spin', '原地转圈', 'spin', 'none', 'stars', ['转一圈，把杂念甩到身后。', '看好啦，这是我的像素陀螺！', '有一点晕，但这一圈很完整。'], { duration: 7_000, familyId: 'attention.motion', weight: 670 }),
  dance: action('dance', '音乐摇摆', 'dance', 'music-notes', 'notes', ['音乐来了，左右踏两步！', '小手举起来，跟着节拍摇一摇。', '最后一个拍子，稳稳收住。'], { duration: 8_500, familyId: 'attention.performance', weight: 620, staticProgress: 0.25 }),
  'look-around': action('look-around', '左右张望', 'look', 'binoculars', 'glimmer', ['左边看看，右边也没有漏掉。', '桌面巡逻完成，目前一切正常。', '我好像听见一个灵感从旁边经过。'], { duration: 8_500, kind: 'ambient', familyId: 'ambient.curious', weight: 1_050 }),
  'tail-wiggle': action('tail-wiggle', '开心摇尾巴', 'wag', 'tail', 'hearts', ['尾巴先知道我很高兴。', '摇得这么快，是因为看见你啦。', '今天的开心藏不住，尾巴暴露了。'], { duration: 7_500, kind: 'ambient', familyId: 'ambient.social', weight: 950 }),
  'read-book': action('read-book', '认真读书', 'read', 'book', 'letters', ['这一页讲到哪里了？我做个小书签。', '安静读两页，故事正在打开。', '遇到不懂的字，我先画一颗星。'], { duration: 11_000, kind: 'ambient', familyId: 'ambient.work', weight: 900, focusAllowed: true }),
  'take-note': action('take-note', '记下这一句', 'write', 'document', 'none', ['我记着。', '记好了。', '这一句收好了。'], { duration: 11_000, kind: 'ambient', familyId: 'ambient.work', focusAllowed: true }),
  'type-keyboard': action('type-keyboard', '键盘冲浪', 'type', 'keyboard', 'code', ['哒哒哒，我来敲一小段草稿。', '先把第一版打出来，再慢慢修改。', '键盘声音很密，但我只写眼前一行。'], { duration: 10_000, kind: 'ambient', familyId: 'ambient.work', weight: 920, focusAllowed: true }),
  'sip-tea': action('sip-tea', '喝口热茶', 'sip', 'cup', 'steam', ['小口喝茶，热气把节奏放慢了。', '这杯温度正好，你也要补水吗？', '咕噜一口，再把杯子稳稳放下。'], { duration: 9_000, kind: 'ambient', familyId: 'ambient.calm', weight: 1_050, focusAllowed: true }),
  'paper-plane': action('paper-plane', '放纸飞机', 'glide', 'plane', 'trail', ['把一个小念头折成纸飞机。', '飞吧，落在哪里都算一次探索。', '它绕过窗口，又回到桌边啦。'], { duration: 9_500, familyId: 'attention.motion', weight: 610 }),
  sweep: action('sweep', '清扫桌面', 'sweep', 'broom', 'dust', ['扫一扫，把散落的像素收整齐。', '桌角清爽一点，脑袋也透气一点。', '最后一小堆灰尘，送它出门。'], { duration: 9_000, kind: 'ambient', familyId: 'ambient.work', weight: 780 }),
  'magic-trick': action('magic-trick', '像素魔术', 'magic', 'hat', 'sparkles', ['帽子里会变出什么？先保密。', '三、二、一——一颗像素星！', '魔术结束，但亮晶晶还会留一会儿。'], { duration: 10_000, familyId: 'attention.performance', weight: 520 }),
  telescope: action('telescope', '观察星星', 'telescope', 'telescope', 'stars', ['那颗星好像也在看我们。', '把远处拉近一点，今晚很清楚。', '我找到一颗会慢慢闪的星。'], { duration: 11_000, kind: 'ambient', familyId: 'ambient.curious', weight: 720 }),
  'plant-water': action('plant-water', '给小苗浇水', 'water', 'watering-can', 'leaves', ['一小口水，够小苗慢慢长。', '今天的新叶子比昨天亮一点。', '照顾成长不用催，它有自己的速度。'], { duration: 10_000, kind: 'ambient', familyId: 'ambient.calm', weight: 820 }),
  'knit-scarf': action('knit-scarf', '织像素围巾', 'knit', 'yarn', 'thread', ['一针一针，围巾正在变长。', '这段颜色留给今天的心情。', '织歪一点也很可爱，继续接上。'], { duration: 12_000, kind: 'ambient', familyId: 'ambient.craft', weight: 620 }),
  'drum-solo': action('drum-solo', '迷你鼓点', 'drum', 'drum', 'notes', ['咚哒咚哒，桌面节拍来了！', '这一小段鼓点替你赶走困意。', '最后一下——咚！谢谢收听。'], { duration: 9_000, familyId: 'attention.performance', weight: 560 }),
  moonwalk: action('moonwalk', '月球漫步', 'moonwalk', 'sparkle-shoes', 'trail', ['向前看，脚步却悄悄往后走。', '这是桌面限定版月球漫步。', '滑完这一段，我稳稳回到原位。'], { duration: 9_000, familyId: 'attention.motion', weight: 500 }),
  'hide-box': action('hide-box', '躲进纸箱', 'hide', 'box', 'puffs', ['只要藏进箱子，就没人发现我。', '纸箱里很安全，还带一点纸香。', '我数到三就探头：一、二、三！'], { duration: 10_000, familyId: 'attention.expression', weight: 660 }),
  'build-blocks': action('build-blocks', '搭像素积木', 'build', 'blocks', 'sparkles', ['先放最下面这块，塔才站得稳。', '再加一层……这次没有倒！', '完成，一座桌角小城堡。'], { duration: 11_000, kind: 'ambient', familyId: 'ambient.craft', weight: 700 }),
  'catch-star': action('catch-star', '接住流星', 'reach', 'star', 'stars', ['那颗星掉下来了，我来接住！', '差一点，再伸高手一点点。', '接到了，先把愿望放在这里。'], { duration: 9_500, familyId: 'attention.motion', weight: 520 }),
  'umbrella-dance': action('umbrella-dance', '雨伞转舞', 'umbrella', 'umbrella', 'rainbow', ['下雨也可以转一圈小伞。', '雨点在伞面上敲出节拍。', '转完啦，给你留一道小彩虹。'], { duration: 10_000, familyId: 'attention.performance', weight: 480 }),
  'snack-picnic': action('snack-picnic', '桌角野餐', 'picnic', 'picnic', 'crumbs', ['铺好小毯子，桌角野餐开始。', '这一口慢慢吃，香味不会赶时间。', '给你也留了一块最漂亮的点心。'], { duration: 11_000, kind: 'ambient', familyId: 'ambient.calm', weight: 720 }),
  'shadow-box': action('shadow-box', '影子拳击', 'box', 'gloves', 'impact', ['左一下，右一下，空气接招！', '我不是生气，只是在练习小拳法。', '收拳、站稳，今天状态不错。'], { duration: 8_000, familyId: 'attention.motion', weight: 520 }),
  'tiny-chef': action('tiny-chef', '迷你料理', 'cook', 'pan', 'steam', ['小锅热起来，今天做像素浓汤。', '撒一点耐心，再放一颗小星星。', '完成啦，香味先给你尝尝。'], { duration: 11_000, familyId: 'attention.performance', weight: 540 }),
  'photo-pose': action('photo-pose', '拍照定格', 'pose', 'camera', 'flash', ['镜头看这里——三、二、一！', '这张要摆一个很有精神的姿势。', '拍好了，把今天的样子收藏起来。'], { duration: 8_000, familyId: 'attention.social', weight: 620 })
});

const EASTER_EGGS = Object.freeze(Object.values(PET_ACTIONS).map(item => Object.freeze({
  id: item.id,
  name: item.name,
  prob: item.weight / 100_000,
  duration: item.duration,
  desc: item.desc,
  lines: item.lines,
  kind: item.kind,
  familyId: item.familyId,
  priority: item.priority,
  focusAllowed: item.focusAllowed,
  discoveryId: item.discoveryId
})));

function validateBehaviorLibrary(actions = PET_ACTIONS, eggs = EASTER_EGGS) {
  const ids = Object.keys(actions);
  if (ids.length < 40 || eggs.length !== ids.length) throw new RangeError('at least 40 paired pet behaviors are required');
  if (Object.keys(BEHAVIOR_EXPRESSION_IDS).length !== ids.length
      || ids.some(id => !Object.prototype.hasOwnProperty.call(BEHAVIOR_EXPRESSION_IDS, id))) {
    throw new TypeError('every pet behavior must have one explicit expression mapping');
  }
  for (const [id, item] of Object.entries(actions)) {
    if (item.id !== id || item.duration < 6_000 || !item.motion || !item.effect || item.lines.length < 3
        || !Number.isFinite(item.staticProgress) || item.staticProgress < 0 || item.staticProgress > 1
        || !EXPECTED_EXPRESSION_IDS.includes(item.expression)) {
      throw new TypeError(`invalid pet behavior: ${id}`);
    }
  }
  return { actionCount: ids.length, minimumDurationMs: Math.min(...eggs.map(item => item.duration)) };
}

const BEHAVIOR_STATS = Object.freeze(validateBehaviorLibrary());

return {
  BEHAVIOR_EXPRESSION_IDS,
  BEHAVIOR_STATS,
  EASTER_EGGS,
  PET_ACTIONS,
  validateBehaviorLibrary
};

})();

export default petBehaviorApi;
export const BEHAVIOR_EXPRESSION_IDS = petBehaviorApi.BEHAVIOR_EXPRESSION_IDS;
export const BEHAVIOR_STATS = petBehaviorApi.BEHAVIOR_STATS;
export const EASTER_EGGS = petBehaviorApi.EASTER_EGGS;
export const PET_ACTIONS = petBehaviorApi.PET_ACTIONS;
export const validateBehaviorLibrary = petBehaviorApi.validateBehaviorLibrary;
