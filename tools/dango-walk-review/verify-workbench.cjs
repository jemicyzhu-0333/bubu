'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const repo = path.resolve(arg('repo') || path.join(__dirname, '../..'));
const out = path.resolve(arg('out') || '/tmp/bubu-workbench-walk-review');
fs.mkdirSync(out, { recursive: true });
const copy = fs.mkdtempSync(path.join(out, 'runtime-copy-'));
const configPath = 'src/content/companion/gait/dango-walk.mjs';
const original = fs.readFileSync(path.join(repo, configPath), 'utf8');
const sha = data => createHash('sha256').update(data).digest('hex');
try {
  for (const folder of ['src', 'test-support']) fs.cpSync(path.join(repo, folder), path.join(copy, folder), { recursive: true });
  for (const folder of ['assets', 'tools', 'node_modules']) fs.symlinkSync(path.join(repo, folder), path.join(copy, folder), 'dir');
  fs.copyFileSync(path.join(repo, 'package.json'), path.join(copy, 'package.json'));
  const enabled = original.replace(/(const DANGO_WALK_WORKBENCH = Object\.freeze\(\{\s*enabled: )false/, '$1true');
  if (!/DANGO_WALK_WORKBENCH = Object\.freeze\(\{\s*enabled: true/.test(enabled)) throw Error('Expected one bounded workbench gate');
  fs.writeFileSync(path.join(copy, configPath), enabled);
  const result = spawnSync(process.execPath, [path.join(__dirname, 'capture-workbench.cjs'), copy, out], { stdio: 'inherit' });
  if (result.status !== 0) throw Error(`Actual runtime verification exited ${result.status}`);
  const { createCanvas, loadImage } = require(path.join(repo, 'node_modules/@napi-rs/canvas'));
  const names = ['frame-0', 'frame-45', 'frame-85', 'frame-115', 'frame-155', 'frame-195', 'frame-245', 'frame-287', 'close-first', 'closed'];
  const labels = ['Entry / native stand', 'First recovery', 'Opposite support', 'Step exchange', 'Other foot recovery', 'Grounded support', 'Decelerate', 'Loop stand', 'Close / same foot matrices', '220 ms settle / native stand'];
  (async () => {
    for (const dpr of [1, 2]) {
      const width = 219 * dpr, height = 260 * dpr, canvas = createCanvas(width * 5, height * 2), ctx = canvas.getContext('2d');
      for (let i = 0; i < names.length; i++) {
        const x = i % 5 * width, y = Math.floor(i / 5) * height;
        ctx.fillStyle = i % 2 ? '#202331' : '#f4f4ee'; ctx.fillRect(x, y, width, height);
        ctx.fillStyle = i % 2 ? '#f4f4ee' : '#202331'; ctx.font = `${10 * dpr}px sans-serif`;
        ctx.fillText(`${i + 1}. ${labels[i]}`, x + 6 * dpr, y + 13 * dpr);
        ctx.fillText(`${dpr}x original raster / ${99 * dpr}px body width`, x + 6 * dpr, y + 27 * dpr);
        ctx.fillStyle = '#879082'; ctx.fillRect(x, y + 190 * dpr, width, dpr);
        ctx.drawImage(await loadImage(path.join(out, `dpr-${dpr}-${names[i]}.png`)), x, y + 34 * dpr);
      }
      fs.writeFileSync(path.join(out, `ordered-keyframes-${dpr}x.png`), canvas.toBuffer('image/png'));
    }
    const protectedSources = ['body', 'foot-left', 'foot-right', 'ear-left', 'ear-right'].map(name => {
      const relative = `assets/companion/dango/raster/views/three-quarter-right/${name}.png`;
      return { path: relative, sha256: sha(fs.readFileSync(path.join(repo, relative))) };
    });
    fs.writeFileSync(path.join(out, 'verification-origin.json'), JSON.stringify({
      mode: 'Actual production runtime and workbench DOM/rAF event fixture on offscreen Skia',
      productionGateEnabled: /DANGO_WALK_WORKBENCH = Object\.freeze\(\{\s*enabled: true/.test(original),
      configSha256: sha(original), validationConfigSha256: sha(enabled),
      onlyValidationChange: enabled === original ? 'none' : 'DANGO_WALK_WORKBENCH.enabled=true in an isolated copied source tree',
      protectedSources, nativeAccepted: false, browserAccepted: false,
      productionSourceUnchanged: fs.readFileSync(path.join(repo, configPath), 'utf8') === original
    }, null, 2));
  })().catch(error => { console.error(error); process.exitCode = 1; });
} finally {
  fs.rmSync(copy, { recursive: true, force: true });
}
