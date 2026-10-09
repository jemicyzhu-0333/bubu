'use strict';

const test = require('node:test');
const path = require('node:path');
const assert = require('node:assert/strict');
const { DEV_FLAG, isDevProfile, profileUserDataPath } = require('../src/core/runtime-profile');

const PRODUCTION = '/Users/someone/Library/Application Support/focuspix';

test('brand change keeps storage identity while custom bench paths stay isolated', () => {
  const { legacyStoragePath } = require('../src/core/runtime-profile');
  const parent = path.resolve('/profiles');
  assert.equal(legacyStoragePath(path.join(parent, 'im-adhder')), path.join(parent, 'focuspix'));
  assert.equal(profileUserDataPath(legacyStoragePath(path.join(parent, 'im-adhder')), ['--dev']), path.join(parent, 'focuspix-dev'));
  assert.equal(legacyStoragePath(path.join(parent, 'bench-profile')), path.join(parent, 'bench-profile'));
});

// 这个函数唯一的职责是回答“这一次运行可以往哪儿写”。答错的两个方向不对称：
// 少隔离会让未验证的代码写进日常那份数据，多隔离只是又开一份空数据 —— 所以
// 默认必须是原样返回，只有显式标记才允许改道。
test('an everyday run keeps the real data directory untouched', () => {
  assert.equal(isDevProfile([]), false);
  assert.equal(isDevProfile(['electron', '.']), false);
  assert.equal(profileUserDataPath(PRODUCTION, []), PRODUCTION);
  assert.equal(profileUserDataPath(PRODUCTION, ['electron', '.']), PRODUCTION);
  // 相近但不相同的参数不算：`--devtools` 之类不该悄悄换掉数据目录。
  assert.equal(profileUserDataPath(PRODUCTION, ['--devtools']), PRODUCTION);
  assert.equal(profileUserDataPath(PRODUCTION, ['--dev-mode']), PRODUCTION);
});

test('the dev flag moves data to a sibling directory, not a nested one', () => {
  assert.equal(isDevProfile(['electron', '.', DEV_FLAG]), true);
  assert.equal(
    profileUserDataPath(PRODUCTION, ['electron', '.', '--dev']),
    path.join(path.dirname(PRODUCTION), 'focuspix-dev')
  );
  // 同级而非子目录：放在里面的话，删掉开发数据就会连带删掉真实数据。
  assert.equal(profileUserDataPath(PRODUCTION, ['--dev']).startsWith(`${PRODUCTION}/`), false);
});

test('deriving twice does not create a third data directory', () => {
  const dev = profileUserDataPath(PRODUCTION, ['--dev']);
  // `-dev-dev` 会是第三份数据，而它在用户眼里只会显示成“配置又丢了”。
  assert.equal(profileUserDataPath(dev, ['--dev']), dev);
});

test('a path we cannot safely derive from fails loudly instead of guessing', () => {
  // 相对路径拼出来的目录取决于当时的工作目录 —— 那等于随机选一份数据。
  assert.throws(() => profileUserDataPath('focuspix', ['--dev']), TypeError);
  assert.throws(() => profileUserDataPath('', ['--dev']), TypeError);
  assert.throws(() => profileUserDataPath(null, ['--dev']), TypeError);
  // 根目录没有可用的兄弟位置，派生结果会落在文件系统根上。
  assert.throws(() => profileUserDataPath('/', ['--dev']), TypeError);
  // 校验先于分支：一个非法路径在日常运行里也不该被原样放过。
  assert.throws(() => profileUserDataPath('relative/path', []), TypeError);
});
