export function galleryVariants(current, baseline, formId, baselineAvailable) {
  const before = baselineAvailable ? '主分支原版' : '未配置原版快照';
  return formId === 'dango' ? [
    { id: 'baseline', label: `团子兽 · ${before}`, source: baseline, skin: 'pink' },
    { id: 'current', label: '团子兽 · 当前版本', source: current, skin: 'pink' },
    { id: 'usagi', label: '乌沙奇 · 当前版本', source: current, skin: 'usagi' }
  ] : [
    { id: 'dango', label: '团子兽 · 当前版本', source: current, skin: 'pink' },
    { id: 'baseline', label: `乌沙奇 · ${before}`, source: baseline, skin: 'usagi' },
    { id: 'current', label: '乌沙奇 · 当前版本', source: current, skin: 'usagi' }
  ];
}

export function availableEntry(variant, kind, id) {
  const source = variant.source;
  if (kind === 'appearance') return source.wardrobe.PET_APPEARANCE_ITEMS.some(item => item.id === id
    && (item.formId || 'dango') === (variant.skin === 'usagi' ? 'usagi' : 'dango'));
  if (kind === 'action') return Boolean(source.behaviors.PET_ACTIONS[id]);
  if (kind === 'session') return Boolean(source.sessions.SESSION_ACTIVITIES[id]);
  if (kind === 'expression') return source.expressions.EXPRESSIONS.some(item => item.id === id);
  return Boolean(source.scenes.SCENES[id]);
}

export function outfitForVariant(variant, enabled, lookId, looks) {
  if (!enabled) return false;
  if (variant.skin !== 'usagi' || lookId === 'auto') return true;
  return looks.find(look => look.id === lookId)?.itemIds || true;
}
