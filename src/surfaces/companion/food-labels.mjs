import { t } from '../shared/interface/i18n.mjs';

// Only the built-in catalog names are product copy. A different supplied name
// stays verbatim, even when it happens to match another interface message.
const NAMES = Object.freeze({ basic: '基础餐', fish: '小鱼', bone: '骨头', donut: '甜甜圈',
  coffee: '咖啡', carrot: '胡萝卜', mushroom: '蘑菇', rice: '饭团', milk: '牛奶', berry: '浆果', cake: '蛋糕' });
function foodName(id, name) { return NAMES[id] === name ? t(name) : name; }
export { foodName };
