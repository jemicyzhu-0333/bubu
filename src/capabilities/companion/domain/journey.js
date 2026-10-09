'use strict';

// Collections are earned from cumulative, persisted relationship facts. No
// streaks, timers or random drops; unlocked chapters survive a long absence.
const CHAPTERS = Object.freeze([
  { id: 'first-table', title: '同一张小桌', symbol: '01', focus: 0, tasks: 0, tastes: 1, letter: '桌上多了一份点心。我把旁边的位置留给你。', color: 'rose' },
  { id: 'first-light', title: '第一盏灯', symbol: '02', focus: 1, tasks: 1, tastes: 1, letter: '今天的灯亮过一次。你做事的时候，我也安静地坐了一会儿。', color: 'gold' },
  { id: 'pocket-map', title: '口袋里的地图', symbol: '03', focus: 5, tasks: 3, tastes: 2, letter: '我在小地图上画了几颗星。每一颗，都是我们走过的一小段。', color: 'mint' },
  { id: 'rain-window', title: '雨天的窗边', symbol: '04', focus: 12, tasks: 10, tastes: 3, letter: '下雨也没关系。窗边的垫子很软，等你回来再一起出发。', color: 'blue' },
  { id: 'garden', title: '慢慢长大的花园', symbol: '05', focus: 30, tasks: 25, tastes: 4, letter: '花园里又长出了新叶子。有些变化很慢，回头才看得见。', color: 'mint' },
  { id: 'night-train', title: '夜行小火车', symbol: '06', focus: 60, tasks: 50, tastes: 5, letter: '车票收好了，点心也带了。今晚这趟小火车，只开到想休息的地方。', color: 'blue' },
  { id: 'little-home', title: '我们的落脚处', symbol: '07', focus: 100, tasks: 100, tastes: 6, letter: '这里渐渐有了家的样子。你不在的时候，我也会替你留着这把椅子。', color: 'gold' },
  { id: 'long-road', title: '还很长的以后', symbol: '08', focus: 200, tasks: 200, tastes: 8, letter: '纪念册已经厚厚一本。最后一页先空着吧，以后还有好多小事可以记。', color: 'rose' }
].map(Object.freeze));

function projectJourney(relationship) {
  const counters = relationship.counters || {};
  const facts = { focus: counters['focus-complete'] || 0, tasks: counters['task-complete'] || 0,
    tastes: Object.entries(relationship.foodAffinity || {}).filter(([id, count]) => id !== 'basic' && count > 0).length };
  const labels = { focus: '专注', tasks: '完成任务', tastes: '尝过的口味' };
  const chapters = CHAPTERS.map(chapter => {
    const requirements = Object.keys(facts).filter(key => chapter[key] > 0).map(key => ({
      id: key, label: labels[key], current: facts[key], target: chapter[key]
    }));
    const unlocked = relationship.milestones.includes(`journey-${chapter.id}`)
      || requirements.every(item => item.current >= item.target);
    const percent = unlocked ? 100 : Math.floor(requirements.reduce((sum, item) => sum + Math.min(1, item.current / item.target), 0) / requirements.length * 100);
    return { id: chapter.id, title: chapter.title, symbol: chapter.symbol, color: chapter.color,
      unlocked, percent, requirements, letter: unlocked ? chapter.letter : null };
  });
  return { facts, chapters, earned: chapters.filter(item => item.unlocked).length, next: chapters.find(item => !item.unlocked) || null };
}

function projectTastes(affinity, foods) {
  return Object.entries(foods || {}).filter(([id]) => id !== 'basic').map(([id, food]) => {
    const count = affinity[id] || 0;
    const target = count >= 8 ? null : count >= 3 ? 8 : count >= 1 ? 3 : 1;
    return { id, name: food.name, emoji: food.emoji, count, target,
      label: count >= 8 ? '常备点心' : count >= 3 ? '熟悉的味道' : count >= 1 ? '初次尝到' : '未尝过' };
  });
}
module.exports = { CHAPTERS, projectJourney, projectTastes };
