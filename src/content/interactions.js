'use strict';

const INTERACTIONS = Object.freeze({
  clickCount: Object.freeze({
    2: { emoji: '👀', text: '双击问候收到', effect: 'glimmer', action: 'look-around' },
    3: { emoji: '👋', text: '我看到你啦', effect: 'hearts', action: 'wave' },
    5: { emoji: '✨', text: '击掌 ×5', effect: 'sparkles', action: 'high-five' },
    8: { emoji: '🫧', text: '八颗泡泡飞起来', effect: 'bubbles', action: 'bubble-blow' },
    10: { emoji: '😊', text: '我们很有默契', effect: 'hearts', action: 'tail-wiggle' },
    15: { emoji: '🎵', text: '十五拍桌角节奏', effect: 'notes', action: 'drum-solo' },
    20: { emoji: '🎆', text: '小小像素烟花', effect: 'explode', action: 'spin' },
    30: { emoji: '🪄', text: '三十次召唤成功', effect: 'sparkles', action: 'magic-trick' },
    40: { emoji: '🌟', text: '接住第四十颗星', effect: 'stars', action: 'catch-star' },
    50: { emoji: '🏆', text: '陪你玩了一会儿', effect: 'confetti', action: 'photo-pose', xp: 0 }
  }),
  longPress: { text: '呼噜呼噜，慢慢摸一会儿', effect: 'purr', action: 'tail-wiggle', duration: 7_000 },
  fling: { text: '转一圈，稳稳着陆', effect: 'somersault', action: 'spin', duration: 7_000 },
  commands: Object.freeze([
    { id: 'focus', icon: '⚡', label: '开始专注' },
    { id: 'impulse', icon: '💭', label: '快速记录' },
    { id: 'panel', icon: '📋', label: '打开面板' },
    { id: 'dnd', icon: '🔕', label: '免打扰' },
    { id: 'hide', icon: '🏠', label: '隐藏伙伴' }
  ])
});

function validateInteractionLibrary(interactions = INTERACTIONS) {
  const milestones = Object.keys(interactions.clickCount).map(Number);
  if (milestones.length < 10 || interactions.commands.length !== 5) throw new RangeError('interaction library must expose five primary commands');
  if (new Set(interactions.commands.map(item => item.id)).size !== interactions.commands.length) throw new TypeError('duplicate menu command');
  if (Object.values(interactions.clickCount).some(item => (item.xp || 0) !== 0)) throw new TypeError('interaction content cannot promise progress XP');
  return { milestoneCount: milestones.length, commandCount: interactions.commands.length };
}

const INTERACTION_STATS = Object.freeze(validateInteractionLibrary());

module.exports = { INTERACTIONS, INTERACTION_STATS, validateInteractionLibrary };
