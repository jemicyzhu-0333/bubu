import { triageFeedback } from './inbox-triage-feedback.mjs';
import { t, getLocale } from '../../shared/interface/i18n.mjs';
import { CATEGORIES, QUICK_PICKS, ROUTINE_KINDS, LEVEL_LABELS, OUTCOMES, classificationOf, effectiveClassification, describeTriage, routineTitleOf, routineTitleSource } from './inbox-triage.mjs';

function options(items, selected, escapeHTML, authored = () => true) {
  return Object.entries(items).map(([value, label]) => `<option value="${value}"${String(selected) === value ? ' selected' : ''}${authored(value) ? ` data-i18n="${escapeHTML(label)}"` : ''}>${escapeHTML(authored(value) ? t(label) : label)}</option>`).join('');
}

function copy(source) { return `<span data-i18n="${source}">${t(source)}</span>`; }
function moreActions(content) {
  return `<details class="inbox-options"><summary aria-label="${t('更多收件操作')}" data-i18n-aria-label="更多收件操作" title="${t('更多操作')}" data-i18n-title="更多操作"><svg class="ui-icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="3" cy="8" r=".7"/><circle cx="8" cy="8" r=".7"/><circle cx="13" cy="8" r=".7"/></svg></summary><div class="inbox-options-panel">${content}</div></details>`;
}

function sourceLabel(impulse, draft) {
  const stored = classificationOf(impulse);
  if ((draft?.category && draft.category !== stored.category)
      || (draft?.routineKind !== undefined && draft.routineKind !== stored.routineKind)
      || (draft?.level !== undefined && draft.level !== stored.level)
      || draft?.routineId !== undefined
      || (draft?.title !== undefined && draft.title !== routineTitleOf(impulse))) return '未保存';
  if (impulse.classification) return '已确认';
  // Routine provenance belongs to the proposed name, never to the person's original text.
  if (impulse.triage && ['routine', 'log'].includes(effectiveClassification(impulse, draft).category)) return '';
  return impulse.triage ? 'AI 建议' : triageFeedback(impulse)?.label || '待分类';
}

function sourceMarkup(impulse, draft, label, escapeHTML) {
  const feedback = label === '未保存' ? null : triageFeedback(impulse);
  if (!feedback) return `<span class="inbox-source">${t(label)}</span>`;
  return `<span class="inbox-source"><span class="inbox-source-label">${t(label)}</span>`
    + `<details class="inline-help inbox-triage-help"><summary aria-label="${t('分拣状态说明')}" data-i18n-aria-label="分拣状态说明">?</summary>`
    + `<p data-i18n="${escapeHTML(feedback.detail)}">${t(feedback.detail)}</p></details></span>`;
}

// Which visible input the primary action still needs before it can commit.
function missingField(classification, { matching, destination, title }) {
  if (classification.category === 'state') return classification.level === null ? 'level' : null;
  if (!['routine', 'log'].includes(classification.category)) return null;
  if (!classification.routineKind) return 'kind';
  if (classification.category === 'log' && (matching.length > 1 || (classification.routineKind === 'custom' && matching.length)) && !destination) return 'routine';
  const creating = classification.category === 'routine' || !matching.length || destination === 'new';
  return creating && !title.trim() ? 'title' : null;
}

function routineFields(classification, state, draft, impulse, escapeHTML) {
  const matching = classification.category === 'log'
    ? (state.routines?.items || []).filter(item => item.active !== false && item.kind === classification.routineKind) : [];
  const destination = draft?.routineId ?? (matching.length === 1 && classification.routineKind !== 'custom' ? matching[0].id : '');
  const title = routineTitleOf(impulse, draft);
  const choice = matching.length
    ? `<label>${copy('记录到')}<select class="inbox-routine">${options({ '': '选择日常', ...Object.fromEntries(matching.map(item => [item.id, item.title])), new: '新建日常' }, destination, escapeHTML, key => key === '' || key === 'new')}</select></label>` : '';
  const naming = !matching.length || destination === 'new';
  const html = `<div class="inbox-fields"><label>${copy('日常类型')}<select class="inbox-kind">${options({ '': '选择类型', ...ROUTINE_KINDS }, classification.routineKind || '', escapeHTML)}</select></label>${choice}`
    + `<label class="inbox-new-title${naming ? '' : ' hidden'}"><span class="inbox-title-label"><span class="inbox-title-text" data-i18n="日常名称">${t('日常名称')}</span><span class="inbox-ai-tag" role="img" aria-label="${t('AI 建议的名称')}" data-i18n-aria-label="AI 建议的名称" title="${t('AI 建议的名称')}" data-i18n-title="AI 建议的名称"${routineTitleSource(impulse, draft) === 'ai' ? '' : ' hidden'}>AI</span></span><input class="inbox-title" maxlength="40" value="${escapeHTML(title.slice(0, 40))}" placeholder="${t('给这件日常起个名字')}" data-i18n-placeholder="给这件日常起个名字"></label></div>`;
  return { html, missing: missingField(classification, { matching, destination, title }) };
}

function detailFields(impulse, state, draft, escapeHTML) {
  const c = effectiveClassification(impulse, draft);
  if (c.category === 'state') {
    return { html: `<label class="inbox-level-label">${copy('当时的能量')}<select class="inbox-level">${options({ '': '选择状态', ...LEVEL_LABELS }, c.level ?? '', escapeHTML)}</select></label>`,
      missing: missingField(c, {}) };
  }
  if (!['routine', 'log'].includes(c.category)) return null;
  const fields = routineFields(c, state, draft, impulse, escapeHTML);
  return fields;
}

