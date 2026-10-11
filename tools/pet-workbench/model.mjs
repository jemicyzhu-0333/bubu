import { samplePaperReturn } from '../../src/capabilities/companion/presentation/paper-return-story.mjs';
export const PHASE_LABELS = Object.freeze({ anticipation: '准备 / 取出', grip: '握持 / 蓄势', flight: '放飞 / 弧线回返', receive: '伸手迎接', contact: '接住', recovery: '整理 / 收起', idle: '回待机' });
export function selectGarment(ids, item, checked, catalog) {
  const next = ids.filter(id => id !== item.id && (!checked || !item.exclusiveGroup || catalog.find(v => v.id === id)?.exclusiveGroup !== item.exclusiveGroup));
  if (checked) next.push(item.id);
  return next;
}
export function inspectFrame(source, { form, skin, kind, item, elapsed, duration, view, outfit, calm }) {
  const progress = Math.max(0, Math.min(.999999, elapsed / duration));
  const action = ['action', 'session'].includes(kind) ? item : null;
  const sampled = source.formArt.sampleAction(form, action, progress, { calmVisual: calm });
  const resolvedView = source.formArt.resolveView(form, view, { action: sampled.action, state: kind === 'session' ? item.state : 'idle' });
  const appearance = source.appearance.projectAppearance({ formId: form.id, skin, level: 99, view: resolvedView, itemIds: outfit, includeLocked: true });
  const phase = item.id === 'paper-return' ? PHASE_LABELS[samplePaperReturn(progress, calm).phase]
    : sampled.phase?.label || (item.id === 'paper-plane' ? '旧放飞循环（没有独立故事分镜）' : '此动作未定义独立分镜');
  return { progress, resolvedView, visibleIds: appearance.items.map(value => value.id), phase };
}
