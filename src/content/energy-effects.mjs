'use strict';

// 这张表是"提醒事项的种类"这件事在整个工程里的**唯一定义处**。
//
// 放在 content 而不是放在 capability 里,是被依赖方向逼出来的,不是风格选择:
// 种类同时被 content 自己(这张效应表)、core(曲线数学)、capabilities(提醒的
// 领域规则)和 platform(持久层的枚举校验)需要,而 content 是唯一一层能被上面
// 全部四层向内引用的。把它放在 capability 里,content 与 core 就只能各抄一份。
//
// 于是种类不是另写一个数组,而是这张表的键 —— 一份数据只有一个真相来源。

// ---------------------------------------------------------------------------
// 关于下面所有数值的立场,必须留在代码里,不只留在设计文档里:
//
// **这些是默认先验,不是测量值,也不是从任何一篇论文里抄来的临床参数。**
// 文献能支持的只有形状与方向(兴奋剂是"起效—达峰—衰减";午后有一段普遍低谷;
// 运动后短时唤醒上升、之后有疲劳代价;短睡恢复、睡过头有睡眠惯性;会议是净
// 支出)。具体数值的个体差异极大,我们没有验证过它们适用于**这个**用户。
//
// 因此:任何人不得在代码注释或界面文案里给这些数字挂上一篇具体文献的引用来
// 充当权威。数值的正确性来自 ARCHITECTURE「日常与能量」 的自评残差校正与 ARCHITECTURE「日常与能量」 的个人校准把它们拉回
// 这个用户的现实,而不是来自出处。
//
// 同理,这里没有任何一个字段是剂量。`amplitude` 与 `durationMin` 描述的是一次
// 干预在一条无单位估计值上的**形状**,不是"吃了多少"。加一个剂量字段就是给出
// 医疗建议的第一步。
// ---------------------------------------------------------------------------

const EFFECT_SHAPES = Object.freeze([
  'ramp-decay', 'dip-recover', 'quick-lift', 'delayed-lift', 'restore', 'drain'
]);

// editable 是用户能把默认值改到哪里,比持久层的外层信封窄。
// 持久层的信封(amplitude −100..100、durationMin 1..1440)只回答"这个数是不是
// 荒谬";这里回答"这个数还像不像它声称的那种干预"。两层刻意不合并:持久层放宽
// 是为了不因为内容表变化而拒绝一份已经存进去的选择,窄边界放在内容层是因为
// 它跟着内容一起演进。
function effectProfile(profileId, shape, params) {
  if (!EFFECT_SHAPES.includes(shape)) throw new TypeError(`unknown effect shape: ${shape}`);
  const editable = params.editable;
  const inside = (value, [min, max]) => Number.isFinite(value) && value >= min && value <= max;
  if (!inside(params.amplitude, editable.amplitude) || !inside(params.durationMin, editable.durationMin)) {
    throw new RangeError(`${profileId} default falls outside its own editable bounds`);
  }
  return Object.freeze({
    profileId,
    shape,
    amplitude: params.amplitude,
    onsetMin: params.onsetMin,
    durationMin: params.durationMin,
    decayHalfLifeMin: params.decayHalfLifeMin,
    // 形状专属参数。用 null 占位而不是让键缺席,曲线数学就不必对每种形状写一套
    // 取值分支,而且"这个形状没有回弹"和"忘了填回弹"在读代码时是两回事。
    reboundAmplitude: params.reboundAmplitude ?? null,
    costAmplitude: params.costAmplitude ?? null,
    costMinutes: params.costMinutes ?? null,
    inertiaAmplitude: params.inertiaAmplitude ?? null,
    inertiaAfterMin: params.inertiaAfterMin ?? null,
    inertiaMinutes: params.inertiaMinutes ?? null,
    editable: Object.freeze({
      amplitude: Object.freeze([...editable.amplitude]),
      durationMin: Object.freeze([...editable.durationMin])
    })
  });
}

const ROUTINE_EFFECT_PROFILES = Object.freeze({
  // 受 ARCHITECTURE「日常与能量」 的全部硬约束:不进任何模型请求,不进任何游戏化奖励。
  medication: effectProfile('medication-default', 'ramp-decay', {
    amplitude: 18, onsetMin: 40, durationMin: 480, decayHalfLifeMin: 180,
    editable: { amplitude: [0, 40], durationMin: [60, 720] }
  }),
  // 与 medication 分开的一条,不是重复:咖啡不是药,不该被 ARCHITECTURE「日常与能量」 的隐私规则一起
  // 藏起来。衰减也刻意比 medication 更慢(半衰期更长),这是两者形状上的差别。
  stimulant: effectProfile('stimulant-default', 'ramp-decay', {
    amplitude: 10, onsetMin: 20, durationMin: 300, decayHalfLifeMin: 240,
    editable: { amplitude: [0, 30], durationMin: [30, 600] }
  }),
  // 先沉后升:餐后困倦是真的,但一顿饭最终是补充而不是净支出,所以回弹到略高
  // 于基线。amplitude 为负 = 下沉幅度。
  meal: effectProfile('meal-default', 'dip-recover', {
    amplitude: -8, onsetMin: 15, durationMin: 120, decayHalfLifeMin: 60,
    reboundAmplitude: 4,
    editable: { amplitude: [-25, 0], durationMin: [30, 240] }
  }),
  snack: effectProfile('snack-default', 'quick-lift', {
    amplitude: 6, onsetMin: 10, durationMin: 75, decayHalfLifeMin: 45,
    editable: { amplitude: [0, 20], durationMin: [15, 180] }
  }),
  // 先付代价后拿收益。costMinutes 结束前曲线是往下的 —— 这一段不是噪声,它正是
  // "刚练完先别安排难事"这句能操作的建议的来源。
  movement: effectProfile('movement-default', 'delayed-lift', {
    amplitude: 12, onsetMin: 20, durationMin: 210, decayHalfLifeMin: 90,
    costAmplitude: -5, costMinutes: 25,
    editable: { amplitude: [0, 30], durationMin: [30, 360] }
  }),
  // 睡眠惯性只在这次休息超过 inertiaAfterMin 时出现。ARCHITECTURE「日常与能量」 明确记下这一条的个体
  // 差异最大,所以 inertiaAmplitude 必须能被用户直接调到 0 —— editable 的下界
  // 允许把整个 restore 关成 0,就是这个出口。
  rest: effectProfile('rest-default', 'restore', {
    amplitude: 14, onsetMin: 5, durationMin: 180, decayHalfLifeMin: 120,
    inertiaAmplitude: -8, inertiaAfterMin: 40, inertiaMinutes: 25,
    editable: { amplitude: [0, 30], durationMin: [20, 360] }
  }),
  meeting: effectProfile('meeting-default', 'drain', {
    amplitude: -10, onsetMin: 0, durationMin: 60, decayHalfLifeMin: 30,
    editable: { amplitude: [-40, 0], durationMin: [15, 480] }
  }),
  // 纯提醒,不进曲线。这一类必须存在:不是每件要提醒的事都有能量含义,强行给它
  // 一个效应就是编造。`null` 是这张表里唯一合法的空值,也是"提醒"与"效应"两件
  // 事可以分开存在的证据。
  custom: null
});

