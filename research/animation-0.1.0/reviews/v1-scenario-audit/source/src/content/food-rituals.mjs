// Reconstructed local presentation, not recovered historical wording/timing.
// Uses existing finite expression/action IDs; no new art or productivity effect.
import { FOOD_ORDER } from './food-progression.mjs';

const DESCRIPTIONS = Object.freeze({
  basic: ['热乎乎的一小碗', '慢慢吃完了', '这会儿刚刚好'],
  berry: ['酸酸甜甜的一口', '小小的浆果很香', '把最后一颗吃完了'],
  carrot: ['咔嚓咔嚓', '这根胡萝卜很脆', '慢慢嚼完这一口'],
  rice: ['热乎乎的饭团', '小小一口很踏实', '把饭团吃完了'],
  milk: ['温温的一小杯', '小口喝完了', '杯子放回桌上'],
  fish: ['慢慢尝一口小鱼', '这一口很鲜', '小鱼吃完了'],
  bone: ['嘎嘣脆的一口', '抱着慢慢啃', '咔嚓咔嚓'],
  donut: ['圆圆的一圈点心', '这一口有点甜', '点心时间结束了'],
  coffee: ['暖暖的一小杯', '咖啡的香气飘起来了', '小口喝完了'],
  mushroom: ['尝一口新的味道', '小蘑菇软软的', '慢慢吃完了'],
  cake: ['留了一小块蛋糕', '这一口甜甜的', '把盘子放回桌上']
});
const FOOD_RITUALS = Object.freeze(Object.fromEntries(FOOD_ORDER.map(id => [id, Object.freeze({
  durations: Object.freeze([450, 850, 2200]),
  expressions: Object.freeze(['react.surprised', 'react.hungry', 'react.satisfied']),
  actionId: id === 'milk' || id === 'coffee' ? 'sip-tea' : 'snack-picnic',
  lines: Object.freeze(DESCRIPTIONS[id]),
  favoriteLine: '是最喜欢的味道，慢慢吃完了'
})])));
function foodRitual(foodId) { return Object.hasOwn(FOOD_RITUALS, foodId) ? FOOD_RITUALS[foodId] : FOOD_RITUALS.basic; }
function appetiteLabel(satiation) {
  const value = Number.isFinite(satiation) ? satiation : 65;
  return value <= 45 ? '有点饿了' : value <= 75 ? '刚刚好' : '吃得很满足';
}
export { FOOD_RITUALS, foodRitual, appetiteLabel };
