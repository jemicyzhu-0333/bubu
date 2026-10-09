import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dist=path.join(root,'dist');
const installed=JSON.parse(await readFile(path.join(root,'node_modules/gsap/package.json'),'utf8'));
if(installed.version!=='3.14.2')throw new Error('Expected locked GSAP 3.14.2. Run npm ci.');
await rm(dist,{recursive:true,force:true});
await cp(path.join(root,'public'),dist,{recursive:true});
await mkdir(path.join(dist,'assets'),{recursive:true});
for(const filename of ['gsap.min.js','ScrollTrigger.min.js']){
 await cp(path.join(root,'node_modules/gsap/dist',filename),path.join(dist,'assets',filename));
}
await writeFile(path.join(dist,'.nojekyll'),'');
console.log('Built self-contained static website in website/dist.');
