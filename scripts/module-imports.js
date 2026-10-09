'use strict';

const path = require('node:path');

// 两个守卫脚本都要回答“这个文件依赖了什么”。语法覆盖只维护一份：CommonJS 的
// require()、静态 import/export ... from、副作用 import 和动态 import()。少认一种
// 写法会让两个脚本同时静默失效，而“扫了但匹配不上”比“没扫”更容易被当成已覆盖。
function importedSpecifiers(source) {
  return [
    ...source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g),
    ...source.matchAll(/(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g),
    ...source.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)
  ].map(match => match[1]);
}

// 把相对说明符还原成仓库内路径并去掉扩展名，让判据与写法无关：ESM 必须写全扩展名
// （`../main.js`），而同一个目标从不同深度看是 `../main` 还是 `../../main.js`。按字面
// 匹配说明符的规则会漏掉其中任意一种。裸说明符（'electron'）返回 null。
function resolveSpecifier(file, specifier) {
  if (!specifier.startsWith('.')) return null;
  const target = path.posix.join(path.posix.dirname(file), specifier);
  return target.replace(/\.(?:js|mjs)$/, '');
}

module.exports = { importedSpecifiers, resolveSpecifier };
