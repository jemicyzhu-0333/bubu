'use strict';

// HTTP envelope diagnostics never expose a response body or arbitrary headers.
function responseContentKind(contentType) {
  if (typeof contentType !== 'string') return 'unknown';
  const mime = contentType.split(';', 1)[0].trim().toLowerCase();
  if (mime === 'application/json' || /^application\/[a-z0-9.+-]+\+json$/.test(mime)) return 'json';
  if (mime === 'text/html' || mime === 'application/xhtml+xml') return 'html';
  if (mime === 'text/event-stream') return 'event-stream';
  if (mime === 'text/plain') return 'text';
  return mime ? 'other' : 'unknown';
}

function parseProviderResponse(text, contentType) {
  // A UTF-8 BOM is an envelope encoding convention, not model-output repair.
  const clean = text.replace(/^\uFEFF/, '').trim();
  if (!clean) throw new TypeError('provider-response-empty');
  const kind = responseContentKind(contentType);
  if (kind === 'event-stream' || /^(?:data:|event:|:)[^\n]*(?:\n|$)/.test(clean)) {
    throw new TypeError('provider-response-event-stream');
  }
  if (kind === 'html' || /^(?:<!doctype\s+html\b|<html\b)/i.test(clean)) {
    throw new TypeError('provider-response-html');
  }
  try { return JSON.parse(clean); }
  catch (_) { throw new TypeError('provider-response-invalid-json'); }
}

module.exports = { responseContentKind, parseProviderResponse };
