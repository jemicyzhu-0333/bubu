import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createHash } from 'node:crypto';
const research = new URL('../../', import.meta.url);
const roots = ['animation-foundation-v1', 'animation-foundation-v1/secondary-motion', 'runtime-facepath05', 'petting-continuous-r2', 'external-assets-v1', 'original-parts-hybrid-v1'];
const paths = roots.map(root => {
  const require = createRequire(new URL(`${root}/package.json`, research));
  return fs.realpathSync(require.resolve('three'));
});
assert.equal(new Set(paths).size, 1, 'All research consumers must share one physical Three installation');
assert.equal(JSON.parse(fs.readFileSync(path.resolve(path.dirname(paths[0]), '../package.json'))).version, '0.186.1');
const source = new URL('runtime-facepath05/fixtures/face-d2/asset.glb', research);
assert(fs.existsSync(source), 'Run npm run foundation:prepare first');
for (const [name, hash] of [
 ['runtime-facepath05/fixtures/face-d2/asset.glb', '84ec5d8608f21e43bf06df26b8b2f81124909ebb39c77bb9cc153aca17319a3a'],
 ['original-parts-hybrid-v1/geometry/bubu-hybrid-binding.glb', '52a080d81606fbe92e9cd71593bd703f356eb50a0e1c74ccc34547a0db308e67'],
]) {
 assert.equal(createHash('sha256').update(fs.readFileSync(new URL(name, research))).digest('hex'), hash, `Unapproved fixture: ${name}`);
}
for (const root of roots) {
  const directory = new URL(`${root}/`, research);
  assert(!fs.lstatSync(directory).isSymbolicLink(), 'Repository source directories must not be workspace symlinks');
}
console.log(JSON.stringify({ sharedThree: '0.186.1', consumers: roots, preparedD2: fs.statSync(source).size, scope: 'Repository layout and dependency identity only; not GPU or contact acceptance' }, null, 2));
