'use strict';

// Shared step validation for LLM proposal outputs.
// Both breakdown-proposal and enrich-proposal validate steps with the same
// shape (title, dependsOn, safeStopAfter) and the same rules (action-word
// pattern, 0-based dependency index, boolean safeStopAfter). This module
// is the single source of truth; the two proposal files import it so a
// rule change in one place cannot drift from the other.

const { isPlainObject, trimmedString } = require('../field-normalizers');

const MIN_STEPS = 3;
const MAX_STEPS = 7;
const MAX_STEP_TITLE = 200;
const MAX_SERIALIZED_BYTES = 8 * 1024;

// 一条只有名词的步骤（"项目文件"）对难启动的人来说等于没有步骤：它把"下一步做什么"
// 又推回给了用户。所以标题必须点出一个动作。
//
// 但这条规则原先要求动词落在**第一个字**上，而中文的自然语序经常不是那样：
// "提前查看天气""把行李清单列出来""机票和酒店订好"——动作都在，只是不在开头。
// 于是一份前缀白名单把大量完全可用的建议整份否掉（一步不合格，整份 proposal 回退），
// 用户看到的是"AI 从来不生效"，而不是"这一步写得不好"。判据因此改成"标题里
// 出现过动作词"，纯名词短语仍然被拒。
//
// 词表也不再只覆盖办公与写代码：用这个 App 的人同样要出门、采买和收拾行李，
// 而"买防晒霜""订车票""打包行李"过去一个都不算动作。它不追求穷尽：漏一个词
// 的代价是多一句"完成："前缀，不是整份建议消失。
const ACTION_WORDS = Object.freeze([
  '打开', '新建', '列出', '写', '做', '完成', '准备', '整理', '学习', '读', '阅读',
  '设计', '开发', '实现', '修', '修复', '清理', '回复', '发送', '联系', '安排', '规划',
  '复习', '调试', '优化', '重构', '测试', '部署', '录', '画', '想', '研究', '调研',
  '翻译', '选择', '选', '检查', '确认', '确定', '收集', '创建', '运行', '执行', '保存',
  '标记', '拆分', '比较', '验证', '添加', '删除', '更新', '继续', '快速', '划定',
  '归位', '收尾', '合上', '启动', '开始', '记录', '描述', '导出', '提交', '构建',
  '安装', '配置', '查看', '查', '填写', '尝试', '暂停', '关闭', '移动', '复制',
  '定义', '测量', '搜索', '生成', '分析', '总结',
  '买', '订', '预订', '预约', '报名', '登记', '打包', '收拾', '清点', '盘点', '核对',
  '带', '装', '拿', '取', '换', '借', '退', '付', '寄', '打印', '下载', '上传',
  '备份', '充电', '导航', '排队', '洗', '晒', '问', '询问', '试', '拍',
  '放', '收', '扫', '签', '存',
  // 办公与学习里常见、之前漏掉的：一个"填三条进展"就能让整份建议作废。
  '填', '补', '补充', '改', '修改', '改写', '重写', '润色', '校对', '审阅', '标注', '圈出',
  '勾选', '贴', '粘贴', '剪', '拖', '点击', '登录', '注册', '申请', '交', '上交', '递交',
  '起草', '草拟', '拟', '抄', '誊', '背', '练', '练习', '听', '看', '念', '朗读', '讲', '说',
  '告诉', '汇报', '演示', '讨论', '沟通', '同步', '对齐', '约', '见', '拜访', '打电话',
  '拨', '找', '挑', '算', '计算', '统计', '汇总', '梳理', '对照', '过一遍', '回', '跑',
  '去', '走', '打扫', '擦', '叠', '倒', '煮', '喂', '遛', '称', '量', '剪辑', '拍照',
  'Review', 'Open', 'Create', 'Write', 'Read', 'Run', 'Check', 'Test', 'Build',
  'Save', 'Send', 'List', 'Choose', 'Implement', 'Fix', 'Update', 'Add', 'Remove', 'Deploy',
  'Draft', 'Fill', 'Call', 'Email', 'Book', 'Buy', 'Pack', 'Clean', 'Edit', 'Outline', 'Sketch',
  'Record', 'Print', 'Sign', 'Submit', 'Reply', 'Ask', 'Find', 'Search', 'Download', 'Upload',
  'Move', 'Copy', 'Paste', 'Mark', 'Rename', 'Delete', 'Close', 'Start', 'Finish', 'Pick',
  'Install', 'Configure', 'Merge', 'Commit', 'Push', 'Debug', 'Measure', 'Compare', 'Summarize',
  'Translate', 'Practice', 'Wash', 'Cook', 'Walk', 'Go to'
]);
const ACTION_PATTERN = new RegExp(`(?:${ACTION_WORDS.join('|')})`, 'i');

