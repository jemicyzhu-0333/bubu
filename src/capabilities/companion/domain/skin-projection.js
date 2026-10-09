'use strict';
const completionBenefits = require('./completion-benefits');
const { isSkinAvailable } = require('./skin-availability');
const { PET_FORMS } = require('../form-registry.mjs');
function skinUnlockProgress(state, now) {
  return completionBenefits.skinUnlockProgress({
    level: state.level,
    stats: state.stats
  }, now);
}
function projectSkins(state, SKINS, { now = null } = {}) {
  const unlocked = state.unlockedSkins, current = state.currentSkin;
  const progress = skinUnlockProgress(state, now);
  return Object.entries(SKINS).map(([id, s]) => {
    const rule = progress[id];
    const isUnlocked = isSkinAvailable(id, unlocked);
    return {
      id, name: s.name, unlockDesc: rule ? `Lv.${rule.target} 解锁` : s.unlockDesc,
      formId: s.formId || 'dango', formName: PET_FORMS[s.formId || 'dango'].name,
      unlockLevel: completionBenefits.SKIN_UNLOCK_RULES[id]?.metric === 'level'
        ? completionBenefits.SKIN_UNLOCK_RULES[id].target : (id === 'pink' || id === 'usagi' ? 1 : null),
      unlocked: isUnlocked, current: current === id,
      progress: rule && !isUnlocked
        ? { current: Math.max(0, Math.min(rule.current, rule.target)), target: rule.target }
        : null
    };
  });
}

module.exports = { projectSkins };
