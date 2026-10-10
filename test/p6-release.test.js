'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const asar = require('@electron/asar');

const {
  ARM64_CPU_TYPE,
  RESTRICTED_MARKERS,
  detectMachArchitectures,
  validateBuildConfig,
  verifyAsar
} = require('../scripts/verify-macos-app');

const ROOT = path.resolve(__dirname, '..');

function walk(relative) {
  const absolute = path.join(ROOT, relative);
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap(entry => {
    const child = path.join(relative, entry.name);
    return entry.isDirectory() ? walk(child) : [child];
  });
}

test('测试构建配置为 0.0.2-dev.3，本机入口通过显式 arm64 路径验证 macOS', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.doesNotThrow(() => validateBuildConfig(pkg));
  assert.deepEqual(pkg.build.files.filter(pattern => !pattern.startsWith('!')), ['src/**/*', 'assets/**/*', 'package.json']);
  assert.equal(pkg.scripts['validate:p6:sandbox'], 'npm run validate:mac');
  assert.doesNotThrow(() => validateBuildConfig({ ...pkg, build: { ...pkg.build, mac: {
    ...pkg.build.mac, target: [{ target: 'dmg', arch: ['arm64', 'x64'] }]
  } } }));
  for (const [key, value] of [['pack', 'electron-builder --mac --arm64 --dir'],
    ['pack:mac', 'node scripts/build-app.js --platform=win --dir'],
    ['validate:mac', 'npm run check && npm run pack:mac -- --x64 && npm run verify:mac-app']]) {
    assert.throws(() => validateBuildConfig({ ...pkg, scripts: { ...pkg.scripts, [key]: value } }), /npm run/);
  }

  for (const version of ['0.0.1', '0.0.2-dev.1', '0.0.2-dev.2']) {
    assert.throws(() => validateBuildConfig({ ...pkg, version }), /development version/);
  }
  assert.throws(() => validateBuildConfig({
    ...pkg,
    build: { ...pkg.build, mac: { ...pkg.build.mac, target: [{ target: 'dmg', arch: ['x64'] }] } }
  }), /arm64 DMG/);
});

test('P6：Mach-O 检查器可区分 arm64、x64 与非可执行文件', () => {
  const arm64 = Buffer.alloc(8);
  arm64.writeUInt32LE(0xfeedfacf, 0);
  arm64.writeUInt32LE(ARM64_CPU_TYPE, 4);
  assert.deepEqual(detectMachArchitectures(arm64), [ARM64_CPU_TYPE]);

  const x64 = Buffer.alloc(8);
  x64.writeUInt32LE(0xfeedfacf, 0);
  x64.writeUInt32LE(0x01000007, 4);
  assert.deepEqual(detectMachArchitectures(x64), [0x01000007]);
  assert.deepEqual(detectMachArchitectures(Buffer.from('not-mach-o')), []);

  const fat = Buffer.alloc(48);
  fat.writeUInt32BE(0xcafebabe, 0);
  fat.writeUInt32BE(2, 4);
  fat.writeUInt32BE(ARM64_CPU_TYPE, 8);
  fat.writeUInt32BE(0x01000007, 28);
  assert.deepEqual(detectMachArchitectures(fat), [ARM64_CPU_TYPE, 0x01000007]);
});

test('P6：实际打包输入不含受限上游标记或额外源码目录', () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'vendor')), false, '不得加入 vendor 目录');
  const textFiles = [...walk('src'), ...walk('assets')]
    .filter(file => /\.(?:m?js|json|html|css|svg|txt)$/i.test(file));
  const hits = [];
  for (const file of textFiles) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8').toLowerCase();
    for (const marker of RESTRICTED_MARKERS) {
      if (source.includes(marker)) hits.push(`${file}: ${marker}`);
    }
  }
  assert.deepEqual(hits, []);
  assert.ok(textFiles.length > 20, '许可证审计没有覆盖到实际产品源码');
});

test('the actual ASAR audit rejects restricted markers in migrated ES modules', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bubu-asar-audit-'));
  try {
    const source = path.join(directory, 'source');
    const archive = path.join(directory, 'app.asar');
    fs.mkdirSync(path.join(source, 'src'), { recursive: true });
    const pkg = require('../package.json');
    fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify(pkg));
    fs.writeFileSync(path.join(source, 'src/main.js'), "'use strict';");
    fs.writeFileSync(path.join(source, 'src/surface.mjs'), 'export const value = 1;');
    await asar.createPackage(source, archive);
    assert.equal(verifyAsar(archive, pkg).ownedTextEntries, 2);
    fs.writeFileSync(path.join(source, 'src/surface.mjs'), `export const value = ${JSON.stringify(RESTRICTED_MARKERS[0])};`);
    await asar.createPackage(source, archive);
    asar.uncache(archive);
    assert.throws(() => verifyAsar(archive, pkg), /surface\.mjs/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
