'use strict';

const DEFAULT_PATTERNS = Object.freeze([
  /(^|[/\\])src[/\\](content|core|surfaces[/\\]pet|renderer)[/\\].+\.(js|mjs|html)$/,
  /(^|[/\\])(content|core|surfaces[/\\]pet|renderer)[/\\].+\.(js|mjs|html)$/
]);

function createPetHotReload({
  watch = (directory, options, listener) => require('node:fs').watch(directory, options, listener),
  setTimeout = globalThis.setTimeout,
  clearTimeout = globalThis.clearTimeout,
  sourceRoot,
  reload,
  patterns = DEFAULT_PATTERNS,
  debounceMs = 80
} = {}) {
  if (typeof watch !== 'function' || typeof setTimeout !== 'function' || typeof clearTimeout !== 'function') {
    throw new TypeError('pet hot reload requires watch and timer ports');
  }
  if (typeof sourceRoot !== 'string' || !sourceRoot) throw new TypeError('pet hot reload source root is required');
  if (typeof reload !== 'function') throw new TypeError('pet hot reload callback is required');
  let watcher = null;
  let timer = null;
  let stopped = false;
  let lastFile = null;

  function relevant(fileName) {
    if (!fileName) return true;
    const value = String(fileName);
    return patterns.some(pattern => pattern.test(value));
  }

  function schedule(_eventType, fileName) {
    if (stopped || !relevant(fileName)) return false;
    lastFile = fileName ? String(fileName) : null;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (stopped) return;
      const changedFile = lastFile;
      lastFile = null;
      reload(changedFile);
    }, debounceMs);
    return true;
  }

  function start() {
    if (watcher || stopped) return false;
    watcher = watch(sourceRoot, { recursive: true }, schedule);
    return true;
  }

  function stop() {
    if (stopped) return false;
    stopped = true;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (watcher && typeof watcher.close === 'function') watcher.close();
    watcher = null;
    return true;
  }

  return Object.freeze({ start, stop, schedule, get running() { return Boolean(watcher) && !stopped; } });
}

module.exports = Object.freeze({ DEFAULT_PATTERNS, createPetHotReload });
