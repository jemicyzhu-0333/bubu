const { classifyWorkPeriod } = require('./work-period.mjs');

// ================================================================
// 小步 v0.1.0 — Pet Content Library
// ADHD-friendly, autonomy-supportive lines + easter eggs + scene decorators
// ================================================================

// 时段（跟随用户工作时间，默认 10:00 - 21:00）
// morning = 上班前；forenoon = 开工黄金段；noon = 午休；
// afternoon = 下午；evening = 收工前后；night = 下班后
function getTimePeriod(hour, workStart = 10, workEnd = 21) {
  return classifyWorkPeriod(hour, workStart, workEnd);
}

// 台词库 (600+ 条)
const LINES = {
  // 按时段
  time: {
    lateNight: [
      '已经很晚了，要不要先存个落点？',
      '现在收尾，明天也能轻松接上',
      '夜深了，我安静陪你',
      '如果身体累了，可以随时停下',
      '想休息的话，先记下下一步就好',
      '有灵感就记一句，不用今晚做完',
      '来杯温水怎么样',
      '困了就休息，任务会在这里',
      '现在不需要证明什么',
      '睡眠也是照顾执行功能的一部分',
      '收尾和继续，都由你决定',
      '深夜适合小步收尾',
      '眼睛累了，可以看看远处',
      '静静的夜，把节奏放慢一点',
      '今晚月色真美'
    ],
    morning: [
      '早安！新的一天',
      '起来了？喝口水先',
      '如果此刻清醒，可以留给一件重要的事',
      '今天想搞定啥？',
      '朝阳很棒，你也是',
      '有雾的早晨最适合思考',
      '早一点或晚一点开始都可以',
      '今天感觉如何？',
      '选一个小动作，开始新一天',
      '先看消息还是先选任务，由你决定',
      '第一件事做什么好？',
      '早晨的仪式感很重要',
      '深呼吸，准备好再开始',
      '早安人类',
      '醒来本身就是第一步'
    ],
    forenoon: [
      '上午可以试试一个清晰的小目标',
      '现在的能量，适合哪种任务？',
      '如果愿意，先碰一下有挑战的部分',
      '还在热身也没关系',
      '可以把手机放远一点，也可以先打开文件',
      '让脑子飞一会儿',
      '不用塞满这段时间',
      '状态不错，先走一小步',
      '按自己的节奏来',
      '不必要的会议，可以晚点再决定',
      '现在做重要不紧急的',
      '好状态可以用来做重要的事，也可以留些余量',
      '来一杯咖啡？',
      '大脑似乎正在慢慢进入状态',
      '这时候容易进入心流'
    ],
    noon: [
      '午饭时间！',
      '记得吃饭',
      '如果方便，给午饭留点空间',
      '可以感受一下饿饱和口渴',
      '吃点好的吧',
      '午睡 20 分钟大脑重启',
      '换个地方吃饭，也许会更放松',
      '出去走走再回来',
      '这个点会有点困',
      '除了咖啡，晒晒太阳也是一个选项',
      '你今天吃了什么？',
      '午后大脑要休息',
      '一顿好饭治愈一切',
      '饭盒也可以顺手带上',
      '什么时候吃，按你的节奏来'
    ],
    afternoon: [
      '午后疲惫期',
      '不舒服时，休息是可以选的',
      '起来伸个懒腰',
      '会不会有点困？',
      '午后状态起伏很常见',
      '做机械性任务比较合适',
      '重决策也可以留到更有余量时',
      '喝水的最佳时机',
      '眼睛看看远方',
      '下午茶时间',
      '起来走两步吧',
      '会议要来了吗？',
      '如果已经很费力，可以换小一点',
      '这时候适合整理归档',
      '午后回消息刚好'
    ],
    evening: [
      '傍晚了',
      '今天有哪一小步值得记下？',
      '要不要开始收尾？',
      '整理明天要做的',
      '天变黑得越来越早',
      '收工前可以只做一个小收尾',
      '给休息留一点余量',
      '晚饭吃啥？',
      '到点停下也是完成',
      '灯光暗一点保护眼睛',
      '傍晚适合复盘',
      '晚上有约吗？',
      '今天辛苦你了',
      '差不多了，可以收好今天',
      '晚安的号角吹响'
    ],
    night: [
      '晚上好',
      '如果工作时间结束了，可以切换到休息',
      '夜生活开始了',
      '记得洗澡',
      '屏幕看够了，就让眼睛歇会儿',
      '今天也许用了不少能量',
      '睡前放松一下',
      '休闲时间也可以有一个舒服的落点',
      '想睡时，可以把手机放到顺手外的地方',
      '明早再看消息',
      '一杯温水好眠',
      '写点小结再睡',
      '深夜的思绪可以先记下，明天再判断',
      '今天的经历已经足够',
      '晚安啊'
    ]
  },

  // 按状态
  state: {
    idle: [
      '安静待机中...', '需要我做什么？', '陪你就好',
      'zzz? 我没睡', '需要时叫我就好', '(安静发呆)',
      '想说话吗？', '我安静待在这里', '这里挺舒服',
      '~♪ ~♫', '突然想吃饼干', '桌面是正在使用的样子'
    ],
    walking: [
      '溜达溜达', '走走停停', '这里的地板真好',
      '换个位置看看', '腿有点酸', '巡视我的领地',
      '我去旁边看看', '~♪~', '前面有什么？',
      '找灵感中', '换换风景', '啦啦啦'
    ],
    sleeping: [
      'zzz... 安静休息中', '梦里没有待办', '再睡 5 分钟',
      '梦见一片云...', '(打呼)', '先充会儿电',
      'zzz 你也可以休息', '梦到一个很舒服的下午',
      '嘘...', '被你看到了', '留一盏小灯', 'z z Z'
    ],
    focused: [
      '我在这里陪你', '只做眼前这一小步', '安静共工中',
      '不用做完，先往前一点', '当前干扰值：0', '已经开始了',
      '我给你加 buff', '锁定下一个动作', '一步一步来',
      '卡住也没关系，可以再缩小一点', '每次回来都算数',
      '想到其他事就先放进闪念盒子'
    ],
    resting: [
      '歇会儿吧', '休息不需要先挣到', '喝口水吧？',
      '大脑正在整理', '深呼吸 3 次', '看看远方 20 秒',
      '伸个懒腰吧', '轻轻活动一下肩颈', '可以离开屏幕一会儿',
      '休息就是休息，不用为了更多产出', '躺一会儿也行',
      '休息不是浪费时间'
    ],
    celebrating: [
      '这一步完成了', '停下来感受一下', '你把它往前推了一点',
      '开始过，就值得记录', '给这一步一枚小勋章', '这次投入已经记下了',
      '做到这里就很好', '本轮完成', '落点已保存',
      '记住这个可以再次开始的落点', '小步也会累积', '现在休息或继续都可以'
    ],
    hungry: [
      '要不要一起做个小动作？', '先喝口水也很好',
      '今天的能量怎么样？', '不着急，先照顾状态', '要来点心吗？',
      '2 分钟的小事也算', '光是打开文档也是开始',
      '卡住了就再缩小一步', '休息好了我们再来',
      '今天回来了就值得庆祝', '需要我安静陪你吗？'
    ],
    dragged: [
      '慢一点就好', '要飞起来啦', '~~~',
      '咦！', '绕了一圈', '带我去哪',
      '我在学着飞', '先落地啦', '转圈中',
      '换了个新位置', 'wheee', '新视角'
    ],
    talking: ['我们聊聊？'],
    // 探头（peeking）
    peeking: [
      '嗨~', '嗨', '你在找我？',
      '我在这', '看到我了吗', 'boo!',
      '嘿嘿', 'peek-a-boo!', '要说话吗',
      '嘿嘿'
    ]
  },

  // 能量水位
  energy: {
    excellent: [
      '当前能量估计较高', '可以选一件重要的事',
      '如果愿意，现在可以碰一下挑战', '难题也可以只做第一步',
      '把余量留给真正重要的事', '也可以保留一部分能量'
    ],
    good: [
      '当前能量估计较充足', '这个节奏很舒服',
      '进度正在往前', '可以按现在的路线走',
      '计划可以随状态调整', 'nice pace'
    ],
    medium: [
      '当前能量估计适中',
      '大任务可以再切小一点', '要不要选个 15 分钟的？',
      '不高不低刚刚好', '按舒服的速度前进',
      '中等难度只是一个参考'
    ],
    low: [
      '当前能量估计较低', '可以选一个容易开始的',
      '整理归档是一个选项', '重决策可以稍后再做',
      '回一封邮件就算一步', '低耗任务会更好启动'
    ],
    empty: [
      '当前能量估计很低', '可以先停一停',
      '眼睛需要离开屏幕一会儿吗？', '可以听听身体的信号',
      '休息是合理的下一步', '如果愿意，先存落点再离开'
    ]
  },

  // 特殊时刻
  special: {
    monday: ['周一早安！新周开始', '新一周，先选一小步'],
    friday: ['周五啦', '今天也可以留些余量', '晚上的放松不需要先挣到'],
    weekend: ['周末啦！', '放松或安排一件小事都可以'],
    newYear: ['新年快乐', '新的一年也可以慢慢来'],
    birthday: ['生日快乐！', '为你放烟花'],
    rain: ['外面下雨，正好待着', '雨声适合专注'],
    // 隐藏
    threethirtythree: ['3:33...夜很安静', '如果需要，可以先收尾休息'],
    fivehundred: ['已经累积 500 XP', '分数只是记录，不是价值证明'],
    afterMidnight: ['已经过了零点，可以照顾一下身体', '把下一步记下，明天会更好接上']
  },

  // 探头时说的
  peek: [
    '嗨~ 需要什么？',
    '在这呢！',
    '需要我陪一会儿吗？',
    '我出来啦',
    '找我有事？',
    '嗨嗨嗨',
    '哇，被发现了',
    '要不要点专注？',
    '记个闪念？',
    '来打招呼啦'
  ],

  // 工作时间边界（默认 10:00 开工 / 21:00 收工）
  work: {
    start: [
      '开工啦！先挑一件事',
      '到点了，今天第一件做什么？',
      '可以先选一个清晰的下一步',
      '刚开始，先做一个容易启动的动作'
    ],
    end: [
      '到点收工，剩下的明天再说',
      '下班啦！今天够了',
      '今天到这里就足够了',
      '落点保存好，就可以安心离开'
    ],
    overtime: [
      '已经过了下班时间哦',
      '加班不会让你更值得肯定',
      '今晚必须做，还是明天再做？',
      '如果选择休息，先存一个落点就好'
    ]
  }
};

