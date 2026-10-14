'use strict';
// Drives scripts/install-mac.sh with mocked macOS tools on PATH (curl,
// hdiutil, codesign, ditto, uname, pgrep, osascript, open, shasum).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const skip = process.platform === 'win32' ? 'POSIX shell installer' : false;
const SCRIPT = path.join(__dirname, '..', 'scripts', 'install-mac.sh');
const APP = '小步.app';

function fixture({ machine = 'arm64', badSum = false, assets, codesignFails = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bubu-install-'));
  const bin = path.join(root, 'bin'), home = path.join(root, 'home'), serve = path.join(root, 'serve');
  for (const d of [bin, home, serve]) fs.mkdirSync(d, { recursive: true });
  const names = assets || ['bubu-0.0.2-dev.4-mac-arm64-adhoc-test.dmg', 'bubu-0.0.2-dev.4-win-x64.exe'];
  const dmgs = names.filter(n => n.endsWith('.dmg'));
  let sums = '';
  for (const n of dmgs) {
    fs.writeFileSync(path.join(serve, n), `dmg:${n}`);
    const h = crypto.createHash('sha256').update(`dmg:${n}`).digest('hex');
    sums += `${badSum ? '0'.repeat(64) : h}  ${n}\n`;
  }
  fs.writeFileSync(path.join(serve, 'SHA256SUMS.txt'), sums);
  const release = [{ tag_name: 'v0.0.2-dev.4', name: '小步 bubu 0.0.2-dev.4 测试版', prerelease: true,
    assets: names.map(name => ({ name, size: 1 })) }];
  fs.writeFileSync(path.join(serve, 'releases.json'), JSON.stringify(release));
  const log = path.join(root, 'calls.log');
  const tool = (name, body) => fs.writeFileSync(path.join(bin, name), `#!/usr/bin/env bash\necho "${name} $*" >> "${log}"\n${body}\n`, { mode: 0o755 });
  tool('uname', `[ "$1" = -s ] && echo Darwin || echo ${machine}`);
  tool('curl', `out=""; url=""; while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2;; -H) shift 2;; -*) shift;; *) url="$1"; shift;; esac; done
case "$url" in *api.github.com*/releases*) f=releases.json;; *) f="\${url##*/}";; esac
[ -f "${serve}/$f" ] || exit 22
if [ -n "$out" ]; then cp "${serve}/$f" "$out"; else cat "${serve}/$f"; fi`);
  tool('hdiutil', `if [ "$1" = attach ]; then mp=""; while [ $# -gt 0 ]; do [ "$1" = -mountpoint ] && mp="$2"; shift; done; mkdir -p "$mp/${APP}/Contents/MacOS"; echo bin > "$mp/${APP}/Contents/MacOS/x"; fi`);
  tool('codesign', codesignFails ? 'exit 1' : 'exit 0');
  tool('ditto', 'cp -R "$1" "$2"');
  tool('pgrep', 'exit 1'); tool('pkill', 'exit 0'); tool('osascript', 'exit 0'); tool('open', 'exit 0');
  return { root, bin, home, log, run(args = [], env = {}) {
    const r = spawnSync('bash', [SCRIPT, ...args], { encoding: 'utf8',
      env: { PATH: `${bin}:${process.env.PATH}`, HOME: home, BUBU_SYSTEM_APPS_DIR: path.join(root, 'no-system-apps'), ...env } });
    return { ...r, calls: fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '' };
  } };
}

test('installs the newest matching DMG after sha256 + codesign checks, to ~/Applications when /Applications is not writable', { skip }, () => {
  const f = fixture(), r = f.run();
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(f.home, 'Applications', APP, 'Contents/MacOS/x')));
  assert.match(r.stdout, /sha256 ok/);
  assert.match(r.calls, /codesign --verify --deep --strict .*mnt/);
  assert.match(r.calls, /codesign --verify --deep --strict .*home\/Applications/);
  assert.match(r.calls, /open .*小步\.app/);
  assert.doesNotMatch(r.calls, /xattr/, 'curl downloads carry no quarantine; nothing is stripped');
});

test('BUBU_APPS_DIR and BUBU_NO_LAUNCH are honoured', { skip }, () => {
  const f = fixture(), dir = path.join(f.root, 'apps'), r = f.run([], { BUBU_APPS_DIR: dir, BUBU_NO_LAUNCH: '1' });
  assert.equal(r.status, 0, r.stderr); assert.ok(fs.existsSync(path.join(dir, APP)));
  assert.doesNotMatch(r.calls, /^open /m);
});

test('checksum mismatch aborts before mounting or installing', { skip }, () => {
  const f = fixture({ badSum: true }), r = f.run();
  assert.notEqual(r.status, 0); assert.match(r.stderr, /sha256 mismatch/);
  assert.doesNotMatch(r.calls, /hdiutil attach/); assert.ok(!fs.existsSync(path.join(f.home, 'Applications', APP)));
});

test('invalid signature aborts without installing', { skip }, () => {
  const f = fixture({ codesignFails: true }), r = f.run();
  assert.notEqual(r.status, 0); assert.match(r.stderr, /signature/);
  assert.ok(!fs.existsSync(path.join(f.home, 'Applications', APP)));
});

test('Intel Macs get the x64 asset, or a clear error when the release has none', { skip }, () => {
  const ok = fixture({ machine: 'x86_64', assets: ['bubu-1-mac-arm64-adhoc-test.dmg', 'bubu-1-mac-x64-adhoc-test.dmg'] });
  const r = ok.run(); assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /mac-x64/);
  const none = fixture({ machine: 'x86_64' }).run();
  assert.notEqual(none.status, 0); assert.match(none.stderr, /no macOS x64 build/);
});

test('--uninstall removes the app and keeps user data', { skip }, () => {
  const f = fixture(); assert.equal(f.run().status, 0);
  const data = path.join(f.home, 'Library/Application Support/bubu'); fs.mkdirSync(data, { recursive: true });
  const r = f.run(['--uninstall']); assert.equal(r.status, 0, r.stderr);
  assert.ok(!fs.existsSync(path.join(f.home, 'Applications', APP))); assert.ok(fs.existsSync(data));
});

test('non-macOS hosts and unknown options are refused', { skip }, () => {
  const f = fixture();
  fs.writeFileSync(path.join(f.bin, 'uname'), '#!/usr/bin/env bash\necho Linux\n', { mode: 0o755 });
  assert.match(f.run().stderr, /only supports macOS/);
  const g = fixture(); assert.match(g.run(['--bogus']).stderr, /unknown option/);
});
