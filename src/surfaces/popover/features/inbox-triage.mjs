import { t } from '../../shared/interface/i18n.mjs';
// Presentation labels match the six existing internal categories; uncertainty is explicit.
const CATEGORIES = Object.freeze({ unclassified: '未分类', task: '任务', routine: '日常计划', log: '日常记录', state: '状态', feeling: '情绪', note: '想法' });
// One-tap choices for an unclassified capture, in the order people usually mean them.
const QUICK_PICKS = Object.freeze({ task: '要做的事', log: '刚做过', routine: '想养成', state: '状态', feeling: '情绪', note: '想法' });
const ROUTINE_KINDS = Object.freeze({ meal: '吃饭', rest: '休息', movement: '活动', snack: '加餐', stimulant: '咖啡 / 茶', medication: '用药', meeting: '会议', custom: '其他日常' });
const LEVEL_LABELS = Object.freeze({ 20: '很低', 35: '低', 50: '一般', 65: '好', 80: '很好' });
const OUTCOMES = Object.freeze({ promote: '已转任务', 'next-step': '已转任务', schedule: '已安排任务', someday: '已放以后', routine: '已建日常', log: '已记一次', state: '已记状态', feeling: '已存情绪', keep: '已留存' });

function classificationOf(impulse) {
  const source = impulse.classification || impulse.triage || {};
  return { category: CATEGORIES[source.category] ? source.category : 'unclassified', routineKind: source.routineKind || null, level: source.level ?? null };
}

// The label shown and acted on: the stored one, overlaid by what the person picked
// on this card but has not committed yet. Picking never writes on its own.
function effectiveClassification(impulse, draft = {}) {
  const stored = classificationOf(impulse);
  if (!draft.category || draft.category === stored.category) {
    return { ...stored, ...(draft.routineKind !== undefined ? { routineKind: draft.routineKind } : {}), ...(draft.level !== undefined ? { level: draft.level } : {}) };
  }
  return { category: draft.category, routineKind: draft.routineKind ?? null, level: draft.level ?? null };
}

function describeTriage(impulse, state, draft) {
  const classification = effectiveClassification(impulse, draft);
  const matching = (state?.routines?.items || []).filter(item => item.active !== false && item.kind === classification.routineKind);
  const kind = ROUTINE_KINDS[classification.routineKind] || t('日常');
  switch (classification.category) {
    case 'task': return { text: t('一件准备去做的事'), action: { kind: 'next-step', label: t('转为任务') } };
    case 'routine': return { text: t('需要重复做的日常，创建后可以设置提醒'), action: { kind: 'routine', label: t('建成日常') } };
    case 'log': return { text: matching.length ? t('确认刚做过的事情，记录到所选日常') : t('创建「{kind}」并记录一次，不设置提醒', { kind: t(kind) }), action: { kind: 'log', label: matching.length ? t('记录一次') : t('创建并记一次') } };
    case 'state': return { text: t('确认后记录当时的能量状态'), action: { kind: 'state', label: t('确认状态') } };
    case 'feeling': return { text: t('留一条情绪记录，不自动改变能量'), action: { kind: 'feeling', label: t('保存情绪') } };
    case 'note': return { text: t('保留想法，不创建待办'), action: { kind: 'keep', label: t('保存想法') } };
    default: return { text: t('选一个类型，或原样留存'), action: { kind: 'keep', label: t('先留存') } };
  }
}

export { CATEGORIES, QUICK_PICKS, ROUTINE_KINDS, LEVEL_LABELS, OUTCOMES, classificationOf, effectiveClassification, describeTriage };