// 从多个候选中随机
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// 上下文化 —— 综合考虑时段/状态/能量/连击给一句话
function getContextualLine({ hour, state, energyLevel, workStart = 10, workEnd = 21 }) {
  const roll = Math.random();
  // 下班后还在干活：优先给一个收尾选项
  if (roll < 0.12 && hour >= workEnd && hour < 24 && state === 'focused') {
    return pick(LINES.work.overtime);
  }
  // 15% 概率说时段话
  if (roll < 0.15 && LINES.time[getTimePeriod(hour, workStart, workEnd)]) {
    return pick(LINES.time[getTimePeriod(hour, workStart, workEnd)]);
  }
  // 10% 概率说能量话
  if (roll < 0.25) {
    let band = 'medium';
    if (energyLevel >= 80) band = 'excellent';
    else if (energyLevel >= 60) band = 'good';
    else if (energyLevel >= 35) band = 'medium';
    else if (energyLevel >= 15) band = 'low';
    else band = 'empty';
    if (LINES.energy[band]) return pick(LINES.energy[band]);
  }
  // 5% 概率彩蛋
  if (roll < 0.40) {
    if (hour === 3 && new Date().getMinutes() >= 30 && new Date().getMinutes() < 36) {
      return pick(LINES.special.threethirtythree);
    }
    const day = new Date().getDay();
    if (day === 1) return pick(LINES.special.monday);
    if (day === 5) return pick(LINES.special.friday);
    if (day === 0 || day === 6) return pick(LINES.special.weekend);
  }
  // 剩余走状态话
  if (LINES.state[state]) return pick(LINES.state[state]);
  return pick(LINES.state.idle);
}

