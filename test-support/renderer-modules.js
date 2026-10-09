'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const vm = require('node:vm');

function resolveImport(fromFile, specifier) {
  if (!specifier.startsWith('.')) throw new Error(`renderer module cannot import package ${specifier}`);
  const base = path.resolve(path.dirname(fromFile), specifier);
  for (const candidate of [base, `${base}.mjs`, `${base}.js`, path.join(base, 'index.mjs'), path.join(base, 'index.js')]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`renderer module import not found: ${specifier} from ${fromFile}`);
}

function transformImports(source) {
  return source
    .replace(/import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+['"]([^'"]+)['"]\s*;?/g,
      (_, name, specifier) => `const ${name} = __import(${JSON.stringify(specifier)});`)
    .replace(/import\s+([A-Za-z_$][\w$]*)\s+from\s+['"]([^'"]+)['"]\s*;?/g,
      (_, name, specifier) => `const ${name} = __import(${JSON.stringify(specifier)}).default;`)
    .replace(/import\s*\{([^}]+)\}\s*from\s+['"]([^'"]+)['"]\s*;?/g,
      (_, names, specifier) => {
        // ESM uses `exported as local`; object destructuring uses `exported: local`.
        // Translate the binding pair, not every occurrence of the identifier `as`.
        const bindings = names.replace(/([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)/g, '$1: $2');
        return `const { ${bindings} } = __import(${JSON.stringify(specifier)});`;
      });
}

function transformExports(source) {
  const named = [];
  let transformed = source
    .replace(/export\s+default\s+([^;]+);/g, (_, expression) => `exports.default = ${expression};`)
    .replace(/export\s+const\s+([A-Za-z_$][\w$]*)\s*=/g, (_, name) => {
      named.push(name);
      return `const ${name} =`;
    })
    .replace(/export\s*\{([^}]+)\}\s*;?/g, (_, names) => {
      for (const raw of names.split(',')) {
        const [local, exported = local] = raw.trim().split(/\s+as\s+/);
        if (local) named.push(`${JSON.stringify(exported)}: ${local}`);
      }
      return '';
    });
  const assignments = named.map(entry => entry.includes(':')
    ? `exports[${entry.split(':')[0]}] = ${entry.slice(entry.indexOf(':') + 1).trim()};`
    : `exports.${entry} = ${entry};`).join('\n');
  return `${transformed}\n${assignments}`;
}

function createRendererModuleLoader(context) {
  if (!context || typeof context !== 'object') throw new TypeError('renderer VM context is required');
  const cache = new Map();

  function load(entryPath) {
    const absolute = path.resolve(entryPath);
    if (cache.has(absolute)) return cache.get(absolute);
    const exports = {};
    cache.set(absolute, exports);
    let source = fs.readFileSync(absolute, 'utf8');
    source = transformImports(source).replace(/__import\((['"])(.*?)\1\)/g, (_, quote, specifier) =>
      `__import(${JSON.stringify(resolveImport(absolute, specifier))})`);
    // vm.Script runs a CJS-style wrapper rather than a native ESM module.
    // Preserve the browser's per-module URL for local-only artwork references.
    source = transformExports(source.replace(/\bimport\.meta\.url\b/g,
      JSON.stringify(pathToFileURL(absolute).href)));
    const runner = vm.runInContext(`(function(exports, __import) {\n${source}\n})`, context, { filename: absolute });
    runner(exports, dependency => load(dependency));
    return exports;
  }

  return entryPath => load(entryPath);
}

module.exports = { createRendererModuleLoader };
