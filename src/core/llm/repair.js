'use strict';

// L3a：产物规范化。跑在校验之前，只做一件事——把“模型显然想表达对的东西，但用了
// 另一种编码约定”翻译成本地契约。
//
// 这一层存在的理由是一次真实事故：模型给出 dependsOn: [null,1,1,1,2]，按“依赖第 1
// 步”的人类编号在写；校验器要的是 0 起的数组下标，于是 steps[1] 变成自己依赖自己，
// 一份花了 13 秒、精准贴合用户处境的 5 步建议整份作废，界面上只剩“AI 未生效”。
//
// 判断哪些该修、哪些该继续硬拒的标准是：**它是产品承诺，还是纯编码约定。**
//   - 纯编码约定（索引从 0 还是 1 起、多余字段、数字写成字串）→ 在这里修掉。
//     模型答错这些不代表建议不可用，而用户看不见这些字段。
//   - 产品承诺（不改写标题、不扩张用户的标签词表、步数上限）→ 继续硬拒或裁掉，
//     绝不放宽。裁掉一个凭空造的标签同样履行了“不扩张词表”的承诺，
//     却不用把整份建议一起扔掉。

// 模型即使被要求只输出 JSON，也常把它裹进 ```json 围栏，或在前面加一句
// “好的，这是结果：”。裸 JSON.parse 会在这里失败，而失败的代价是整份回退。
const FENCE_PATTERN = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/;

function parseJsonObject(raw, maxBytes) {
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw !== 'string') throw new TypeError('proposal is not valid JSON');
  if (Number.isInteger(maxBytes) && Buffer.byteLength(raw, 'utf8') > maxBytes) {
    throw new RangeError(`proposal exceeds ${Math.round(maxBytes / 1024)} KB`);
  }
  const fenced = raw.match(FENCE_PATTERN);
  const unwrapped = fenced ? fenced[1] : raw;
  try { return JSON.parse(unwrapped); } catch (_) { /* fall through to brace slicing */ }
  // 围栏之外还可能有前后缀散文。取第一个 `{` 到最后一个 `}` 之间的部分——
  // 比正则拼 JSON 语法可靠，也比直接放弃有用。
  const start = unwrapped.indexOf('{');
  const end = unwrapped.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(unwrapped.slice(start, end + 1)); } catch (_) { /* genuinely unparseable */ }
  }
  throw new TypeError('proposal is not valid JSON');
}

// 多余字段被剔除而不是让整份作废。`additionalProperties: false` 是给模型的
// 约束，不是给我们自己的自毁开关：模型多送一个 `notes` 字段，不构成把它其余
// 答对的部分丢掉的理由。
function dropUnknownKeys(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const kept = {};
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(value, key)) kept[key] = value[key];
  }
  return kept;
}

function coerceInteger(value) {
  if (Number.isInteger(value)) return value;
  // "40" 和 40.0 都是模型在表达同一个整数。字串里带单位（"40 minutes"）则
  // 不猜——那是它没听懂字段，回灌错误比替它编一个数字好。
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
  if (typeof value === 'string' && /^\s*-?\d+(?:\.\d+)?\s*$/.test(value)) return Math.round(Number(value));
  return value;
}

// 枚举只放宽大小写和首尾空白。同义词不做映射：`"moderate"` 映成 `"medium"`
// 是我们在替模型下判断，而这个字段会直接决定用户看到的投入建议。
function coerceEnum(value, allowed) {
  if (typeof value !== 'string') return value;
  const normalized = value.trim().toLowerCase();
  return allowed.find(candidate => candidate.toLowerCase() === normalized) || value;
}

// 白名单之外的项被裁掉，而不是让整份作废。“不扩张用户的标签词表”这条承诺，
// 裁掉就已经兑现了。
function keepAllowed(list, allowed) {
  if (!Array.isArray(list)) return list;
  const permitted = new Set(allowed);
  const kept = [];
  for (const item of list) {
    const value = typeof item === 'string' ? item.trim() : item;
    if (permitted.has(value) && !kept.includes(value)) kept.push(value);
  }
  return kept;
}

// 1-based 检测。只在证据齐全时才整体减一，宁可不修也不能改错一份本来合法的答案：
//   1. 没有任何一个 dependsOn 是 0——出现 0 就说明模型本来在用 0 起的下标；
//   2. 至少有一个在 0-based 下非法（d >= 自身下标），否则这份答案已经是对的；
//   3. 全部都落在 1-based 的合法区间 [1, 自身下标] 内。
// 三条同时成立，唯一自洽的解释就是模型在用人类编号。
function looksOneBased(steps) {
  let sawInvalidUnderZeroBased = false;
  let sawAnyReference = false;
  for (let index = 0; index < steps.length; index += 1) {
    const dependsOn = steps[index] ? steps[index].dependsOn : null;
    if (!Number.isInteger(dependsOn)) continue;
    sawAnyReference = true;
    if (dependsOn === 0) return false;
    if (dependsOn > index) return false;
    if (dependsOn === index) sawInvalidUnderZeroBased = true;
  }
  return sawAnyReference && sawInvalidUnderZeroBased;
}

// 修不动的依赖置 null，而不是抛错。null 本来就是 schema 里“这一步不依赖别人”
// 的合法取值，而一条错的排序提示用户点一下就能改；整份回退是 40 秒加一份
// 与处境无关的通用模板。
function repairStepDependencies(rawSteps) {
  if (!Array.isArray(rawSteps)) return rawSteps;
  const steps = rawSteps.map(step => (step && typeof step === 'object' && !Array.isArray(step)
    ? { ...step, dependsOn: coerceInteger(step.dependsOn) }
    : step));
  const shift = looksOneBased(steps) ? 1 : 0;
  return steps.map((step, index) => {
    if (!step || typeof step !== 'object' || Array.isArray(step)) return step;
    const raw = step.dependsOn;
    if (!Number.isInteger(raw)) return { ...step, dependsOn: null };
    const rebased = raw - shift;
    return { ...step, dependsOn: rebased >= 0 && rebased < index ? rebased : null };
  });
}

module.exports = {
  parseJsonObject,
  dropUnknownKeys,
  coerceInteger,
  coerceEnum,
  keepAllowed,
  looksOneBased,
  repairStepDependencies
};
