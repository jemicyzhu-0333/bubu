import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { Script } from 'node:vm';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dist=path.join(root,'dist');
const html=fs.readFileSync(path.join(dist,'index.html'),'utf8');
const page=new URL('https://example.invalid/bubu/');
for(const filename of ['app.js','assets/gsap.min.js','assets/ScrollTrigger.min.js']){
 new Script(fs.readFileSync(path.join(dist,filename),'utf8'),{filename});
}
for(const match of html.matchAll(/(?:src|href)="([^"]+)"/g)){
 const value=match[1];
 if(/^(?:https?:|#|data:)/.test(value))continue;
 assert(!value.startsWith('/'),'Local asset must be relative to the project base.');
 assert(fs.existsSync(path.join(dist,value)),`Missing local file: ${value}`);
 assert(new URL(value,page).pathname.startsWith('/bubu/'),'Project-base resolution failed.');
}
for(const tag of html.matchAll(/<(?:script|link|img)\b[^>]*>/g)){
 assert(!/(?:src|href)="https?:/.test(tag[0]),'Runtime resources must be self-hosted.');
}
const downloads={
  "windows": "https://github.com/jemicyzhu-0333/bubu/releases/download/v0.0.1-dev-r4/bubu-0.0.1-dev-win-x64.exe",
  "mac": "https://github.com/jemicyzhu-0333/bubu/releases/download/v0.0.1-dev-r4/bubu-0.0.1-dev-mac-arm64-adhoc-test.dmg"
};
for(const platform of ['windows','mac']){
 const tag=[...html.matchAll(/<a\b[^>]*>/g)].map(m=>m[0]).find(t=>t.includes(`data-platform="${platform}"`));
 assert(tag,`Missing ${platform} download`);
 const url=tag.match(/href="([^"]+)"/)?.[1];
 assert.equal(url,downloads[platform],`Unexpected ${platform} release link`);
}
assert(html.includes('id="mac-warning"'),'Mac restricted-test warning must remain.');
assert(html.includes('Gatekeeper currently blocks normal installation.'),'Missing Gatekeeper limitation');
assert(html.includes('Ad-hoc signed, not notarized'),'Missing Mac signing disclosure');
assert(html.includes('Unsigned; Windows may show SmartScreen warnings.'),'Missing Windows signing disclosure');
assert(html.includes('https://github.com/jemicyzhu-0333/bubu/releases/tag/v0.0.1-dev-r4'),'Missing current release notes');
assert(html.includes('https://github.com/jemicyzhu-0333/bubu/releases/download/v0.0.1-dev-r4/SHA256SUMS.txt'),'Missing current checksums');
assert(!html.includes('/v0.0.1-dev/'),'Outdated download link');
assert(!/libfile_|appgprj_|appgver_|sediment:|workspace\/scratch/.test(html),'Internal authoring identity in public page');
assert(!/0\.4\.0|TODO|placeholder/.test(html),'Stale release or placeholder text');
assert(html.includes('<title>bubu · 小步 —'),'Missing current bilingual product title');
assert.equal([...html.matchAll(/class="poster-brand"/g)].length,5,'Each supplied poster needs a live bubu header');
assert.equal([...html.matchAll(/class="art-frame"/g)].length,5,'Each supplied poster needs former-name header framing');
assert(html.includes('These r4 installers use the 小步 / bubu name.'),'Current download copy must match the actual branded r4 release');
assert(!html.includes('/v0.0.1-dev-r3/')&&!html.includes('r3 pre-rename test build'),'Outdated primary download revision');
assert(!html.includes('github.io/im-adhder/')&&!html.includes('github.com/jemicyzhu-0333/im-adhder'),'Public links must use the renamed repository');
const css=fs.readFileSync(path.join(dist,'style.css'),'utf8');
assert(css.includes('aspect-ratio:1086/1348')&&css.includes('translateY(-6.9060773481%)'),'Retain exact top-header framing without editing supplied artwork');
assert(css.includes('@media(prefers-reduced-motion:reduce)'),'Retain reduced-motion CSS');
const app=fs.readFileSync(path.join(dist,'app.js'),'utf8');
assert(app.includes("window.matchMedia('(prefers-reduced-motion: reduce)')")&&app.includes('media.revert()'),'Retain GSAP reduced-motion handling');
console.log('PASS: script syntax, assets, /bubu/ project base, current brand, poster framing, local-only runtime, verified r4 downloads and platform cautions.');
