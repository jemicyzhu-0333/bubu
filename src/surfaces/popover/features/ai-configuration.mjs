import { createAiConnectionTest } from './ai-connection-test.mjs';
import { t, getLocale, onLocaleChanged } from '../../shared/interface/i18n.mjs';

const AUTHORIZATION_WARNING_CODE = 'collaboration-authorization-incomplete';
const AUTHORIZATION_COUNTS = Object.freeze([
  'pendingConversations', 'unsavedConversations', 'unknownSaves',
  'unconfirmedClosures', 'unconfirmedNotifications'
]);

// ARCHITECTURE「AI 与 LLM」: each count describes one observation dimension.
// Sequential saves are not a disjoint set of conversations, so never add them.
function formatAuthorizationWarning(...warnings) {
  let combined = null;
  for (const warning of warnings) {
    if (!warning || warning.code !== AUTHORIZATION_WARNING_CODE) continue;
    if (Object.keys(warning).length !== 7 ||
      !Object.keys(warning).every(key => key === 'code' || key === 'authorityUnavailable' || AUTHORIZATION_COUNTS.includes(key)) ||
      typeof warning.authorityUnavailable !== 'boolean' ||
      !AUTHORIZATION_COUNTS.every(key => Object.hasOwn(warning, key) &&
        (warning[key] === null || Number.isSafeInteger(warning[key]) && warning[key] >= 0))) continue;
    if (!combined) {
      combined = { authorityUnavailable: warning.authorityUnavailable };
      for (const key of AUTHORIZATION_COUNTS) combined[key] = warning[key];
    } else {
      combined.authorityUnavailable ||= warning.authorityUnavailable;
      for (const key of AUTHORIZATION_COUNTS) {
        combined[key] = combined[key] === null || warning[key] === null
          ? null : Math.max(combined[key], warning[key]);
      }
    }
  }
  if (!combined) return '';
  const pending = key => combined[key] === null || combined[key] > 0;
  const count = (key, label) => combined[key] === null
    ? t('{label}数量未知', { label: t(label) }) : t('{label} {count}', { label: t(label), count: combined[key] });
  const joinDetails = detail => detail.join(getLocale() === 'en' ? ', ' : '，');
  const parts = [];
  const livePending = combined.authorityUnavailable || pending('pendingConversations');
  if (livePending) {
    const detail = [];
    if (pending('pendingConversations')) detail.push(count('pendingConversations', '待处理会话'));
    if (combined.authorityUnavailable) detail.push(t('授权状态不可用'));
    parts.push(t('引用授权尚未就绪（{details}）', { details: joinDetails(detail) }));
  }
  if (pending('unsavedConversations') || pending('unknownSaves')) {
    if (!livePending) parts.push(t('引用授权已在本次运行中更新'));
    const detail = [];
    if (pending('unsavedConversations')) detail.push(count('unsavedConversations', '未保存会话'));
    if (pending('unknownSaves')) detail.push(count('unknownSaves', '保存结果未知的会话'));
    parts.push(t('本机会话保存未确认（{details}）', { details: joinDetails(detail) }));
  }
  if (pending('unconfirmedClosures') || pending('unconfirmedNotifications')) {
    const detail = [];
    if (pending('unconfirmedClosures')) detail.push(count('unconfirmedClosures', '资源释放'));
    if (pending('unconfirmedNotifications')) detail.push(count('unconfirmedNotifications', '通知'));
    parts.push(t('先前请求清理未确认（{details}）', { details: joinDetails(detail) }));
  }
  return parts.join(getLocale() === 'en' ? '; ' : '；');
}