// 每个字段的语义写在 schema 的 description 里，不写在散文提示词里。
//
// 这不是文档洁癖：`dependsOn` 的"0 起数组下标"这个约定原先只存在于校验器，
// 提示词里那句"只在真的不能先开始时才设置"完全没提编号方式。模型于是按人类
// 习惯给了 1-based，steps[1].dependsOn=1 变成自己依赖自己，一份可用的建议整份
// 作废。字段说明是唯一一定会跟着请求一起上线的东西——json_schema 档位由协议
// 传给模型，降级到 json_object 时被整段贴进提示词。放在这里，两条路都盖住。
const DEPENDS_ON_DESCRIPTION = [
  'Zero-based index of an earlier step in this same steps array.',
  "It must be strictly less than this step's own index, so the first step is always null.",
  'Use null whenever a step can be started without waiting for another one;',
  'set a number only where the work genuinely cannot begin before that earlier step is done.'
].join(' ');

const SAFE_STOP_DESCRIPTION = [
  'True when stopping right after this step leaves the work in a state the person can come back to',
  'without losing progress or having to redo it. The final step must always be true.'
].join(' ');

const STEP_TITLE_DESCRIPTION = [
  'One concrete action, naming the actual file, app, page, document or person involved.',
  'It must contain a verb describing what to do; a bare noun phrase is not a step.',
  'Write it in the same language as the task title.'
].join(' ');

function buildStepsJsonSchema() {
  return {
    type: 'array', minItems: MIN_STEPS, maxItems: MAX_STEPS,
    description: `Between ${MIN_STEPS} and ${MAX_STEPS} steps, in the order they should be done.`,
    items: {
      type: 'object', additionalProperties: false,
      required: ['title', 'dependsOn', 'safeStopAfter'],
      properties: {
        title: { type: 'string', minLength: 1, maxLength: MAX_STEP_TITLE, description: STEP_TITLE_DESCRIPTION },
        dependsOn: {
          anyOf: [{ type: 'null' }, { type: 'integer', minimum: 0, maximum: MAX_STEPS - 2 }],
          description: DEPENDS_ON_DESCRIPTION
        },
        safeStopAfter: { type: 'boolean', description: SAFE_STOP_DESCRIPTION }
      }
    }
  };
}

function exactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new TypeError(`${label} contains unknown or missing fields`);
  }
}

function parseRawProposal(raw) {
  if (typeof raw !== 'string') return raw;
  if (Buffer.byteLength(raw, 'utf8') > MAX_SERIALIZED_BYTES) throw new RangeError('proposal exceeds 8 KB');
  try { return JSON.parse(raw); } catch (_) { throw new TypeError('proposal is not valid JSON'); }
}

/**
 * Validate a raw steps array from an LLM proposal.
 *
 * Both breakdown and enrich proposals share the same step shape, action-word
 * requirement, dependency rules and safeStopAfter semantics. This function is
 * the single implementation so a rule change applies to both proposal kinds.
 *
 * @param {Array} rawSteps — raw proposal.steps array
 * @param {object} options
 * @param {number} [options.maxStepTitle=200] — max title length
 * @returns {Array<{title: string, dependsOn: number|null, safeStopAfter: boolean}>}
 */
function validateSteps(rawSteps, options = {}) {
  const maxStepTitle = Number.isInteger(options.maxStepTitle) ? options.maxStepTitle : MAX_STEP_TITLE;

  if (!Array.isArray(rawSteps) || rawSteps.length < MIN_STEPS || rawSteps.length > MAX_STEPS) {
    throw new RangeError(`proposal must contain ${MIN_STEPS}–${MAX_STEPS} steps`);
  }

  const steps = rawSteps.map((rawStep, index) => {
    if (!isPlainObject(rawStep)) throw new TypeError(`steps[${index}] must be an object`);
    exactKeys(rawStep, ['title', 'dependsOn', 'safeStopAfter'], `steps[${index}]`);

    const title = trimmedString(rawStep.title, null, maxStepTitle);
    if (!title || rawStep.title.trim().length > maxStepTitle) {
      throw new RangeError(`steps[${index}].title is invalid`);
    }
    if (!ACTION_PATTERN.test(title)) {
      throw new TypeError(`steps[${index}].title must name an action: ${title.slice(0, 40)}`);
    }

    const dependsOn = rawStep.dependsOn;
    if (dependsOn !== null && (!Number.isInteger(dependsOn) || dependsOn < 0 || dependsOn >= index)) {
      throw new RangeError(`steps[${index}].dependsOn must reference an earlier step`);
    }

    if (typeof rawStep.safeStopAfter !== 'boolean') {
      throw new TypeError(`steps[${index}].safeStopAfter must be boolean`);
    }

    return Object.freeze({ title, dependsOn, safeStopAfter: rawStep.safeStopAfter });
  });
  if (!steps.at(-1).safeStopAfter) {
    throw new RangeError('the final step must be a safe stop');
  }
  return steps;
}

module.exports = {
  MIN_STEPS,
  MAX_STEPS,
  MAX_STEP_TITLE,
  MAX_SERIALIZED_BYTES,
  ACTION_WORDS,
  ACTION_PATTERN,
  DEPENDS_ON_DESCRIPTION,
  SAFE_STOP_DESCRIPTION,
  STEP_TITLE_DESCRIPTION,
  buildStepsJsonSchema,
  exactKeys,
  parseRawProposal,
  validateSteps
};
