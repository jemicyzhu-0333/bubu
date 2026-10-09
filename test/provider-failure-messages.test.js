'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

test('provider envelope failures explain interface configuration instead of blaming model JSON', async () => {
  const { createPopoverMessages } = await import('../src/surfaces/popover/ui/messages.mjs');
  const { fallbackReasonText } = createPopoverMessages({ pad2: n => String(n).padStart(2, '0') });
  assert.match(fallbackReasonText('provider-response-html'), /网页.*Base URL/);
  assert.match(fallbackReasonText('provider-response-event-stream'), /流式.*兼容协议/);
  assert.match(fallbackReasonText('provider-response-empty'), /空响应/);
  assert.match(fallbackReasonText('provider-response-invalid-json'), /接口响应.*Base URL/);
  assert.doesNotMatch(fallbackReasonText('provider-response-invalid-json'), /模型返回/);
  assert.match(fallbackReasonText('provider-unavailable'), /本地回复/);
});

test('unconfigured provider has a readable reason in local reply provenance', async () => {
  const { createPopoverMessages } = await import('../src/surfaces/popover/ui/messages.mjs');
  const { fallbackReasonText } = createPopoverMessages({ pad2: n => String(n).padStart(2, '0') });
  assert.equal(fallbackReasonText('provider-not-configured'), '尚未配置完整的模型连接，本次使用本地回复');
});