// ==============================================================
// 环境场景装饰粒子系统
// ==============================================================
const SCENE_DECORATIONS = {
  morning: [
    { type: 'sun', prob: 1, x: 20, y: 15, size: 20, color: '#e0af68' },
    { type: 'cloud', prob: 0.7, count: 2, speed: 0.2, color: '#c0caf5' },
    { type: 'bird', prob: 0.3, count: 1, speed: 1.2, color: '#7aa2f7' }
  ],
  forenoon: [
    { type: 'sun', prob: 1, x: 90, y: 20, size: 22, color: '#ffd558' },
    { type: 'cloud', prob: 0.5, count: 1, speed: 0.15, color: '#c0caf5' }
  ],
  noon: [
    { type: 'butterfly', prob: 0.8, count: 2, speed: 0.6, color: '#f7768e' },
    { type: 'petal', prob: 0.5, count: 3, speed: 0.5, color: '#ffb3c8' }
  ],
  afternoon: [
    { type: 'plane', prob: 0.3, count: 1, speed: 1.5, color: '#c0caf5' },
    { type: 'dust', prob: 0.6, count: 8, speed: 0.1, color: '#e0af68' }
  ],
  evening: [
    { type: 'sunset', prob: 1, color: '#ff7a5c' },
    { type: 'dragonfly', prob: 0.5, count: 1, speed: 0.8, color: '#bb9af7' }
  ],
  night: [
    { type: 'moon', prob: 1, x: 90, y: 20, size: 18, color: '#c0caf5' },
    { type: 'star', prob: 1, count: 6, twinkle: true, color: '#e0af68' },
    { type: 'firefly', prob: 0.6, count: 3, speed: 0.4, color: '#9ece6a' }
  ],
  lateNight: [
    { type: 'moon', prob: 1, x: 20, y: 15, size: 20, color: '#bb9af7' },
    { type: 'star', prob: 1, count: 10, twinkle: true, color: '#c0caf5' },
    { type: 'bat', prob: 0.3, count: 1, speed: 1, color: '#414868' }
  ]
};