// 种类 = 表的键。顺序即界面里的默认排列顺序,所以不排序。
const ROUTINE_KINDS = Object.freeze(Object.keys(ROUTINE_EFFECT_PROFILES));

// ---------------------------------------------------------------------------
// 基线:四个个人参数,全部有默认值,默认值从既有设置派生 —— 老用户零配置就能
// 得到一条合理的曲线,而不是先被要求填一份问卷。
// ---------------------------------------------------------------------------

const BASELINE_EDITABLE_BOUNDS = Object.freeze({
  wakeHour: Object.freeze([3, 12]),
  // 昼夜相位偏移,分钟,正数=更晚。ADHD 群体整体偏晚,但"偏多少"没有默认答案,
  // 所以默认 0:不知道就是 0,而不是替用户假设一个偏移。
  chronotypeShift: Object.freeze([-120, 180]),
  morningRampMinutes: Object.freeze([30, 240]),
  postLunchDipDepth: Object.freeze([0, 30])
});

// 个人效应缩放的可调范围,同样比持久层的 0.5–1.5 信封窄。
const EFFECT_SCALE_EDITABLE = Object.freeze([0.6, 1.4]);

const DEFAULT_MORNING_RAMP_MINUTES = 90;
const DEFAULT_POST_LUNCH_DIP_DEPTH = 12;
const DEFAULT_WAKE_HOUR = 8;
// 起床默认落在上班时间前一小时:这是从"用户已经告诉过我们的东西"里推,而不是
// 再问一遍。猜错的代价也小 —— ARCHITECTURE「日常与能量」 的校准会把它挪回去。
const WAKE_HOURS_BEFORE_WORK = 1;

function clampToBounds(value, [min, max], fallback) {
  if (!Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

// 纯函数:同样的输入永远给同样的四个参数,不读时钟也不读全局状态。
// `workStartHour` 缺失时退回 DEFAULT_WAKE_HOUR,而不是抛错 —— 基线是任何时候
// 都要能画出来的东西,缺一个设置不该让整条曲线消失。
function defaultEnergyBaseline({ workStartHour = null } = {}) {
  const derivedWakeHour = Number.isInteger(workStartHour)
    ? workStartHour - WAKE_HOURS_BEFORE_WORK
    : DEFAULT_WAKE_HOUR;
  return Object.freeze({
    wakeHour: clampToBounds(derivedWakeHour, BASELINE_EDITABLE_BOUNDS.wakeHour, DEFAULT_WAKE_HOUR),
    chronotypeShift: 0,
    morningRampMinutes: DEFAULT_MORNING_RAMP_MINUTES,
    postLunchDipDepth: DEFAULT_POST_LUNCH_DIP_DEPTH
  });
}

function effectProfileForKind(kind) {
  return Object.prototype.hasOwnProperty.call(ROUTINE_EFFECT_PROFILES, kind)
    ? ROUTINE_EFFECT_PROFILES[kind]
    : null;
}

// 按 profileId 反查。持久层存的是 profileId 而不是 kind,因为一个种类的默认效应
// 将来可能拆成"缓释/速释"两份 —— 那时旧数据指向的 profileId 仍然要能被认出来。
const PROFILE_BY_ID = Object.freeze(Object.fromEntries(
  Object.values(ROUTINE_EFFECT_PROFILES)
    .filter(Boolean)
    .map(profile => [profile.profileId, profile])
));

function effectProfileById(profileId) {
  return Object.prototype.hasOwnProperty.call(PROFILE_BY_ID, profileId)
    ? PROFILE_BY_ID[profileId]
    : null;
}

export default Object.freeze({
  EFFECT_SHAPES,
  ROUTINE_KINDS,
  ROUTINE_EFFECT_PROFILES,
  BASELINE_EDITABLE_BOUNDS,
  EFFECT_SCALE_EDITABLE,
  defaultEnergyBaseline,
  effectProfileForKind,
  effectProfileById
});

export {
  EFFECT_SHAPES,
  ROUTINE_KINDS,
  ROUTINE_EFFECT_PROFILES,
  BASELINE_EDITABLE_BOUNDS,
  EFFECT_SCALE_EDITABLE,
  defaultEnergyBaseline,
  effectProfileForKind,
  effectProfileById
};
