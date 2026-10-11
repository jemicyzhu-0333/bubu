// Build a self-contained diagnostic artifact; production sources stay untouched.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outArg = process.argv.find(arg => arg.startsWith('--out='));
const out = path.resolve(outArg?.slice(6) || path.join(root, 'dist/pet-workbench.html'));
const modules = {}, assets = {}, hashes = {};
const hash = data => createHash('sha256').update(data).digest('hex');
function read(relative) {
  if (relative.includes('reference/') || relative.includes('usagi-turnaround')) throw Error('Reference assets are excluded');
  const target = path.resolve(root, relative);
  if (!target.startsWith(root + path.sep)) throw Error('Outside application root');
  const data = fs.readFileSync(target); hashes[relative] = hash(data); return data;
}
function visit(relative) {
  if (Object.hasOwn(modules, relative)) return;
  let source = read(relative).toString(); modules[relative] = '';
  const imports = /\b(?:import|export)\s+(?:[^'";]*?\s+from\s*)?['"]([^'"\n]+)['"]/g;
  source = source.replace(imports, (match, specifier) => {
    if (!specifier.startsWith('.')) throw Error(`Unsupported module: ${relative}: ${specifier}`);
    const dep = path.posix.normalize(path.posix.join(path.posix.dirname(relative), specifier)); visit(dep);
    return match.replace(specifier, `https://bubu.invalid/${dep}`);
  });
  if (relative.startsWith('assets/')) {
    for (const match of source.matchAll(/['"]([^'"\n]+\.png)['"]/g)) {
      const asset = path.posix.normalize(path.posix.join(path.posix.dirname(relative), match[1]));
      if (!assets[asset]) assets[asset] = 'data:image/png;base64,' + read(asset).toString('base64');
    }
  }
  source = source.replace(/import\.meta\.url/g, JSON.stringify(`https://bubu.invalid/${relative}`));
  modules[relative] = source;
}
visit('tools/pet-workbench/page.mjs');
const template = read('tools/pet-workbench/index.html').toString();
const css = read('tools/pet-workbench/style.css').toString();
const json = value => JSON.stringify(value).replace(/</g, '\\u003c');
const boot = `const modules=${json(modules)}, assets=${json(assets)};
const imports={};for(const [name,source] of Object.entries(modules))imports['https://bubu.invalid/'+name]=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
const NativeImage=window.Image;window.Image=function EmbeddedImage(...args){const image=new NativeImage(...args);let proto=Object.getPrototypeOf(image),descriptor;while(proto&&!descriptor){descriptor=Object.getOwnPropertyDescriptor(proto,'src');proto=Object.getPrototypeOf(proto);}if(!descriptor?.set)throw Error('Native image loader unavailable');Object.defineProperty(image,'src',{configurable:true,get(){return descriptor.get.call(image);},set(value){if(!value){descriptor.set.call(image,'');return;}const url=new URL(value,location.href);if(url.hostname!=='bubu.invalid')throw Error('External image request blocked');const key=decodeURIComponent(url.pathname.slice(1));if(!assets[key])throw Error('Missing embedded artwork: '+key);descriptor.set.call(image,assets[key]);}});return image;};
const map=document.createElement('script');map.type='importmap';map.textContent=JSON.stringify({imports});document.head.append(map);
import('https://bubu.invalid/tools/pet-workbench/page.mjs').catch(error=>{document.getElementById('loading').textContent='加载失败：'+error.message;document.body.dataset.ready='error';console.error(error);});`;
const escape = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const notices = ['LICENSE', 'LICENSE-SCOPE.md', 'assets/companion/usagi/USAGE.txt'].map(file => `<h3>${file}</h3><pre>${escape(read(file).toString())}</pre>`).join('');
const html = template.replace('/* WORKBENCH_STYLE */', css).replace('<!-- LICENSE_NOTICES -->', notices).replace('/* WORKBENCH_BOOT */', boot);
fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, html);
fs.writeFileSync(out + '.manifest.json', JSON.stringify({ sourceRevision: '2166d65da4ea9537df23abbf87848be6cb3e974b', artifact: path.basename(out), sha256: hash(html), bytes: Buffer.byteLength(html), modules: Object.keys(modules).length, embeddedAssets: Object.keys(assets).length, sourceHashes: hashes, limitations: ['Production browser Canvas diagnostic, not native OS capture', 'No user profile or unlock state is changed'] }, null, 2));
console.log(JSON.stringify({ out, bytes: Buffer.byteLength(html), modules: Object.keys(modules).length, assets: Object.keys(assets).length }));
