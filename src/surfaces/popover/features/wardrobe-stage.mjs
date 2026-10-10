import { t } from '../../shared/interface/i18n.mjs';
import { USAGI_OUTFIT_SETS } from '../../../content/companion/usagi-wardrobe.mjs';

// The stage owns browsing only. Its recipes never become editable equipment.
function matchesOutfit(wornIds, itemIds) {
  const worn = new Set(wornIds);
  return wornIds.length === itemIds.length && worn.size === itemIds.length
    && itemIds.every(id => worn.has(id));
}

function wardrobeStageLooks(state, formId) {
  const options = new Map((state?.appearance?.choices || []).flatMap(choice => choice.options || []).map(item => [item.id, item]));
  const wornIds = state?.appearance?.wornIds || [];
  const recipes = formId === 'usagi' ? USAGI_OUTFIT_SETS.filter(look =>
    look.formId === formId && look.itemIds.every(id => options.has(id))) : [];
  const matched = recipes.find(look => matchesOutfit(wornIds, look.itemIds));
  return [{ id: 'current', label: matched ? matched.label : t('混搭'), named: Boolean(matched), itemIds: [...wornIds] },
    ...recipes.map(look => ({ ...look, named: true, pieces: look.itemIds.map(id => options.get(id)),
      available: look.itemIds.every(id => options.get(id).available) }))];
}