// Explicit AI configuration draft: persistence receipts and effective routing
// remain separate, so projection refreshes never erase unsaved input or errors.
function createAiConfiguration({ $, document, getState, surfaceClient }) {
  let dirty = false, saving = false, mounted = false;
  let revision = 0, lifetime = 0, request = 0;
  let acknowledged = null, credentialAcknowledged = null;
  const teardown = [];
  const connectionTest = createAiConnectionTest({ $, document, surfaceClient, isSaving: () => saving });
  let feedbackCopy = () => '', feedbackState = 'saved', feedbackProjectionUnavailable = false;
  let routingCopy = null;
  const fieldIds = ['aiModelInput', 'aiBaseUrlInput', 'aiApiKeyInput'];
  const fieldRevisions = { aiModelInput: 0, aiBaseUrlInput: 0, aiApiKeyInput: 0 };
  function listen(id, event, handler) {
    const el = $(`#${id}`);
    if (!el) return;
    el.addEventListener(event, handler);
    teardown.push(() => el.removeEventListener(event, handler));
  }
  function owns(ticket) {
    return mounted && ticket.lifetime === lifetime && ticket.request === request;
  }
  function feedback(text, state = 'saved') {
    feedbackCopy = typeof text === 'function' ? text : () => t(text);
    feedbackState = state;
    feedbackProjectionUnavailable = false;
    repaintFeedback();
  }
  function repaintFeedback() {
    connectionTest.render();
    const status = $('#aiConfigStatus');
    if (status) {
      status.textContent = feedbackCopy();
      status.dataset.state = feedbackState;
    }
    for (const id of ['aiImportCredential', 'aiClearCredential']) {
      const action = $(`#${id}`);
      if (action) action.disabled = saving;
    }
    const button = $('#aiSaveConfig');
    if (button) {
      button.disabled = saving;
      button.textContent = t(saving ? '正在保存…' : '保存配置');
    }
  }
  function acknowledgeCredential(result) {
    const configured = result?.credentialStatus === 'unavailable' ? null : result?.configured;
    if (configured !== null && typeof configured !== 'boolean') return true;
    // The command receipt is known before an injected projection read can fail.
    const receipt = { configured, projection: null, baselineKnown: false };
    credentialAcknowledged = receipt;
    try {
      const state = getState();
      if (!state) return false;
      receipt.projection = state.ai?.credential;
      receipt.baselineKnown = true;
      return true;
    } catch (_) {
      return false;
    }
  }
  function outcomeFeedback(text, state, warnings, credentialUnavailable = false, projectionUnavailable = false) {
    const hasWarning = Boolean(formatAuthorizationWarning(...warnings) || credentialUnavailable || projectionUnavailable);
    feedback(() => {
      const suffix = [formatAuthorizationWarning(...warnings), credentialUnavailable ? t('密钥状态暂不可确认') : '',
        projectionUnavailable ? t('界面状态暂不可确认') : ''].filter(Boolean);
      return [typeof text === 'function' ? text() : t(text), ...suffix].join(getLocale() === 'en' ? '; ' : '；');
    }, state === 'error' ? state : hasWarning ? 'warning' : state);
    feedbackProjectionUnavailable = projectionUnavailable;
  }
  function render(ticket) {
    connectionTest.render();
    const state = getState();
    if (ticket && !owns(ticket)) return;
    if (!state) return false;
    if (
      acknowledged &&
      state.settings.aiModel === acknowledged.model &&
      (state.settings.aiBaseUrl || '') === acknowledged.baseUrl
    ) acknowledged = null;
    if (!dirty && !saving) {
      $('#aiModelInput').value = acknowledged?.model ?? state.settings.aiModel ?? '';
      $('#aiBaseUrlInput').value = acknowledged?.baseUrl ?? state.settings.aiBaseUrl ?? '';
    }
    const ai = state.ai;
    const projected = ai?.credential;
    const verified = projected?.credentialStatus !== 'unavailable' &&
      typeof projected?.configured === 'boolean';
    if (credentialAcknowledged?.configured === null && !credentialAcknowledged.baselineKnown) {
      // A failed baseline read cannot turn the first old projection into proof.
      credentialAcknowledged.projection = projected;
      credentialAcknowledged.baselineKnown = true;
    } else if (credentialAcknowledged && verified &&
      (credentialAcknowledged.configured === null
        ? projected !== credentialAcknowledged.projection
        : projected.configured === credentialAcknowledged.configured)) credentialAcknowledged = null;
    const configured = credentialAcknowledged
      ? credentialAcknowledged.configured : verified ? projected.configured : null;
    routingCopy = { configured, ai };
    repaintRouting();
  }
  function repaintRouting() {
    if (!routingCopy) return;
    const { configured, ai, unavailable } = routingCopy;
    const credential = $('#aiCredentialState');
    if (credential) credential.textContent = t(configured === null ? '状态未知' : configured ? '已配置' : '未配置');
    const mode = $('#aiActiveMode');
    if (mode) mode.textContent = unavailable ? t('状态暂不可确认') : !ai?.enabled
      ? t('AI 已关闭') : configured === null ? t('尚未就绪 · 密钥状态未知')
        : configured && ai.disclosure?.activeProvider === 'api'
          ? t('已就绪 · {model}', { model: ai.model }) : t('尚未就绪 · 请保存模型与密钥');
  }
  function finish(ticket) {
    if (!owns(ticket)) return;
    saving = false;
    repaintFeedback();
    const button = $('#aiSaveConfig');
    if (button) {
      button.disabled = false;
      button.textContent = t('保存配置');
    }
    let observed = false;
    try { observed = render(ticket) !== false; }
    catch (_) { /* A missing or failed projection cannot undo a known commit. */ }
    if (observed || !owns(ticket)) return;
    routingCopy = { configured: null, unavailable: true };
    repaintRouting();
    const status = $('#aiConfigStatus');
    if (status && !feedbackProjectionUnavailable)
      outcomeFeedback(feedbackCopy, feedbackState, [], false, true);
  }
  async function save() {
    if (!mounted || saving) return;
    connectionTest.cancel({ clear: true });
    const model = $('#aiModelInput').value.trim();
    const baseUrl = $('#aiBaseUrlInput').value.trim();
    const secret = $('#aiApiKeyInput').value.trim();
    if (!model) {
      feedback('请输入模型名称', 'error');
      return;
    }
    const ticket = { lifetime, request: ++request };
    const version = revision, secretVersion = fieldRevisions.aiApiKeyInput;
    saving = true;
    feedback('正在保存…', 'saving');
    let settingsSaved = false, credentialSaved = false;
    const warnings = [];
    try {
      const result = await surfaceClient.updateSettings({ aiModel: model, aiBaseUrl: baseUrl || null });
      // A remount cannot revive this continuation or submit its captured secret.
      if (!owns(ticket)) return;
      if (result?.ok !== true) throw new Error('settings-rejected');
      settingsSaved = true;
      warnings.push(result?.authorizationWarning);
      acknowledged = {
        model: result?.settings?.aiModel ?? model,
        baseUrl: result?.settings ? result.settings.aiBaseUrl || '' : baseUrl
      };
      let credentialUnavailable = false, projectionUnavailable = false;
      if (secret) {
        if (!owns(ticket)) return;
        // Even an edit back to the same text belongs to the next save.
        if (fieldRevisions.aiApiKeyInput === secretVersion && $('#aiApiKeyInput').value.trim() === secret)
          $('#aiApiKeyInput').value = '';
        const credential = await surfaceClient.saveAiCredential(secret);
        if (!owns(ticket)) return;
        credentialSaved = credential?.ok === true;
        projectionUnavailable = !acknowledgeCredential(credential);
        if (!owns(ticket)) return;
        warnings.push(credential?.authorizationWarning);
        credentialUnavailable = credential?.credentialStatus === 'unavailable';
        if (!credential?.ok) {
          outcomeFeedback('配置已保存，密钥未保存：系统安全存储不可用', 'error', warnings,
            credentialUnavailable, projectionUnavailable);
          return;
        }
      }
      dirty = revision !== version;
      const warning = formatAuthorizationWarning(...warnings);
      outcomeFeedback(
        dirty ? '配置已保存 · 另有修改待保存'
          : warning || credentialUnavailable || projectionUnavailable ? secret ? '配置与密钥已保存' : '配置已保存'
            : '已保存 · 下次 AI 请求生效',
        dirty ? 'dirty' : 'saved', warnings, credentialUnavailable, projectionUnavailable
      );
    } catch (_) {
      if (owns(ticket)) outcomeFeedback(
        credentialSaved ? '配置与密钥已保存' : settingsSaved ? '配置已保存，密钥未保存：系统安全存储不可用'
          : '未保存 · 请检查模型名称与 HTTPS 地址',
        credentialSaved ? 'warning' : 'error', warnings, false, credentialSaved
      );
    } finally {
      finish(ticket);
    }
  }
  async function manageCredential(kind) {
    if (!mounted || saving) return;
    connectionTest.cancel({ clear: true });
    const ticket = { lifetime, request: ++request };
    saving = true;
    feedback('正在保存…', 'saving');
    let committed = false;
    try {
      const result = kind === 'import'
        ? await surfaceClient.importAiCredential() : await surfaceClient.clearAiCredential();
      if (!owns(ticket)) return;
      committed = result?.ok === true;
      const projectionUnavailable = !acknowledgeCredential(result);
      if (!owns(ticket)) return;
      const failed = result?.ok !== true;
      const text = failed
        ? kind === 'import' ? '未导入 · 环境变量或安全存储不可用' : '未清除 · 系统安全存储不可用'
        : dirty ? kind === 'import' ? '密钥已导入 · 其他修改待保存' : '密钥已清除 · 其他修改待保存'
          : kind === 'import' ? '密钥已导入' : '密钥已清除';
      outcomeFeedback(text, failed ? 'error' : dirty ? 'dirty' : 'saved',
        [result?.authorizationWarning], result?.credentialStatus === 'unavailable', projectionUnavailable);
    } catch (_) {
      if (owns(ticket)) {
        if (committed) outcomeFeedback(kind === 'import' ? '密钥已导入' : '密钥已清除',
          'warning', [], false, true);
        else feedback('操作失败，请重试', 'error');
      }
    } finally {
      finish(ticket);
    }
  }
  function mount() {
    if (mounted) return;
    mounted = true;
    connectionTest.mount();
    teardown.push(onLocaleChanged(() => { repaintFeedback(); repaintRouting(); }));
    lifetime++;
    saving = false;
    feedback(dirty ? '修改待保存' : '', dirty ? 'dirty' : 'saved');
    for (const id of fieldIds) {
      listen(id, 'input', () => {
        connectionTest.cancel({ clear: true });
        dirty = true;
        revision++;
        fieldRevisions[id]++;
        feedback('修改待保存', 'dirty');
      });
      listen(id, 'keydown', event => {
        if (event.key === 'Enter' && !event.isComposing && event.keyCode !== 229) {
          event.preventDefault();
          void save();
        }
      });
    }
    listen('aiSaveConfig', 'click', () => { void save(); });
    listen('aiImportCredential', 'click', () => { void manageCredential('import'); });
    listen('aiClearCredential', 'click', () => { void manageCredential('clear'); });
  }
  function dispose() {
    connectionTest.dispose();
    mounted = false;
    lifetime++;
    saving = false;
    while (teardown.length) teardown.pop()();
  }
  return Object.freeze({ mount, render, dispose, save, cancelTest: () => connectionTest.cancel({ clear: true }) });
}
export { createAiConfiguration, formatAuthorizationWarning };
