'use strict';
const { Transform } = require('node:stream');
const { CancellationToken } = require('builder-util-runtime');
const METADATA_LIMIT = 2 * 1024 * 1024;

// Keep the official executor's redirects, net session, file IO and digest chain.
// Only its response stream is narrowed, before metadata accumulation or disk IO.
function createBoundedUpdateNetwork(executor, { setTimer = setTimeout, clearTimer = clearTimeout,
  metadataLimit = METADATA_LIMIT } = {}) {
  if (!executor || typeof executor.request !== 'function' || typeof executor.createRequest !== 'function') throw new Error('update-network-incompatible');
  const bounded = Object.create(executor);
  let active = null, closed = false;
  bounded.createRequest = function (options, callback) {
    const scope = active;
    if (!scope || closed || scope.token.cancelled) throw new Error('update-operation-closed');
    const request = executor.createRequest.call(bounded, options, response => {
      const limit = scope.maxBytes || metadataLimit;
      let bytes = 0;
      const gate = new Transform({ transform(chunk, encoding, done) {
        bytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk, encoding);
        done(bytes > limit ? new Error('update-response-too-large') : null, bytes > limit ? undefined : chunk);
      } });
      for (const key of ['headers', 'statusCode', 'statusMessage']) gate[key] = response[key];
      gate.on('error', () => { response.destroy?.(); scope.token.cancel(); });
      response.on('error', error => gate.destroy(error));
      callback(gate);
      const length = response.headers?.['content-length'];
      if (length != null && (!/^[0-9]+$/.test(String(length)) || Number(length) > limit)) {
        gate.destroy(new Error('update-response-too-large'));
      } else response.pipe(gate);
    });
    const cancel = () => request.abort();
    scope.requests.add(request);
    scope.token.onCancel(cancel);
    request.once('close', () => { scope.requests.delete(request); scope.token.removeListener('cancel', cancel); });
    return request;
  };
  bounded.request = function (options, token = new CancellationToken(), data) {
    const scope = active;
    if (!scope || closed || scope.token.cancelled) return Promise.reject(new Error('update-operation-closed'));
    const linked = new CancellationToken(token);
    const cancel = () => linked.cancel();
    scope.token.onCancel(cancel);
    return Promise.resolve().then(() => executor.request.call(bounded, options, linked, data)).finally(() => {
      scope.token.removeListener('cancel', cancel); linked.dispose();
    });
  };
  function run(work, { timeoutMs, token = new CancellationToken(), maxBytes = null }) {
    if (closed || active) return Promise.reject(new Error('update-operation-busy'));
    const scope = { token, maxBytes, requests: new Set() }; active = scope;
    const cancel = token.createPromise((_resolve, _reject, onCancel) => onCancel(() => {}));
    const timer = setTimer(() => token.cancel(), timeoutMs);
    const operation = Promise.resolve().then(() => {
      if (closed || token.cancelled) throw new Error('update-operation-closed');
      return work();
    }).finally(() => {
      if (active === scope) active = null; clearTimer(timer);
      for (const request of scope.requests) request.abort();
      scope.requests.clear();
    });
    // A cancelled operation retains admission until the official promise settles;
    // a late old check must never borrow a newer operation's transport scope.
    return Promise.race([operation, cancel]).finally(() => { clearTimer(timer); });
  }
  function close() { closed = true; active?.token.cancel(); }
  return Object.freeze({ executor: bounded, run, close });
}
module.exports = { createBoundedUpdateNetwork, METADATA_LIMIT };