function createWardrobeStage({ $, getState, formFor, drawPetPreview, onApply, busy, lockText }) {
  let state, formId, index = 0, paintKey = '', mounted = false, pointer = null, applyFocusIntent = null;
  const node = () => $('#wardrobeStage');
  const looks = () => wardrobeStageLooks(state, formId);
  function copy() {
    if (!state || !node()) return;
    const all = looks(), look = all[index] || all[0];
    const title = $('#wardrobeStageTitle'), position = $('#wardrobeStagePosition');
    if (title) { title.textContent = look.label; title.setAttribute('aria-description', t('完整套装名称')); title.setAttribute('data-named', String(look.named)); }
    $('#wardrobeStageNameHelp')?.setAttribute('data-named', String(look.named));
    const fullName = $('#wardrobeStageFullName');
    if (fullName) fullName.textContent = look.label;
    if (position) position.textContent = t('{current} / {total}', { current: index + 1, total: all.length });
    node().setAttribute('aria-roledescription', t('穿搭轮播'));
    node().setAttribute('aria-label', t('穿搭舞台：{name}，{current} / {total}', { name: look.label, current: index + 1, total: all.length }));
    for (const [selector, direction, label] of [['#wardrobeStagePrevious', -1, '上一套穿搭'], ['#wardrobeStageNext', 1, '下一套穿搭']]) {
      const control = $(selector);
      if (control) { control.hidden = all.length < 2; control.disabled = index + direction < 0 || index + direction >= all.length; control.setAttribute('aria-label', t(label)); control.title = t(label); }
    }
    const apply = $('#wardrobeApplyOutfit'), requirement = $('#wardrobeStageRequirement');
    const requirementRow = $('#wardrobeStageLocked'), help = $('#wardrobeStageRequirementHelp');
    const equipped = index === 0 || matchesOutfit(state.appearance?.wornIds || [], look.itemIds);
    const canApply = index > 0 && look.available && !equipped;
    node().setAttribute('aria-describedby', equipped ? 'wardrobeStageEquipped' : !look.available ? 'wardrobeStageLockedLabel' : '');
    const equippedStatus = $('#wardrobeStageEquipped');
    if (equippedStatus) { equippedStatus.hidden = !equipped; equippedStatus.textContent = t('已搭配'); }
    if (apply) {
      const document = apply.ownerDocument;
      const active = document?.activeElement;
      const ownedConfirmation = equipped && applyFocusIntent?.lookId === look.id
        && applyFocusIntent.skinId === state.currentSkin;
      const restoreStageFocus = (!canApply && !apply.hidden && active === apply)
        || (ownedConfirmation && document && (active === apply || active === document.body || !active));
      if (ownedConfirmation) applyFocusIntent = null;
      apply.hidden = !canApply;
      apply.textContent = t('一键换装');
      apply.classList.toggle('locked', !canApply);
      apply.disabled = busy() || !canApply;
      if (restoreStageFocus) node().focus?.({ preventScroll: true });
    }
    if (requirement) {
      const missing = (look.pieces || []).filter(piece => !piece.available);
      requirement.textContent = missing.map(piece => `${piece.label} · ${lockText(state, piece.lockReason)}`).join(' / ');
      if (requirementRow) requirementRow.hidden = equipped || missing.length === 0;
      const label = $('#wardrobeStageLockedLabel');
      if (label) label.textContent = t('待解锁');
      if (help) help.setAttribute('aria-label', t('穿搭解锁条件'));
    }

    const summary = $('#wardrobeSummary');
    if (summary) summary.hidden = true;
    const pieces = $('#wardrobeWornPieces');
    if (pieces) pieces.hidden = true;
  }
  function render(nextState, nextForm = formFor(nextState).id) {
    if (!node()) return false;
    if (formId !== nextForm) { index = 0; paintKey = ''; applyFocusIntent = null; }
    state = nextState; formId = nextForm;
    const all = looks();
    index = Math.min(index, all.length - 1);
    const key = JSON.stringify([state.currentSkin, index, all.map(look => look.itemIds)]);
    if (key !== paintKey) {
      let failed = false;
      for (const [selector, offset] of [['#wardrobePreviewPrevious', -1], ['#wardrobePreview', 0], ['#wardrobePreviewNext', 1]]) {
        const canvas = $(selector), look = all[index + offset];
        if (!canvas) continue;
        canvas.hidden = !look;
        if (look) try { drawPetPreview(canvas, { skinId: state.currentSkin || 'pink', itemIds: [...look.itemIds], size: 'preview' }); }
        catch (_) { canvas.hidden = true; failed = true; }
      }
      paintKey = failed ? '' : key;
    }
    copy(); return true;
  }
  function move(delta) {
    if (!state) return;
    const next = Math.max(0, Math.min(looks().length - 1, index + delta));
    if (next === index) return;
    applyFocusIntent = null; index = next; render(getState());
  }
  function previous() { move(-1); }
  function next() { move(1); }
  function apply() {
    if (busy()) return;
    render(getState()); // Recheck current form/unlocks immediately before dispatch.
    const look = looks()[index];
    if (index && look?.available && !$('#wardrobeApplyOutfit')?.disabled) {
      applyFocusIntent = { lookId: look.id, skinId: state.currentSkin };
      onApply(look.id, state.currentSkin);
    }
  }
  function keydown(event) {
    if (event.target?.closest?.('.inline-help')) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault(); move(event.key === 'ArrowLeft' ? -1 : 1);
  }
  function down(event) {
    if (event.isPrimary === false || (event.button !== undefined && event.button !== 0) || event.target?.closest?.('button, .inline-help')) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
  }
  function up(event) {
    const start = pointer; pointer = null;
    if (!start || start.id !== event.pointerId) return;
    const x = event.clientX - start.x, y = event.clientY - start.y;
    if (Math.abs(x) >= 35 && Math.abs(x) > Math.abs(y) * 1.4) move(x < 0 ? 1 : -1);
  }
  function cancel() { pointer = null; }
  function trackFocus(event) {
    const document = node()?.ownerDocument;
    if (applyFocusIntent && event.target && event.target !== $('#wardrobeApplyOutfit') && event.target !== document?.body) {
      applyFocusIntent = null;
    }
  }
  const bindings = () => [[node()?.ownerDocument, 'focusin', trackFocus], [node(), 'keydown', keydown], [node(), 'pointerdown', down], [node(), 'pointerup', up],
    [node(), 'pointercancel', cancel], [node(), 'pointerleave', cancel],
    [$('#wardrobeStagePrevious'), 'click', previous], [$('#wardrobeStageNext'), 'click', next], [$('#wardrobeApplyOutfit'), 'click', apply]];
  function mount() {
    if (mounted) return; mounted = true;
    for (const [target, type, handler] of bindings()) target?.addEventListener(type, handler);
  }
  function dispose() {
    if (!mounted) return; mounted = false; cancel(); applyFocusIntent = null;
    for (const [target, type, handler] of bindings()) target?.removeEventListener(type, handler);
  }
  return Object.freeze({ render, repaintCopy: copy, mount, dispose, cancelApplyFocus() { applyFocusIntent = null; }, cancelGesture() { cancel(); applyFocusIntent = null; }, showCurrent() { applyFocusIntent = null; index = 0; render(getState()); } });
}
export { createWardrobeStage, wardrobeStageLooks };