function quickPicks() {
  return `<div class="inbox-picks" role="group" aria-label="${t('这条是')}" data-i18n-aria-label="这条是">${Object.entries(QUICK_PICKS)
    .map(([value, label]) => `<button type="button" class="chip inbox-pick" data-inbox-pick="${value}" data-i18n="${label}">${t(label)}</button>`).join('')}</div>`;
}

function inboxCard(impulse, state, escapeHTML, draft) {
  const history = impulse.resolution;
  const c = effectiveClassification(impulse, draft);
  const category = history?.category || c.category;
  const target = history?.targetId;
  const retained = history?.action === 'feeling' && typeof target === 'string' && target.trim() && target.length <= 64
    && !(state.moodNotes || []).some(note => note.id === target);
  const time = new Date(impulse.createdAt).toLocaleString(getLocale(), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const badge = history ? `<span class="inbox-label">${t(CATEGORIES[category])}</span>`
    : `<select class="inbox-category" aria-label="${t('收件分类')}" data-i18n-aria-label="收件分类">${options(CATEGORIES, category, escapeHTML)}</select>`;
  const header = actions => `<div class="inbox-card-meta">${badge}${sourceMarkup(impulse, draft, retained ? '来源记录仍保留' : history ? OUTCOMES[history.action] : sourceLabel(impulse, draft), escapeHTML)}<time datetime="${new Date(impulse.createdAt).toISOString()}">${escapeHTML(time)}</time>${moreActions(actions)}</div>`;
  const text = `<p class="impulse-text">${escapeHTML(impulse.text)}</p>`;
  const remove = `<button type="button" class="inbox-remove" data-inbox-action="delete" data-i18n="删除收件">${t('删除收件')}</button>`;
  if (history) {
    const source = retained ? `<button type="button" class="chip" data-inbox-action="delete-mood-source">${t('删除关联来源')}</button>` : '';
    return header(source + remove) + text;
  }
  const suggestion = describeTriage(impulse, state, draft);
  const details = detailFields(impulse, state, draft, escapeHTML);
  // These are the inputs to the visible action, not another nested settings page.
  const fields = details ? `<div class="inbox-details" data-missing="${details.missing || ''}">${details.html}</div>` : '';
  const picks = category === 'unclassified' ? quickPicks() : '';
  const primary = `<button type="button" class="chip chip-action" data-inbox-action="${suggestion.action.kind}"${details?.missing === 'routine' ? ' data-inbox-needs-choice disabled' : ''}>${suggestion.action.label}</button>`;
  const secondary = category === 'task' ? `<button type="button" class="chip" data-inbox-action="schedule" data-i18n="下个工作时段">${t('下个工作时段')}</button>` : '';
  const keep = suggestion.action.kind !== 'keep' ? `<button type="button" class="chip" data-inbox-action="keep" data-i18n="只留存">${t('只留存')}</button>` : '';
  const hint = suggestion.hint ?? suggestion.text;
  return header(secondary + keep + remove) + text + picks + fields + `<div class="inbox-card-actions"><p class="inbox-explanation">${escapeHTML(hint)}</p>${primary}</div>`;
}

function repaintInboxCard(row, impulse, state, draft) {
  const history = impulse.resolution, c = effectiveClassification(impulse, draft);
  const target = history?.targetId;
  const retained = history?.action === 'feeling' && typeof target === 'string' && target.trim() && target.length <= 64
    && !(state.moodNotes || []).some(note => note.id === target);
  const source = row.querySelector('.inbox-source');
  if (source) {
    const label = row.querySelector('.inbox-source-label') || source;
    label.textContent = t(retained ? '来源记录仍保留' : history ? OUTCOMES[history.action] : sourceLabel(impulse, draft));
    const detail = row.querySelector('.inbox-triage-help p');
    const feedback = triageFeedback(impulse);
    if (detail && feedback) { detail.dataset.i18n = feedback.detail; detail.textContent = t(feedback.detail); }
    const summary = row.querySelector('.inbox-triage-help summary');
    if (summary) summary.setAttribute('aria-label', t('分拣状态说明'));
  }
  const badge = row.querySelector('.inbox-label'); if (badge) badge.textContent = t(CATEGORIES[history?.category || c.category]);
  const time = row.querySelector('time'); if (time) time.textContent = new Date(impulse.createdAt).toLocaleString(getLocale(), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  if (history) return;
  const titleLabel = row.querySelector('.inbox-title-text');
  if (titleLabel) titleLabel.textContent = t('日常名称');
  const titleTag = row.querySelector('.inbox-ai-tag');
  if (titleTag) {
    titleTag.hidden = routineTitleSource(impulse, draft) !== 'ai';
    titleTag.setAttribute('aria-label', t('AI 建议的名称'));
    titleTag.setAttribute('title', t('AI 建议的名称'));
  }
  const suggestion = describeTriage(impulse, state, draft);
  const explanation = row.querySelector('.inbox-explanation'); if (explanation) explanation.textContent = suggestion.hint ?? suggestion.text;
  const primary = row.querySelector('.chip-action[data-inbox-action]'); if (primary) primary.textContent = suggestion.action.label;
}
export { inboxCard, missingField, repaintInboxCard };