// 状态相关的场景增强
const STATE_SCENES = {
  focused: {
    codeRain: true,             // Matrix 字符雨
    energyBeam: true            // 头顶能量光柱
  },
  resting: {
    hotSpringBubbles: true,     // 温泉气泡
    sakuraFall: true            // 樱花飘
  },
  celebrating: {
    confettiBurst: true,        // 彩带
    fireworks: true,            // 烟花
    starExplosion: true         // 星星大爆炸
  },
  hungry: {
    snackThought: true          // 只做中性的点心提示，不用眼泪施压
  },
  sleeping: {
    zzzTrail: true,             // Z Z Z 轨迹
    dreamBubble: true           // 梦幻泡泡
  }
};

// 皮肤专属场景增强
const SKIN_SCENES = {
  forest: { leaves: true, greenSparkles: true },
  ocean: { bubblesUp: true, waves: true },
  sakura: { petalRain: true },
  moon: { starDust: true, glowRing: true },
  flame: { fireSparks: true, embers: true },
  crown: { goldGlitter: true },
  robot: { circuitLines: true, scanBeam: true },
  woodsman: { woodChips: true },
  bat: { fogMist: true, redEyes: true }
};

// ==============================================================
// 特殊行为彩蛋
// ==============================================================
const EASTER_EGGS = [
  { id: 'workout', name: '突然健身', prob: 0.008, duration: 3000, desc: '做几个俯卧撑' },
  { id: 'chase-butterfly', name: '追蝴蝶', prob: 0.006, duration: 5000, desc: '追一只飞过的蝴蝶' },
  { id: 'hiccup', name: '打嗝', prob: 0.01, duration: 2000, desc: '打嗝表情' },
  { id: 'juggle', name: '耍杂技', prob: 0.005, duration: 4000, desc: '抛球杂技' },
  { id: 'carry-energy', name: '扛能量', prob: 0.004, duration: 5000, desc: '扛着 ⚡ 走过屏幕' },
  { id: 'pit-fall', name: '掉小坑', prob: 0.004, duration: 2500, desc: '掉进坑再爬出来' },
  { id: 'mirror-meet', name: '遇镜像', prob: 0.003, duration: 4000, desc: '和镜像自己打招呼' },
  { id: 'sing', name: '唱歌', prob: 0.007, duration: 4000, desc: '唱歌音符飘出' },
  { id: 'stuck-corner', name: '装死角落', prob: 0.003, duration: 3000, desc: '卡在角落装死' },
  { id: 'chase-laser', name: '追激光', prob: 0.005, duration: 4000, desc: '追鼠标发出的光点' },
  { id: 'dig-treasure', name: '发现小补给', prob: 0.004, duration: 5000, desc: '发现一份每日小补给' },
  { id: 'yawn', name: '打哈欠', prob: 0.015, duration: 2000, desc: '大哈欠 + 眼泪' },
  { id: 'sneeze', name: '打喷嚏', prob: 0.008, duration: 1500, desc: 'HATCHOO!' },
  { id: 'bubble-blow', name: '吹泡泡', prob: 0.006, duration: 3500, desc: '吹一串泡泡' },
  { id: 'meditate', name: '打坐', prob: 0.005, duration: 5000, desc: '盘腿冥想' }
];

