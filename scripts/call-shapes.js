'use strict';

// 守卫要问的是“这个调用收到了哪些协作者”，源码排版不属于契约。先前两条判据把换行和键
// 顺序写进了正则（`registerProcessLifecycle\(\s*\{\s*\n\s*lifecycle,\s*\n\s*appHost,`），于是
// 把参数并成一行或调整键顺序都会让守卫失败——而它报的是“main.js 没用某个适配器”，真实
// 原因只是格式。误报比漏报更贵：读的人会照着错误的指路去改一个本来就对的接线。

// 对象键出现在 `{` 或 `,` 之后、`:` / `,` / `}` 之前。收尾用前瞻而不是吃掉分隔符：
// `{ a, b }` 里 b 的前导逗号正是 a 的收尾逗号，吃掉就会每隔一个漏一个键。
const OPTION_KEY = /[{,]\s*([A-Za-z_$][\w$]*)\s*(?=[:,}])/g;

// 取调用实参里的键集合。按平衡括号切实参，所以嵌套的回调、对象和调用都不会提前截断；
// 找不到调用点返回 null，让调用方把“根本没这个调用”和“调用了但没给这些键”分开报。
// 嵌套对象的键也会一起收进来，所以判据是“至少收到了这些协作者”的包含判断。按花括号深度
// 过滤会更精确，但字符串字面量里的花括号会把深度算歪——那种误报正是这层要消掉的东西。
function callOptionKeys(source, callee) {
  const at = source.search(new RegExp(`\\b${callee}\\s*\\(`));
  if (at < 0) return null;
  let depth = 0;
  for (let index = source.indexOf('(', at); index < source.length; index += 1) {
    if (source[index] === '(') depth += 1;
    else if (source[index] === ')' && (depth -= 1) === 0) {
      const options = source.slice(at, index);
      return new Set([...options.matchAll(OPTION_KEY)].map(match => match[1]));
    }
  }
  return null;
}

function callReceives(source, callee, names) {
  const keys = callOptionKeys(source, callee);
  return Boolean(keys) && names.every(name => keys.has(name));
}

module.exports = { callOptionKeys, callReceives };
