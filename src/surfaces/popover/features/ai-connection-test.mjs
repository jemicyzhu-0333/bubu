import { t, onLocaleChanged } from '../../shared/interface/i18n.mjs';

const REASONS = Object.freeze({
  'invalid-model': '模型名称无效',
  'invalid-credential': '密钥格式无效',
  'credential-missing': '请输入 API 密钥，或先导入已保存的密钥',
  'draft-credential-required': '地址已更改，请填写用于此地址的 API 密钥后测试',
  'endpoint-blocked': '地址不可用：仅支持公网 HTTPS、443 端口',
  authentication: '密钥认证失败', permission: '服务商拒绝访问，请检查密钥与模型权限',
  'model-or-route': '模型或 API 路径不可用', 'rate-limit': '服务商限流或额度不足',
  'provider-unavailable': '服务商暂不可用', 'http-error': '服务商拒绝了测试请求',
  timeout: '测试超时，请检查网络或稍后重试', cancelled: '测试已取消',
  'invalid-response': 'API 未返回有效的模型文本', dns: '无法解析服务商地址',
  tls: 'HTTPS 证书验证失败', network: '网络连接失败',
  busy: '上一次测试尚未结束，请稍后重试', 'request-failed': '测试失败，请检查配置与网络'
});

// Separate from save receipts: a test can neither clear drafts nor claim they
// were saved. Captured secrets only go into the one scoped IPC invocation.
function createAiConnectionTest({ $, document, surfaceClient, isSaving = () => false }) {
  let mounted = false, sequence = 0, current = null, result = null;
  const teardown = [];
  const sessionId = globalThis.crypto.randomUUID();
  function render() {
    const button = $('#aiTestConnection');
    if (button) {
      button.disabled = isSaving();
      button.textContent = t(current ? '取消测试' : '测试连接');
      button.setAttribute?.('aria-busy', current ? 'true' : 'false');
    }
    const status = $('#aiConnectionTestStatus');
    if (!status) return;
    status.dataset.state = current ? 'testing' : result?.ok ? 'success' : result ? 'error' : 'idle';
    status.textContent = current ? t('正在测试当前输入…') : !result ? '' : result.ok
      ? t('连接成功 · 模型已响应（{duration} 毫秒）', { duration: result.durationMs })
      : [t(REASONS[result.reason] || REASONS['request-failed']),
        Number.isInteger(result.httpStatus) ? `HTTP ${result.httpStatus}` : ''].filter(Boolean).join(' · ');
  }
  function cancel({ clear = false } = {}) {
    const pending = current;
    current = null;
    if (pending) {
      // A cancellation only names this invocation; a late cancel cannot abort
      // the replacement request created after a config edit or drawer reopen.
      try { Promise.resolve(surfaceClient.cancelAiConnectionTest(pending.id)).catch(() => {}); } catch (_) {}
    }
    result = clear ? null : pending ? { ok: false, reason: 'cancelled' } : result;
    render();
  }
  async function test() {
    if (!mounted || isSaving()) return;
    if (current) { cancel(); return; }
    const ticket = { id: `connection-${sessionId}-${++sequence}` };
    current = ticket;
    result = null;
    render();
    const draft = { requestId: ticket.id, model: $('#aiModelInput').value.trim(),
      baseUrl: $('#aiBaseUrlInput').value.trim() || null };
    const secret = $('#aiApiKeyInput').value.trim();
    if (secret) draft.secret = secret;
    try {
      if (!draft.model) { result = { ok: false, reason: 'invalid-model' }; return; }
      if (secret && (/\s/.test(secret) || secret.length > 4096)) {
        result = { ok: false, reason: 'invalid-credential' }; return;
      }
      const response = await surfaceClient.testAiConnection(draft);
      if (!mounted || current !== ticket) return;
      // Do not trust arbitrary rejection text; IPC errors can contain payload
      // validation detail. The main process returns only this closed receipt.
      result = response?.ok === true ? { ok: true,
        durationMs: Number.isSafeInteger(response.durationMs) ? response.durationMs : 0 }
        : { ok: false, reason: Object.hasOwn(REASONS, response?.reason) ? response.reason : 'request-failed',
          httpStatus: Number.isInteger(response?.httpStatus) && response.httpStatus >= 100 && response.httpStatus <= 599
            ? response.httpStatus : null };
    } catch (_) {
      if (mounted && current === ticket) result = { ok: false, reason: 'request-failed' };
    } finally {
      delete draft.secret;
      if (mounted && current === ticket) { current = null; render(); }
    }
  }
  function mount() {
    if (mounted) return;
    mounted = true;
    const button = $('#aiTestConnection');
    const click = () => { void test(); };
    button?.addEventListener('click', click);
    teardown.push(() => button?.removeEventListener('click', click));
    teardown.push(onLocaleChanged(render));
    const hidden = () => { if (document?.hidden) cancel({ clear: true }); };
    document?.addEventListener?.('visibilitychange', hidden);
    teardown.push(() => document?.removeEventListener?.('visibilitychange', hidden));
    render();
  }
  function dispose() {
    cancel({ clear: true });
    mounted = false;
    while (teardown.length) teardown.pop()();
  }
  return Object.freeze({ mount, render, test, cancel, dispose });
}
export { createAiConnectionTest };
