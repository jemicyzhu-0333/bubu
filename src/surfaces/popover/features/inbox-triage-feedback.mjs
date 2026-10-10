const DETAILS = Object.freeze({
  'capture-triage-apply-failed': '分类结果未保存，可手动选择类型。',
  'capture-triage-unavailable': '本次分类未完成，可手动选择类型。',
  'provider-credential-missing': '还没保存 API 密钥，可在 AI 设置中配置。',
  'provider-model-missing': '还没填写模型名，可在 AI 设置中配置。',
  'provider-timeout': '本次分类超时，可手动选择类型。',
  'provider-network-error': '网络连接失败，可检查网络或手动选择类型。',
  'provider-http-error': '模型服务暂不可用，可检查 AI 设置和服务商状态。',
  'provider-budget': '本次分类已达到请求上限，可手动选择类型。',
  'provider-output-budget': '模型返回过长，可手动选择类型。'
});
const INVALID_RESPONSES = new Set(['proposal-rejected', 'provider-response-invalid-json',
  'provider-response-html', 'provider-response-event-stream', 'provider-response-empty',
  'provider-response-missing-output', 'provider-response-too-large']);
const ENDPOINTS = new Set(['invalid-provider-endpoint', 'provider-endpoint-port-not-allowed',
  'provider-endpoint-host-not-allowed', 'provider-endpoint-address-not-allowed', 'provider-endpoint-resolves-private']);

// Only authored copy leaves this mapping. Never render model/error text as help.
function triageFeedback(impulse) {
  if (!impulse.triageStatus || impulse.classification || impulse.triage || impulse.resolution) return null;
  const { state, reason } = impulse.triageStatus;
  if (state === 'running') return { label: '分类中', detail: '正在分拣这条记录，仍可手动选择类型。' };
  if (state === 'skipped') return { label: '未启用', detail: '捕捉时 AI 分拣未开启，可手动选择类型。' };
  if (state === 'uncertain') return { label: '未确定', detail: '模型未能确定类型，可手动选择。' };
  if (state === 'interrupted') return { label: '已停止', detail: '本次分类已停止，可手动选择类型。' };
  if (state === 'failed') return {
    label: ['provider-credential-missing', 'provider-model-missing'].includes(reason) ? '需配置' : '分类失败',
    detail: DETAILS[reason] || (INVALID_RESPONSES.has(reason)
      ? '模型返回未通过校验，可检查 AI 设置中的模型兼容性。'
      : ENDPOINTS.has(reason) ? 'API 地址不可用，可在 AI 设置中检查地址。'
        : '本次分类未成功，可检查 AI 设置或手动选择类型。')
  };
  return { label: '待分类', detail: '没有保留这条记录的分拣结果，可手动选择类型。' };
}

export { triageFeedback };
