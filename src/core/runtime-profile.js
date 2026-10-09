'use strict';

const path = require('node:path');

// `npm run dev` 传的标记。判定用一个显式的命令行开关，而不是 `app.isPackaged`：
// 从源码跑 `npm start` 连的仍是日常那份真实数据（我们自己每天都在用它），
// 只有明确声明“这一次是开发”的那次运行才换一整套目录。
const DEV_FLAG = '--dev';
const DEV_SUFFIX = '-dev';

// New installations use the current product identity. No old directory is
// imported, migrated or deleted; explicit user-data-dir bypasses this mapping.
function defaultStoragePath(directory) {
  const name = path.basename(directory);
  return ['im-adhder', 'I’m ADHDer', "I'm ADHDer"].includes(name)
    ? path.join(path.dirname(directory), 'im-adhder') : directory;
}

function isDevProfile(argv = []) {
  return Array.isArray(argv) && argv.includes(DEV_FLAG);
}

/**
 * Where this run may keep its data. Development gets a sibling directory so an
 * unverified build cannot write into the state we actually rely on, and so both
 * can be open at once — the single-instance lock lives in this directory too,
 * which is why sharing it makes the two instances kill each other rather than
 * merely mix their data.
 *
 * Everyday runs return the path untouched: an accidental redirect would look
 * exactly like data loss, so only the explicit flag may move it.
 */
function profileUserDataPath(userDataPath, argv = []) {
  if (typeof userDataPath !== 'string' || !path.isAbsolute(userDataPath)) {
    throw new TypeError('an absolute userDataPath is required');
  }
  const parent = path.dirname(userDataPath);
  const name = path.basename(userDataPath);
  // 根目录没有可用的兄弟位置，拼出来的路径会落在文件系统根上。
  if (!name || parent === userDataPath) {
    throw new TypeError('userDataPath must name a directory inside a parent');
  }
  if (!isDevProfile(argv)) return userDataPath;
  // 已经在开发目录里就地不动：重复派生会得到 `-dev-dev`，那是第三份数据，
  // 而它看起来又像是“配置莫名丢了”。
  return name.endsWith(DEV_SUFFIX) ? userDataPath : path.join(parent, `${name}${DEV_SUFFIX}`);
}

module.exports = { DEV_FLAG, DEV_SUFFIX, isDevProfile, profileUserDataPath, defaultStoragePath };
