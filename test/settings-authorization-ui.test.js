'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAiConfiguration, formatAuthorizationWarning } = require('../src/surfaces/popover/features/ai-configuration.mjs');
const { createPopoverSettingsDrawer } = require('../src/surfaces/popover/features/settings-drawer.mjs');
const { createAuthorizationSettingsDom } = require('./fixtures/authorization-settings-dom');

function warning(values = {}) {
  return { code: 'collaboration-authorization-incomplete', pendingConversations: 0,
    unsavedConversations: 0, unknownSaves: 0, unconfirmedClosures: 0,
    unconfirmedNotifications: 0, authorityUnavailable: false, ...values };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function settle() {
  // Only awaited promise continuations, with no timer/event-loop substitute.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
function state() {
  return { settings: { aiModel: 'old-model', aiBaseUrl: '', aiBreakdownEnabled: false,
    aiMemoryEnabled: false, pomodoroMinutes: 25, breakMinutes: 5,
    softReminderEvery: 20, hydrationEvery: 60 },
  ai: { enabled: true, model: 'old-model', credential: { configured: true },
    disclosure: { activeProvider: 'api', network: false } } };
}
function aiHarness(overrides = {}, readState = current => current) {
  const dom = createAuthorizationSettingsDom(), current = state(), calls = [];
  const surfaceClient = {
    updateSettings: async patch => { calls.push({ patch }); return { ok: true }; },
    saveAiCredential: async secret => { calls.push({ secret }); return { ok: true, configured: true }; },
    importAiCredential: async () => ({ ok: true, configured: true }),
    clearAiCredential: async () => ({ ok: true, configured: false }),
    ...overrides
  };
  const feature = createAiConfiguration({ $: dom.$, getState: () => readState(current), surfaceClient });
  feature.mount();
  feature.render();
  return { ...dom, state: current, calls, feature, status: () => dom.$('#aiConfigStatus') };
}
function drawerHarness(updateSettings, clientOverrides = {}) {
  const dom = createAuthorizationSettingsDom(), current = state(), calls = [];
  // No getUpdateStatus and no appUpdateGroup node: updater mount returns before
  // refresh/listeners/timer creation. Existing drawer.dispose still calls the
  // never-mounted updater dispose, whose native clearTimeout(null) is a no-op.
  // This is disclosed cleanup, not an updater execution/timer-release claim.
  const surfaceClient = { updateSettings: patch => { calls.push(patch); return updateSettings(patch); },
    ...clientOverrides };
  const feature = createPopoverSettingsDrawer({ ...dom, getState: () => current,
    surfaceClient, sessionDuration: { clampFocusMinutes: value => value },
    syncPressedButtons() {}, fallbackReasonText: value => value, motionReduced: () => true,
    clearDecorativeMotion() {}, renderExpiryPreview() {}, activeLandingPrompt: () => null,
    rememberLandingReturnFocus() {}, renderLanding() {} });
  feature.mount();
  return { ...dom, state: current, calls, feature,
    save: () => dom.fire('[data-toggle="aiMemoryEnabled"]', 'click'),
    status: () => dom.$('#settingsSaveStatus') };
}

test('closed authorization formatter never renders arbitrary fields or malformed counts', () => {
  assert.equal(formatAuthorizationWarning(null, { reason: 'private-data' }), '');
  assert.equal(formatAuthorizationWarning(warning({ pendingConversations: 1, detail: 'private-data' })), '');
  for (const invalid of [-1, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1, 'private-data', undefined])
    assert.equal(formatAuthorizationWarning(warning({ pendingConversations: invalid })), '');
  assert.equal(formatAuthorizationWarning(warning({ authorityUnavailable: 'private-data' })), '');
  assert.equal(formatAuthorizationWarning(warning()), '');
});

test('pending live authorization and unavailable authority have distinct truthful wording', () => {
  const pending = formatAuthorizationWarning(warning({ pendingConversations: 2 }));
  assert.match(pending, /引用授权尚未就绪.*待处理会话 2/);
  assert.doesNotMatch(pending, /本机会话保存|请求清理|已在本次运行中更新/);
  const unavailable = formatAuthorizationWarning(warning({ authorityUnavailable: true }));
  assert.match(unavailable, /引用授权尚未就绪.*授权状态不可用/);
  assert.doesNotMatch(unavailable, /未保存会话|待处理会话 0/);
});

test('save-only uncertainty says authorization changed live without claiming durable saving', () => {
  const text = formatAuthorizationWarning(warning({ unsavedConversations: 3, unknownSaves: 2 }));
  assert.match(text, /引用授权已在本次运行中更新；本机会话保存未确认/);
  assert.match(text, /未保存会话 3，保存结果未知的会话 2/);
  assert.doesNotMatch(text, /尚未就绪|会话 5/);
});

test('cleanup-only uncertainty never claims pending privacy or remote cancellation', () => {
  const text = formatAuthorizationWarning(warning({ unconfirmedClosures: 2, unconfirmedNotifications: 1 }));
  assert.match(text, /先前请求清理未确认（资源释放 2，通知 1）/);
  assert.doesNotMatch(text, /引用授权尚未就绪|未保存|远程.*取消|退款/);
});

test('sequential warning counts use comparable maxima and retain the authority flag', () => {
  const text = formatAuthorizationWarning(
    warning({ pendingConversations: 2, unsavedConversations: 3, unconfirmedClosures: 1 }),
    warning({ pendingConversations: 3, unsavedConversations: 2, unconfirmedClosures: 4, authorityUnavailable: true }));
  assert.match(text, /待处理会话 3/);
  assert.match(text, /未保存会话 3/);
  assert.match(text, /资源释放 4/);
  assert.match(text, /授权状态不可用/);
  assert.doesNotMatch(text, /会话 5|资源释放 5/);
});

test('null dominates zero and known counts in each sequential warning dimension and order', () => {
  for (const key of ['pendingConversations', 'unsavedConversations', 'unknownSaves', 'unconfirmedClosures', 'unconfirmedNotifications']) {
    for (const known of [0, 3]) {
      const unknown = warning({ [key]: null }), observed = warning({ [key]: known });
      const forward = formatAuthorizationWarning(unknown, observed);
      assert.match(forward, /数量未知/);
      assert.equal(forward, formatAuthorizationWarning(observed, unknown));
      assert.doesNotMatch(forward, / 0| 3/);
    }
  }
});

test('actual drawer ignores older success while the newer save is pending', async () => {
  const first = deferred(), second = deferred();
  let count = 0;
  const h = drawerHarness(() => ++count === 1 ? first.promise : second.promise);
  h.save(); h.save();
  assert.equal(h.calls.length, 2);
  first.resolve({ ok: true, authorizationWarning: warning({ pendingConversations: 1 }) });
  await settle();
  assert.equal(h.status().dataset.state, 'saving');
  second.resolve({ ok: true }); await settle();
  assert.equal(h.status().textContent, '已保存并生效');
  h.feature.dispose();
});

test('actual drawer ignores an older rejection after newer committed success', async () => {
  const first = deferred(), second = deferred();
  let count = 0;
  const h = drawerHarness(() => ++count === 1 ? first.promise : second.promise);
  h.save(); h.save();
  second.resolve({ ok: true }); await settle();
  first.reject(new Error('synthetic private failure')); await settle();
  assert.equal(h.status().dataset.state, 'saved');
  assert.equal(h.status().textContent, '已保存并生效');
  h.feature.dispose();
});

test('actual drawer committed warning distinguishes authority, saving, and cleanup', async () => {
  const h = drawerHarness(async () => ({ ok: true, authorizationWarning: warning({
    pendingConversations: 1, unknownSaves: null, unconfirmedClosures: 1 }) }));
  h.save(); await settle();
  assert.equal(h.status().dataset.state, 'warning');
  assert.match(h.status().textContent, /^设置已保存；引用授权尚未就绪/);
  assert.match(h.status().textContent, /本机会话保存未确认.*数量未知/);
  assert.match(h.status().textContent, /先前请求清理未确认/);
  assert.doesNotMatch(h.status().textContent, /设置未保存|已保存并生效/);
  h.feature.dispose();
});

test('actual drawer disposed status is not mutated by its pending save', async () => {
  const pending = deferred(), h = drawerHarness(() => pending.promise);
  h.save(); h.feature.dispose();
  h.status().textContent = 'detached status';
  pending.resolve({ ok: true }); await settle();
  assert.equal(h.status().textContent, 'detached status');
});

test('actual drawer remount cannot revive an older save result', async () => {
  const first = deferred(), second = deferred();
  let count = 0;
  const h = drawerHarness(() => ++count === 1 ? first.promise : second.promise);
  h.save(); h.feature.dispose(); h.feature.mount(); h.save();
  first.resolve({ ok: true, authorizationWarning: warning({ authorityUnavailable: true }) });
  await settle();
  assert.equal(h.status().dataset.state, 'saving');
  second.resolve({ ok: false }); await settle();
  assert.equal(h.status().dataset.state, 'error');
  assert.equal(h.status().textContent, '未保存，请重试');
  h.feature.dispose();
});

test('AI settings-only committed warning retains settings receipt without resubmission', async () => {
  let commits = 0;
  const h = aiHarness({ updateSettings: async () => {
    commits++; return { ok: true, authorizationWarning: warning({ unsavedConversations: 1 }) };
  } });
  h.input('#aiModelInput', 'new-model');
  await h.feature.save(); h.feature.render();
  assert.equal(commits, 1);
  assert.equal(h.calls.length, 0);
  assert.equal(h.$('#aiModelInput').value, 'new-model');
  assert.equal(h.status().dataset.state, 'warning');
  assert.match(h.status().textContent, /^配置已保存；引用授权已在本次运行中更新/);
  h.feature.dispose();
});

test('actual AI settings then credential warnings retain nulls and use maxima, never sums', async () => {
  const h = aiHarness({
    updateSettings: async () => ({ ok: true, authorizationWarning: warning({ pendingConversations: 2,
      unsavedConversations: null, unconfirmedNotifications: 3 }) }),
    saveAiCredential: async () => ({ ok: true, configured: true, authorizationWarning: warning({
      pendingConversations: 3, unsavedConversations: 2, unconfirmedNotifications: 1 }) })
  });
  h.input('#aiApiKeyInput', 'synthetic-secret');
  await h.feature.save();
  assert.equal(h.status().dataset.state, 'warning');
  assert.match(h.status().textContent, /^配置与密钥已保存；/);
  assert.match(h.status().textContent, /待处理会话 3/);
  assert.match(h.status().textContent, /未保存会话数量未知/);
  assert.match(h.status().textContent, /通知 3/);
  assert.doesNotMatch(h.status().textContent, /会话 5|通知 4/);
  h.feature.dispose();
});

test('committed credential with unavailable status remains unknown through stale projections', async () => {
  const h = aiHarness({ saveAiCredential: async () => ({ ok: true, credentialStatus: 'unavailable' }) });
  h.input('#aiApiKeyInput', 'synthetic-secret');
  await h.feature.save(); h.feature.render();
  assert.match(h.status().textContent, /配置与密钥已保存.*密钥状态暂不可确认/);
  assert.equal(h.status().dataset.state, 'warning');
  assert.equal(h.$('#aiCredentialState').textContent, '状态未知');
  assert.equal(h.$('#aiActiveMode').textContent, '尚未就绪 · 密钥状态未知');
  h.state.ai.credential = { configured: true }; h.feature.render();
  assert.equal(h.$('#aiCredentialState').textContent, '已配置');
  h.feature.dispose();
});

test('missing projected credential status is unknown rather than invented configured false', () => {
  const h = aiHarness();
  h.state.ai.credential = { available: false }; h.feature.render();
  assert.equal(h.$('#aiCredentialState').textContent, '状态未知');
  h.state.ai.credential = { configured: false }; h.feature.render();
  assert.equal(h.$('#aiCredentialState').textContent, '未配置');
  h.feature.dispose();
});

test('already absent clear succeeds while unavailable status stays unknown', async () => {
  const h = aiHarness({ clearAiCredential: async () => ({ ok: true, removed: false, credentialStatus: 'unavailable',
    authorizationWarning: warning({ unconfirmedClosures: 1 }) }) });
  h.fire('#aiClearCredential', 'click'); await settle();
  assert.equal(h.status().dataset.state, 'warning');
  assert.match(h.status().textContent, /^密钥已清除；先前请求清理未确认/);
  assert.match(h.status().textContent, /密钥状态暂不可确认/);
  assert.equal(h.$('#aiCredentialState').textContent, '状态未知');
  assert.doesNotMatch(h.status().textContent, /失败|未清除|未导入/);
  h.feature.dispose();
});

test('actual credential import warning preserves newer field edits and successful import', async () => {
  const pending = deferred(), h = aiHarness({ importAiCredential: () => pending.promise });
  h.fire('#aiImportCredential', 'click');
  h.input('#aiModelInput', 'newer-draft');
  pending.resolve({ ok: true, configured: true, authorizationWarning: warning({ pendingConversations: 2 }) });
  await settle();
  assert.equal(h.$('#aiModelInput').value, 'newer-draft');
  assert.match(h.status().textContent, /^密钥已导入 · 其他修改待保存；引用授权尚未就绪/);
  assert.equal(h.status().dataset.state, 'warning');
  h.feature.dispose();
});

test('settings failure never clears or submits a captured credential', async () => {
  const h = aiHarness({ updateSettings: async () => ({ ok: false }) });
  h.input('#aiApiKeyInput', 'synthetic-secret');
  await h.feature.save();
  assert.equal(h.calls.length, 0);
  assert.equal(h.$('#aiApiKeyInput').value, 'synthetic-secret');
  assert.equal(h.status().dataset.state, 'error');
  h.feature.dispose();
});

test('disposal while settings awaits prevents credential continuation and detached mutation', async () => {
  const pending = deferred(), h = aiHarness({ updateSettings: () => pending.promise });
  h.input('#aiApiKeyInput', 'synthetic-secret');
  const saving = h.feature.save(); h.feature.dispose();
  h.status().textContent = 'detached status';
  pending.resolve({ ok: true }); await saving;
  assert.equal(h.calls.length, 0);
  assert.equal(h.$('#aiApiKeyInput').value, 'synthetic-secret');
  assert.equal(h.status().textContent, 'detached status');
  assert.equal(h.$('#aiSaveConfig').disabled, true, 'old finally cannot mutate a detached button');
});

test('dispose/remount cannot revive old credential continuation or reset a newer save', async () => {
  const first = deferred(), second = deferred();
  let count = 0;
  const h = aiHarness({ updateSettings: () => ++count === 1 ? first.promise : second.promise });
  h.input('#aiModelInput', 'first-model'); h.input('#aiApiKeyInput', 'synthetic-first');
  const oldSave = h.feature.save();
  h.feature.dispose(); h.feature.mount();
  h.input('#aiModelInput', 'second-model'); h.input('#aiApiKeyInput', 'synthetic-second');
  const newSave = h.feature.save();
  first.resolve({ ok: true }); await oldSave;
  assert.equal(h.calls.length, 0);
  assert.equal(h.$('#aiApiKeyInput').value, 'synthetic-second');
  assert.equal(h.$('#aiSaveConfig').disabled, true);
  assert.equal(h.status().dataset.state, 'saving');
  second.resolve({ ok: true }); await newSave;
  assert.deepEqual(h.calls, [{ secret: 'synthetic-second' }]);
  assert.equal(h.$('#aiModelInput').value, 'second-model');
  assert.equal(h.$('#aiSaveConfig').disabled, false);
  h.feature.dispose();
});

test('late credential response after remount cannot change status or finish the new request', async () => {
  const credential = deferred(), settings = deferred();
  let count = 0;
  const h = aiHarness({ updateSettings: () => ++count === 1 ? Promise.resolve({ ok: true }) : settings.promise,
    saveAiCredential: () => credential.promise });
  h.input('#aiApiKeyInput', 'synthetic-first');
  const oldSave = h.feature.save(); await settle();
  h.feature.dispose(); h.feature.mount();
  h.input('#aiModelInput', 'newer-model');
  const newSave = h.feature.save();
  credential.resolve({ ok: true, credentialStatus: 'unavailable', authorizationWarning: warning({ authorityUnavailable: true }) });
  await oldSave;
  assert.equal(h.status().dataset.state, 'saving');
  assert.equal(h.$('#aiSaveConfig').disabled, true);
  assert.equal(h.$('#aiCredentialState').textContent, '已配置');
  settings.resolve({ ok: true }); await newSave;
  assert.equal(h.status().dataset.state, 'saved');
  assert.equal(h.$('#aiModelInput').value, 'newer-model');
  h.feature.dispose();
});

test('later input survives while the original owned credential save proceeds only once', async () => {
  const pending = deferred(), h = aiHarness({ updateSettings: () => pending.promise });
  h.input('#aiModelInput', 'first-model'); h.input('#aiApiKeyInput', 'synthetic-first');
  const saving = h.feature.save();
  h.input('#aiModelInput', 'second-model'); h.input('#aiApiKeyInput', 'synthetic-second');
  pending.resolve({ ok: true }); await saving;
  assert.deepEqual(h.calls, [{ secret: 'synthetic-first' }]);
  assert.equal(h.$('#aiModelInput').value, 'second-model');
  assert.equal(h.$('#aiApiKeyInput').value, 'synthetic-second');
  assert.equal(h.status().dataset.state, 'dirty');
  assert.match(h.status().textContent, /配置已保存.*另有修改待保存/);
  h.feature.dispose();
});

test('editing a credential back to identical text remains a newer unsaved draft', async () => {
  const pending = deferred(), h = aiHarness({ updateSettings: () => pending.promise });
  h.input('#aiApiKeyInput', 'synthetic-same');
  const saving = h.feature.save();
  h.input('#aiApiKeyInput', 'synthetic-intermediate'); h.input('#aiApiKeyInput', 'synthetic-same');
  pending.resolve({ ok: true }); await saving;
  assert.deepEqual(h.calls, [{ secret: 'synthetic-same' }]);
  assert.equal(h.$('#aiApiKeyInput').value, 'synthetic-same');
  assert.equal(h.status().dataset.state, 'dirty');
  h.feature.dispose();
});

test('credential failure preserves committed settings warning and never retries settings', async () => {
  let commits = 0;
  const h = aiHarness({ updateSettings: async () => {
    commits++; return { ok: true, settings: { aiModel: 'new-model', aiBaseUrl: 'https://example.invalid/v1' },
      authorizationWarning: warning({ unknownSaves: 1 }) };
  }, saveAiCredential: async () => ({ ok: false, credentialStatus: 'unavailable' }) });
  h.input('#aiModelInput', 'new-model'); h.input('#aiApiKeyInput', 'synthetic-secret');
  await h.feature.save(); h.feature.render();
  assert.equal(commits, 1);
  assert.equal(h.$('#aiApiKeyInput').value, '');
  assert.equal(h.$('#aiModelInput').value, 'new-model');
  assert.equal(h.status().dataset.state, 'error');
  assert.match(h.status().textContent, /^配置已保存，密钥未保存/);
  assert.match(h.status().textContent, /本机会话保存未确认/);
  assert.match(h.status().textContent, /密钥状态暂不可确认/);
  assert.equal(h.$('#aiCredentialState').textContent, '状态未知');
  h.feature.dispose();
});

test('old credential rejection after remount cannot replace the newer completion', async () => {
  const pending = deferred(), h = aiHarness({ saveAiCredential: () => pending.promise });
  h.input('#aiApiKeyInput', 'synthetic-secret');
  const oldSave = h.feature.save(); await settle();
  h.feature.dispose(); h.feature.mount();
  h.input('#aiModelInput', 'newer-model');
  await h.feature.save();
  pending.reject(new Error('private synthetic credential error')); await oldSave;
  assert.equal(h.status().dataset.state, 'saved');
  assert.equal(h.status().textContent, '已保存 · 下次 AI 请求生效');
  assert.equal(h.$('#aiModelInput').value, 'newer-model');
  h.feature.dispose();
});

test('credential management continuation cannot survive disposal and remount', async () => {
  const old = deferred(), next = deferred();
  const h = aiHarness({ importAiCredential: () => old.promise, clearAiCredential: () => next.promise });
  h.fire('#aiImportCredential', 'click'); h.feature.dispose(); h.feature.mount();
  h.fire('#aiClearCredential', 'click');
  old.resolve({ ok: true, credentialStatus: 'unavailable' }); await settle();
  assert.equal(h.status().dataset.state, 'saving');
  assert.equal(h.$('#aiSaveConfig').disabled, true);
  next.resolve({ ok: true, configured: false }); await settle();
  assert.equal(h.status().textContent, '密钥已清除');
  assert.equal(h.$('#aiCredentialState').textContent, '未配置');
  assert.equal(h.$('#aiActiveMode').textContent, '尚未就绪 · 请保存模型与密钥');
  assert.equal(h.$('#aiSaveConfig').disabled, false);
  h.feature.dispose();
});

test('credential save acknowledgment survives getState throwing after the credential commits', async () => {
  let committed = false, settingsCalls = 0, credentialCalls = 0, failedReads = 0;
  const h = aiHarness({
    updateSettings: async () => { settingsCalls++; return { ok: true }; },
    saveAiCredential: async () => {
      credentialCalls++; committed = true;
      return { ok: true, configured: true, authorizationWarning: warning({ unknownSaves: 1 }) };
    }
  }, current => {
    if (committed) { failedReads++; throw new Error('private projection failure'); }
    return current;
  });
  h.input('#aiModelInput', 'committed-model'); h.input('#aiApiKeyInput', 'synthetic-secret');
  await assert.doesNotReject(h.feature.save());
  assert.equal(settingsCalls, 1); assert.equal(credentialCalls, 1);
  assert.equal(failedReads, 2, 'acknowledgment and final render are independently isolated');
  assert.match(h.status().textContent, /^配置与密钥已保存；/);
  assert.match(h.status().textContent, /本机会话保存未确认/);
  assert.match(h.status().textContent, /界面状态暂不可确认/);
  assert.doesNotMatch(h.status().textContent, /密钥未保存|操作失败|请重试|private/);
  assert.equal(h.status().dataset.state, 'warning');
  assert.equal(h.$('#aiCredentialState').textContent, '状态未知');
  assert.equal(h.$('#aiActiveMode').textContent, '状态暂不可确认');
  assert.equal(h.$('#aiApiKeyInput').value, '');
  assert.equal(h.$('#aiSaveConfig').disabled, false);
  committed = false; h.feature.render();
  assert.equal(h.$('#aiModelInput').value, 'committed-model');
  assert.equal(h.$('#aiCredentialState').textContent, '已配置');
  h.feature.dispose();
});

test('credential import stays committed when postcommit getState throws', async () => {
  let committed = false, commits = 0, failedReads = 0;
  const h = aiHarness({ importAiCredential: async () => {
    commits++; committed = true; return { ok: true, configured: true };
  } }, current => {
    if (committed) { failedReads++; throw new Error('private import projection failure'); }
    return current;
  });
  h.fire('#aiImportCredential', 'click'); await settle();
  assert.equal(commits, 1); assert.equal(failedReads, 2);
  assert.match(h.status().textContent, /^密钥已导入；界面状态暂不可确认$/);
  assert.doesNotMatch(h.status().textContent, /未导入|操作失败|请重试|private/);
  assert.equal(h.status().dataset.state, 'warning');
  assert.equal(h.$('#aiCredentialState').textContent, '状态未知');
  assert.equal(h.$('#aiSaveConfig').disabled, false);
  h.feature.dispose();
});

test('already absent credential clear stays committed when postcommit getState throws', async () => {
  let committed = false, commits = 0, failedReads = 0;
  const h = aiHarness({ clearAiCredential: async () => {
    commits++; committed = true; return { ok: true, removed: false, configured: false };
  } }, current => {
    if (committed) { failedReads++; throw new Error('private clear projection failure'); }
    return current;
  });
  h.fire('#aiClearCredential', 'click'); await settle();
  assert.equal(commits, 1); assert.equal(failedReads, 2);
  assert.match(h.status().textContent, /^密钥已清除；界面状态暂不可确认$/);
  assert.doesNotMatch(h.status().textContent, /未清除|操作失败|请重试|private/);
  assert.equal(h.status().dataset.state, 'warning');
  assert.equal(h.$('#aiCredentialState').textContent, '状态未知');
  assert.equal(h.$('#aiSaveConfig').disabled, false);
  committed = false; h.feature.render();
  assert.equal(h.$('#aiCredentialState').textContent, '未配置');
  h.feature.dispose();
});

test('settings-only success cannot be rejected by a throwing final getState render', async () => {
  let committed = false, commits = 0, failedReads = 0;
  const h = aiHarness({ updateSettings: async () => {
    commits++; committed = true; return { ok: true };
  } }, current => {
    if (committed) { failedReads++; throw new Error('private settings projection failure'); }
    return current;
  });
  h.input('#aiModelInput', 'committed-model');
  await assert.doesNotReject(h.feature.save());
  assert.equal(commits, 1); assert.equal(failedReads, 1);
  assert.match(h.status().textContent, /^已保存.*界面状态暂不可确认$/);
  assert.doesNotMatch(h.status().textContent, /密钥未保存|操作失败|请重试|private/);
  assert.equal(h.status().dataset.state, 'warning');
  assert.equal(h.$('#aiSaveConfig').disabled, false);
  committed = false; h.feature.render();
  assert.equal(h.$('#aiModelInput').value, 'committed-model');
  h.feature.dispose();
});

test('unavailable credential status with failed baseline read cannot trust the first old projection', async () => {
  let failNextRead = false, failedReads = 0;
  const h = aiHarness({ saveAiCredential: async () => {
    failNextRead = true; return { ok: true, credentialStatus: 'unavailable' };
  } }, current => {
    if (failNextRead) { failNextRead = false; failedReads++; throw new Error('private baseline failure'); }
    return current;
  });
  h.input('#aiApiKeyInput', 'synthetic-secret');
  await assert.doesNotReject(h.feature.save()); h.feature.render();
  assert.equal(failedReads, 1);
  assert.match(h.status().textContent, /^配置与密钥已保存；密钥状态暂不可确认；界面状态暂不可确认$/);
  assert.equal(h.$('#aiCredentialState').textContent, '状态未知');
  h.state.ai.credential = { configured: true }; h.feature.render();
  assert.equal(h.$('#aiCredentialState').textContent, '已配置');
  h.feature.dispose();
});

test('final render failure after a successful acknowledgment cannot reject credential success', async () => {
  let committed = false, postcommitReads = 0, commits = 0;
  const h = aiHarness({ saveAiCredential: async () => {
    committed = true; commits++; return { ok: true, configured: true };
  } }, current => {
    if (committed && ++postcommitReads === 2) throw new Error('private final render failure');
    return current;
  });
  h.input('#aiApiKeyInput', 'synthetic-secret');
  await assert.doesNotReject(h.feature.save());
  assert.equal(commits, 1); assert.equal(postcommitReads, 2);
  assert.match(h.status().textContent, /^已保存.*界面状态暂不可确认$/);
  assert.doesNotMatch(h.status().textContent, /密钥未保存|操作失败|请重试|private/);
  assert.equal(h.status().dataset.state, 'warning');
  assert.equal(h.$('#aiCredentialState').textContent, '状态未知');
  assert.equal(h.$('#aiSaveConfig').disabled, false);
  h.feature.dispose();
});

test('mounted drawer refreshes unknown credential status on a fresh same-value projection', async () => {
  let credentialCommits = 0;
  const h = drawerHarness(async () => ({ ok: true }), {
    saveAiCredential: async () => {
      credentialCommits++; return { ok: true, credentialStatus: 'unavailable' };
    }
  });
  h.feature.renderSettings();
  assert.equal(h.$('#aiCredentialState').textContent, '已配置');
  h.input('#aiApiKeyInput', 'synthetic-secret');
  h.fire('#aiSaveConfig', 'click'); await settle();
  assert.equal(credentialCommits, 1);
  assert.equal(h.$('#aiCredentialState').textContent, '状态未知');
  h.feature.renderSettings();
  assert.equal(h.$('#aiCredentialState').textContent, '状态未知', 'same old projection is not new evidence');
  h.state.ai.credential = { configured: true };
  h.feature.renderSettings();
  assert.equal(h.$('#aiCredentialState').textContent, '已配置', 'leaf observes new evidence even when drawer key is unchanged');
  assert.equal(h.$('#aiActiveMode').textContent, '已就绪 · old-model');
  assert.equal(credentialCommits, 1);
  h.feature.dispose();
});

test('null or undefined postcommit projection replaces stale readiness with unknown status', async () => {
  for (const missing of [null, undefined]) {
    let committed = false, commits = 0, missingReads = 0;
    const h = aiHarness({ saveAiCredential: async () => {
      committed = true; commits++; return { ok: true, configured: true };
    } }, current => {
      if (committed) { missingReads++; return missing; }
      return current;
    });
    assert.equal(h.$('#aiCredentialState').textContent, '已配置');
    assert.equal(h.$('#aiActiveMode').textContent, '已就绪 · old-model');
    h.input('#aiApiKeyInput', 'synthetic-secret');
    await assert.doesNotReject(h.feature.save());
    assert.equal(commits, 1); assert.equal(missingReads, 2);
    assert.match(h.status().textContent, /^配置与密钥已保存；界面状态暂不可确认$/);
    assert.equal(h.status().dataset.state, 'warning');
    assert.equal(h.$('#aiCredentialState').textContent, '状态未知');
    assert.equal(h.$('#aiActiveMode').textContent, '状态暂不可确认');
    assert.equal(h.$('#aiSaveConfig').disabled, false);
    assert.doesNotMatch(h.status().textContent, /密钥未保存|操作失败|请重试/);
    h.feature.dispose();
  }
});
