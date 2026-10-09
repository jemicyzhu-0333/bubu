'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

// 处理器住在哪个文件不属于契约，契约只有一条：已注册的通道集合与 route-catalog 必须互为
// 闭集。先前判据写死了只扫 src/main.js，于是两条规则互相锁住——legacyRatchet 要求 main.js
// 的 ipcRegistrations 下降，而唯一的下降办法（把某一族处理器搬出 main.js）会被这条判据判成
// “已声明但没有处理器”。按文件收集而不是只数个数，是为了让重复注册能报出两边的文件名：
// 同一个通道注册两次时，后一个 ipcMain.handle 会直接抛错，而报错里不写文件名就得靠人去找。
function ipcRegistrationSites(root = ROOT) {
  function walk(relative) {
    return fs.readdirSync(path.join(root, relative), { withFileTypes: true }).flatMap(entry => {
      const child = path.posix.join(relative, entry.name);
      return entry.isDirectory() ? walk(child) : [child];
    });
  }
  return walk('src')
    .filter(file => /\.(?:js|mjs)$/.test(file))
    .flatMap(file => [...fs.readFileSync(path.join(root, file), 'utf8').matchAll(/registerIpc\('([^']+)'/g)]
      .map(match => ({ channel: match[1], file })));
}

module.exports = { ipcRegistrationSites };
