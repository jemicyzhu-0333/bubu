'use strict';
const { registerHooks } = require('node:module');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const mode = process.env.DIAG_YIELD === '1' ? 'yield' : 'baseline';
const dir = process.env.DIAG_OUT;
function trace(label, data = {}) {
  fs.appendFileSync(path.join(dir, `native-${process.pid}.jsonl`), JSON.stringify({ label, pid: process.pid, at: performance.now(), memory: process.memoryUsage(), ...data }) + '\n');
}
globalThis.__diagTrace = trace;
registerHooks({ load(url, context, next) {
  const result = next(url, context);
  const usagi = url.endsWith('/test/usagi-production-contact.test.js');
  const sip = url.endsWith('/test/dango-sip-source-runtime.test.mjs');
  if (!usagi && !sip) return result;
  let source = String(result.source);
  const originalHash = crypto.createHash('sha256').update(source).digest('hex');
  if (usagi) {
    const a = "test(`${id} clears resolved eye and mouth ink throughout its production flight`, t => {";
    if (!source.includes(a)) throw Error('Usagi diagnostic anchor changed');
    source = source.replace(a, "test(`${id} clears resolved eye and mouth ink throughout its production flight`, async t => {");
    source = source.replace("for (const { progress, calmVisual } of samples) {", "let sampleIndex = 0; globalThis.__diagTrace('usagi-view-start', {id,view,paths:paths.size}); for (const { progress, calmVisual } of samples) {\nif (sampleIndex % 64 === 0) globalThis.__diagTrace('usagi-sample', {id,view,sampleIndex,paths:paths.size});\n" + (mode === 'yield' ? "if (sampleIndex % 10 === 0) await new Promise(resolve => setImmediate(resolve));\n" : "") + "sampleIndex++;");
  } else {
    const a = 'for (let i = 0; i <= 256; i++) {';
    if (!source.includes(a)) throw Error('Sip diagnostic anchor changed');
    source = source.replace(a, a + "\nif (i % 64 === 0) globalThis.__diagTrace('sip-sample', {i,a:a.cacheStats(),b:b.cacheStats()});\n" + (mode === 'yield' ? "if (i % 10 === 0) await new Promise(resolve => setImmediate(resolve));\n" : ""));
    source = source.replace('} finally { a.dispose(); b.dispose(); }', "} finally { globalThis.__diagTrace('sip-before-dispose', {a:a.cacheStats(),b:b.cacheStats()}); a.dispose(); b.dispose(); globalThis.__diagTrace('sip-after-dispose', {a:a.cacheStats(),b:b.cacheStats()}); }");
  }
  trace('instrumented', {url,mode,originalHash,changedHash:crypto.createHash('sha256').update(source).digest('hex')});
  process.on('beforeExit', () => trace('before-exit'));
  return {...result,source};
}});
