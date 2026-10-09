'use strict';

const { createCapabilityCodec } = require('../../../shared/ipc-validation');
const { describeRoutes } = require('../../../shared/ipc-routes');
const { AI_MODEL_PATTERN, isHttpsEndpoint, MAX_AI_URL_INPUT_LENGTH, baseUrlFromEndpoint } = require('../../preferences');

function identity(validation, object) {
  if (typeof object.requestId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(object.requestId)) {
    validation.fail('requestId is invalid');
  }
  return object.requestId;
}
const codec = createCapabilityCodec({
  'ai:test-connection': validation => {
    const object = validation.requireObject();
    if (!object) return undefined;
    validation.rejectUnknown(object, ['requestId', 'model', 'baseUrl', 'secret']);
    const requestId = identity(validation, object);
    const model = typeof object.model === 'string' ? object.model.trim() : '';
    if (!AI_MODEL_PATTERN.test(model)) validation.fail('model is invalid');
    let baseUrl = null;
    if (object.baseUrl !== null && !isHttpsEndpoint(object.baseUrl, MAX_AI_URL_INPUT_LENGTH)) {
      validation.fail('baseUrl must be null or a supported HTTPS endpoint');
    } else if (object.baseUrl !== null) {
      baseUrl = baseUrlFromEndpoint(object.baseUrl);
      if (!isHttpsEndpoint(baseUrl)) validation.fail('baseUrl exceeds the canonical URL limit');
    }
    const result = { requestId, model, baseUrl };
    if (object.secret !== undefined) {
      const secret = typeof object.secret === 'string' ? object.secret.trim() : '';
      if (!secret || secret.length > 4096 || /\s/.test(secret)) validation.fail('secret is invalid');
      else result.secret = secret;
    }
    return result;
  },
  'ai:cancel-connection-test': validation => {
    const object = validation.requireObject();
    if (!object) return undefined;
    validation.rejectUnknown(object, ['requestId']);
    return { requestId: identity(validation, object) };
  }
});
const ipcRoutes = describeRoutes('guidance', codec, {
  'ai:test-connection': ['popover'], 'ai:cancel-connection-test': ['popover']
});
module.exports = { ipcRoutes };