// ==============================================================
// 交互彩蛋
// ==============================================================
const INTERACTIONS = {
  // 点击 N 次触发
  clickCount: {
    3: { emoji: '👋', text: '我看到你啦' },
    5: { emoji: '✨', text: '击掌 ×5' },
    10: { emoji: '😊', text: '我们很有默契' },
    20: { emoji: '🎆', text: '小小像素烟花', effect: 'explode' },
    50: { emoji: '🏆', text: '陪你玩了一会儿', xp: 0 }
  },
  // 长按
  longPress: { text: '~♪ 舒服...', effect: 'purr' },
  // 拖动松开速度快
  fling: { text: '稳稳着陆', effect: 'somersault' }
};

// ==============================================================
// 喂食系统 —— 食物图鉴
// ==============================================================
const FOODS = {
  // Reconstructed basic meal: neutral local copy, no purchase or growth benefit.
  basic: {
    id: 'basic', emoji: '🍚', name: '基础餐',
    satiation: 30, rejectChance: 0,
    reactions: ['热乎乎的一小碗', '慢慢吃完了', '这会儿刚刚好'],
    animation: 'happy'
  },
  fish: {
    id: 'fish', emoji: '🐟', name: '小鱼',
    satiation: 15, rejectChance: 0,
    reactions: ['好吃！鲜！', '呜~ 就爱这个', '慢慢品尝', '🐟 咕嘟'],
    animation: 'happy'
  },
  bone: {
    id: 'bone', emoji: '🦴', name: '骨头',
    satiation: 10, rejectChance: 0,
    reactions: ['嘎嘣脆', '咬咬骨头舒服', '🦴 咔咔', '牙口好'],
    animation: 'chew'
  },
  donut: {
    id: 'donut', emoji: '🍩', name: '甜甜圈',
    satiation: 20, rejectChance: 0,
    reactions: ['甜！好开心！', '这口很满足', '一个就很好', '🍩💗'],
    animation: 'dance'
  },
  coffee: {
    id: 'coffee', emoji: '☕', name: '咖啡',
    satiation: 5, rejectChance: 0,
    reactions: ['☕ 暖暖的', '香气飘起来了', '小口喝一会儿', '暖暖的一小杯'],
    animation: 'happy'
  },
  carrot: {
    id: 'carrot', emoji: '🥕', name: '胡萝卜',
    satiation: 12, rejectChance: 0,
    reactions: ['脆脆的！', '颜色很漂亮', '🥕 胡萝卜时间', '咔嚓咔嚓'],
    animation: 'healthy'
  },
  mushroom: {
    id: 'mushroom', emoji: '🍄', name: '蘑菇',
    satiation: 15, rejectChance: 0,
    reactions: ['嗯...味道很特别', '今天想试试新口味', '这是什么啊', '慢慢尝一口'],
    reactionsReject: ['这次先不吃啦', '今天想换个口味', '留给下次吧', '(轻轻放回去)'],
    animation: 'shroom'
  },
  rice: {
    id: 'rice', emoji: '🍙', name: '饭团',
    satiation: 18, rejectChance: 0,
    reactions: ['踏实的一口', '手捏的很开心', '🍙 满满的', '吃完有力了'],
    animation: 'happy'
  },
  milk: {
    id: 'milk', emoji: '🥛', name: '牛奶',
    satiation: 12, rejectChance: 0,
    reactions: ['温温的很安心', '小口咽下去', '🥛 咕噜', '肩膀松下来了'],
    animation: 'happy'
  },
  berry: {
    id: 'berry', emoji: '🍓', name: '浆果',
    satiation: 8, rejectChance: 0,
    reactions: ['酸酸甜甜', '一口一个刚好', '🍓 亮亮的', '小小的奖励'],
    animation: 'healthy'
  },
  cake: {
    id: 'cake', emoji: '🍰', name: '蛋糕',
    satiation: 25, rejectChance: 0,
    reactions: ['今天值得庆祝', '好大一块！', '🍰 幸福', '我们一起吃'],
    animation: 'dance'
  }
};

module.exports = {
  LINES, SCENE_DECORATIONS, STATE_SCENES, SKIN_SCENES,
  EASTER_EGGS, INTERACTIONS, FOODS,
  getContextualLine, getTimePeriod, pick
};
